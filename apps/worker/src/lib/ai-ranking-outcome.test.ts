import { describe, expect, it } from "vitest";
import { aiExplicitlyAbstained, resolveAiRankingOutcome } from "./ai-ranking-outcome";

const candidates = [
  { hs_code: "6110.90.00", heading: "6110", title: "Babies' garments", score: 0.42, duty_rate: "20" },
  { hs_code: "6111.20.00", heading: "6111", title: "Other babies' garments", score: 0.38, duty_rate: "20" },
];

describe("resolveAiRankingOutcome", () => {
  it("returns picked when AI chose a retrieved candidate", () => {
    const r = resolveAiRankingOutcome({
      parsed: { selectedCode: "6110.90.00", confidence: 0.7, reason: "Best knit match" },
      rawSelected: "6110.90.00",
      selectedFromList: candidates[0],
      candidates,
      defaultReason: "default",
    });
    expect(r.kind).toBe("picked");
    if (r.kind === "picked") {
      expect(r.selected.hs_code).toBe("6110.90.00");
      expect(r.reason).toBe("Best knit match");
    }
  });

  it("abstains when AI JSON says none of the retrieved candidates fit (selectedCode null)", () => {
    const reason =
      "None of the retrieved candidates cover dress pants; the correct heading would be 6203 or 6204 under Chapter 62.";
    const r = resolveAiRankingOutcome({
      parsed: { selectedCode: null, confidence: 0, reason },
      rawSelected: null,
      selectedFromList: null,
      candidates,
      defaultReason: "default",
    });
    expect(r).toEqual({ kind: "abstain", reason });
  });

  it("abstains when AI returns a code that was not in the candidate list", () => {
    const r = resolveAiRankingOutcome({
      parsed: { selectedCode: "6203.42.00", reason: "Men's trousers belong in 6203." },
      rawSelected: "6203.42.00",
      selectedFromList: null,
      candidates,
      defaultReason: "default",
    });
    expect(r.kind).toBe("abstain");
    if (r.kind === "abstain") {
      expect(r.reason).toContain("6203");
    }
  });

  it("falls back to retrieval ranking when AI output was not valid JSON", () => {
    const r = resolveAiRankingOutcome({
      parsed: null,
      rawSelected: undefined,
      selectedFromList: null,
      candidates,
      defaultReason: "default",
    });
    expect(r.kind).toBe("retrieval_fallback");
    if (r.kind === "retrieval_fallback") {
      expect(r.selected.hs_code).toBe("6110.90.00");
      expect(r.confidence).toBeLessThanOrEqual(0.55);
    }
  });
});

describe("aiExplicitlyAbstained", () => {
  it("detects explicit null abstention", () => {
    expect(aiExplicitlyAbstained({ selectedCode: null }, null)).toBe(true);
    expect(aiExplicitlyAbstained({ selectedCode: null }, "null")).toBe(true);
  });
});
