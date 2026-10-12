import { describe, expect, it, vi } from "vitest";
import type { ClassificationRecommendationCandidate, LineItem } from "@pas/shared-types";
import {
  GENERATION_CONCURRENCY,
  batchApplySummary,
  classificationProgress,
  duplicateKey,
  groupDuplicates,
  needsSuggestion,
  runWithConcurrency,
  shouldOfferStrongConfirm,
  splitQueue,
  strongConfirmTitle,
  strongMatches,
} from "./classification-queue";

function line(id: number, overrides: Partial<LineItem> = {}): LineItem {
  return { id, desc: `Item ${id}`, qty: 1, price: 1, ...overrides } as LineItem;
}

const strong: ClassificationRecommendationCandidate = {
  code: "6109.10.10",
  description: "T-shirts of cotton",
  confidence: 0.96,
  confidenceLabel: "Strong Match",
  reason: "Approved history",
  evidence: { historyMatch: true, historyConfirmations: 2, familyResolved: true, compatibilityPassed: true },
} as unknown as ClassificationRecommendationCandidate;

function withRecommendation(id: number, candidate = strong, overrides: Partial<LineItem> = {}): LineItem {
  return line(id, {
    classification_status: "Suggestion Ready",
    classification_recommendation: { status: "recommended", recommendations: [candidate] } as LineItem["classification_recommendation"],
    product_profile: { productFamily: "apparel" } as LineItem["product_profile"],
    ...overrides,
  });
}

describe("runWithConcurrency", () => {
  it("never runs more than the limit at once and processes every item", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], GENERATION_CONCURRENCY, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      running -= 1;
    });
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps going when a worker throws", async () => {
    const done: number[] = [];
    const onError = vi.fn();
    await runWithConcurrency(
      [1, 2, 3],
      2,
      async (n) => {
        if (n === 1) throw new Error("boom");
        done.push(n);
      },
      onError,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onError.mock.calls[0][1]).toEqual(new Error("boom"));
    expect(done.sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

describe("needsSuggestion", () => {
  it("is true for a described line with no recommendation", () => {
    expect(needsSuggestion(line(1))).toBe(true);
  });
  it("is false for blank, applied, recommended, or failed lines", () => {
    expect(needsSuggestion(line(1, { desc: "  " }))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Applied" }))).toBe(false);
    expect(needsSuggestion(withRecommendation(1))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Failed" }))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Needs Manual Review" }))).toBe(false);
  });
});

describe("groupDuplicates", () => {
  it("groups lines whose normalised description and part number match", () => {
    const a = line(1, { desc: "Cotton T-Shirt, Blue" });
    const b = line(2, { desc: "cotton t-shirt blue" });
    const c = line(3, { desc: "Kitchen sink" });
    const groups = groupDuplicates([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0].leader.id).toBe(1);
    expect(groups[0].followers.map((f) => f.id)).toEqual([2]);
    expect(groups[1].leader.id).toBe(3);
  });

  it("keeps lines with different part numbers apart", () => {
    const a = line(1, { desc: "Widget", part_number: "A-1" });
    const b = line(2, { desc: "Widget", part_number: "B-2" });
    expect(groupDuplicates([a, b])).toHaveLength(2);
    expect(duplicateKey(a)).not.toBe(duplicateKey(b));
  });
});

describe("classificationProgress", () => {
  it("counts ready, failed, and completion", () => {
    const items = [
      withRecommendation(1),
      line(2, { classification_status: "Applied", tariff_code: "6109.10.10" }),
      line(3, { classification_status: "Failed" }),
      line(4),
    ];
    const p = classificationProgress(items, new Set([4]));
    expect(p).toEqual({ total: 4, ready: 3, failed: 1, complete: false });
    const done = classificationProgress(items.slice(0, 3), new Set());
    expect(done.complete).toBe(true);
  });

  it("is not complete while a ready line is still busy", () => {
    expect(classificationProgress([withRecommendation(1)], new Set([1])).complete).toBe(false);
  });

  it("counts blank-description lines as ready", () => {
    const items = [withRecommendation(1), line(2, { desc: "  " })];
    expect(classificationProgress(items, new Set())).toEqual({
      total: 2,
      ready: 2,
      failed: 0,
      complete: true,
    });
  });
});

describe("strongMatches", () => {
  it("returns only unapplied lines whose top candidate is auto-applyable", () => {
    const weak = { ...strong, confidence: 0.7, confidenceLabel: "Likely Match" } as ClassificationRecommendationCandidate;
    const items = [
      withRecommendation(1),
      withRecommendation(2, weak),
      withRecommendation(3, strong, { classification_status: "Applied" }),
    ];
    expect(strongMatches(items).map((m) => m.item.id)).toEqual([1]);
  });
});

describe("splitQueue", () => {
  it("separates applied lines from exceptions, preserving order", () => {
    const items = [line(1), line(2, { classification_status: "AI Applied" }), line(3)];
    const { exceptions, applied } = splitQueue(items);
    expect(exceptions.map((i) => i.id)).toEqual([1, 3]);
    expect(applied.map((i) => i.id)).toEqual([2]);
  });
});

describe("shouldOfferStrongConfirm", () => {
  it("offers only once, when complete, with at least one strong match", () => {
    const complete = { total: 2, ready: 2, failed: 0, complete: true };
    expect(shouldOfferStrongConfirm(complete, 1, false)).toBe(true);
    expect(shouldOfferStrongConfirm(complete, 1, true)).toBe(false);
    expect(shouldOfferStrongConfirm(complete, 0, false)).toBe(false);
    expect(shouldOfferStrongConfirm({ ...complete, complete: false }, 1, false)).toBe(false);
  });
});

describe("messages", () => {
  it("titles the modal with correct plurals", () => {
    expect(strongConfirmTitle(1)).toBe("1 line is a strong match. Apply it?");
    expect(strongConfirmTitle(14)).toBe("14 lines are strong matches. Apply them?");
  });
  it("summarises batch results", () => {
    expect(batchApplySummary({ applied: 3, skipped: 0, failed: 0 })).toBe("Applied 3 lines.");
    expect(batchApplySummary({ applied: 1, skipped: 2, failed: 1 })).toBe(
      "Applied 1 line · 2 not strong matches, review individually · 1 failed, see the line for the reason.",
    );
    expect(batchApplySummary({ applied: 0, skipped: 0, failed: 0 })).toBe("Nothing to apply.");
  });
});
