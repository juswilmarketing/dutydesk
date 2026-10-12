import { describe, expect, it } from "vitest";
import { getInvoiceQueueStatus, getWorkflowStages, isLineClassified } from "./workflow-pipeline";

type Inv = Parameters<typeof getWorkflowStages>[0];
type Line = Parameters<typeof isLineClassified>[0];

function line(over: Record<string, unknown>): Line {
  return { id: 1, desc: "x", status: "done", source: "ai", tariff_code: "6109.10.00", ...over } as unknown as Line;
}

function invoice(items: Line[]): NonNullable<Inv> {
  return {
    id: 1,
    status: "done",
    items,
    meta: { number: "" },
  } as unknown as NonNullable<Inv>;
}

const taxInputs = {} as Parameters<typeof getWorkflowStages>[1];

function classificationStatus(items: Line[]) {
  return getWorkflowStages(invoice(items), taxInputs, [], null).find((s) => s.id === "classification")!.status;
}

describe("isLineClassified", () => {
  it("counts applied AI suggestions as classified", () => {
    expect(isLineClassified(line({ classification_status: "Applied" }))).toBe(true);
    expect(isLineClassified(line({ classification_status: "AI Applied" }))).toBe(true);
    expect(isLineClassified(line({ classification_status: "Clerk Edited", source: "manual" }))).toBe(true);
  });

  it("counts manual/learned lines with a code and no classification status", () => {
    expect(isLineClassified(line({ source: "manual" }))).toBe(true);
    expect(isLineClassified(line({ source: "learned" }))).toBe(true);
  });

  it("does not count unapplied suggestions or missing codes", () => {
    expect(isLineClassified(line({ classification_status: "Suggestion Ready" }))).toBe(false);
    expect(isLineClassified(line({ source: "ai" }))).toBe(false);
    expect(isLineClassified(line({ classification_status: "Applied", tariff_code: null }))).toBe(false);
  });
});

describe("classification stage", () => {
  it("is complete when every line is applied, even if source is ai", () => {
    expect(classificationStatus([line({ classification_status: "Applied" }), line({ id: 2, classification_status: "Clerk Edited", source: "manual" })])).toBe("complete");
  });

  it("needs review while any line is unapplied", () => {
    expect(classificationStatus([line({ classification_status: "Applied" }), line({ id: 2, classification_status: "Suggestion Ready", tariff_code: null })])).toBe("needs_review");
  });

  it("is in progress while a line is loading", () => {
    expect(classificationStatus([line({ status: "loading", tariff_code: null })])).toBe("in_progress");
  });

  it("unlocks Duties & Taxes once classification is complete", () => {
    const stages = getWorkflowStages(invoice([line({ classification_status: "Applied" })]), taxInputs, [], null);
    expect(stages.find((s) => s.id === "taxes")!.status).toBe("in_progress");
  });
});

describe("getInvoiceQueueStatus", () => {
  it("does not report applied AI lines as needing review", () => {
    const status = getInvoiceQueueStatus(invoice([line({ classification_status: "Applied" })]), [], taxInputs);
    expect(status).not.toBe("needs_review");
  });
});
