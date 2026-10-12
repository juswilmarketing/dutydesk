import { describe, expect, it } from "vitest";
import type { ClassificationRecommendationCandidate } from "@pas/shared-types";
import { buildCandidateEvidence, calibrateCandidate, type EvidenceContext } from "./candidate-evidence";

function cand(code: string, verified = false): ClassificationRecommendationCandidate {
  return {
    code,
    description: "d",
    chapter: code.slice(0, 2),
    dutyRate: 20,
    vatRate: 12.5,
    reason: "r",
    source: "ai",
    confidence: 0.99,
    confidenceLabel: "Strong Match",
    ...(verified
      ? { officialVerification: { source: "ttbizlink", status: "verified", lookedUpAt: "now", url: "u" } as const }
      : {}),
  };
}

const ctx: EvidenceContext = {
  familyResolved: true,
  descriptionCoverage: 0.9,
  scored: [
    { code: "6109.10.00", conflicts: [] },
    { code: "6205.20.00", conflicts: ["Woven shirt, not knitted"] },
  ],
  aiUsed: true,
  aiSelectedCode: "6109.10.00",
  aiConfidence: 0.9,
  history: null,
};

describe("buildCandidateEvidence", () => {
  it("derives agreement, rank, compatibility and verification for the AI pick", () => {
    const e = buildCandidateEvidence(cand("6109.10.00", true), ctx);
    expect(e).toMatchObject({
      historyMatch: null,
      familyResolved: true,
      compatibilityPassed: true,
      contradictions: [],
      retrievalRank: 0,
      aiSelected: true,
      aiConfidence: 0.9,
      dbTopAgrees: true,
      officialVerified: true,
      historyConflict: false,
    });
  });

  it("matches codes regardless of spacing and case", () => {
    expect(buildCandidateEvidence(cand("6109 10 00"), ctx).retrievalRank).toBe(0);
  });

  it("marks alternatives as not AI-selected and carries their conflicts", () => {
    const e = buildCandidateEvidence(cand("6205.20.00"), ctx);
    expect(e.aiSelected).toBe(false);
    expect(e.aiConfidence).toBeNull();
    expect(e.compatibilityPassed).toBe(false);
    expect(e.contradictions).toEqual(["Woven shirt, not knitted"]);
  });

  it("reports AI disagreement with the database top candidate", () => {
    const e = buildCandidateEvidence(cand("6205.20.00"), { ...ctx, aiSelectedCode: "6205.20.00" });
    expect(e.dbTopAgrees).toBe(false);
  });

  it("leaves agreement unknown when AI was not used", () => {
    const e = buildCandidateEvidence(cand("6109.10.00"), { ...ctx, aiUsed: false, aiSelectedCode: null, aiConfidence: null });
    expect(e.dbTopAgrees).toBeNull();
    expect(e.aiSelected).toBe(false);
  });

  it("treats a code that was not retrieved as not compatibility-checked", () => {
    const e = buildCandidateEvidence(cand("9999.99.99"), ctx);
    expect(e.retrievalRank).toBeNull();
    expect(e.compatibilityPassed).toBe(false);
  });

  it("flags history match and history conflict", () => {
    const history = { code: "6109.10.00", source: "supplier_history" as const, confirmations: 2 };
    expect(buildCandidateEvidence(cand("6109.10.00"), { ...ctx, history }).historyMatch).toBe("supplier_history");
    expect(buildCandidateEvidence(cand("6205.20.00"), { ...ctx, history }).historyConflict).toBe(true);
  });

  it("carries history confirmations only for the candidate that matches history", () => {
    const history = { code: "6109.10.00", source: "learned" as const, confirmations: 2 };
    expect(buildCandidateEvidence(cand("6109 10 00"), { ...ctx, history }).historyConfirmations).toBe(2);
    expect(buildCandidateEvidence(cand("6205.20.00"), { ...ctx, history }).historyConfirmations).toBe(0);
    expect(buildCandidateEvidence(cand("6109.10.00"), ctx).historyConfirmations).toBe(0);
  });

  it("calibrates a once-applied history match as Likely and a twice-applied one as Strong", () => {
    const once = { code: "6109.10.00", source: "learned" as const, confirmations: 1 };
    const twice = { ...once, confirmations: 2 };
    expect(calibrateCandidate(cand("6109.10.00"), { ...ctx, history: once }, false).confidenceLabel).toBe("Likely Match");
    expect(calibrateCandidate(cand("6109.10.00"), { ...ctx, history: twice }, false).confidenceLabel).toBe("Strong Match");
  });

  it("does not count cached TTBizLink results as verified", () => {
    const c = cand("6109.10.00");
    c.officialVerification = { source: "ttbizlink", status: "cached", lookedUpAt: "now", url: "u" };
    expect(buildCandidateEvidence(c, ctx).officialVerified).toBe(false);
  });
});

describe("calibrateCandidate", () => {
  it("replaces raw AI confidence with the calibrated score and label", () => {
    const out = calibrateCandidate(cand("6205.20.00"), ctx, false);
    expect(out.confidence).toBeLessThan(0.85);
    expect(out.confidenceLabel).not.toBe("Strong Match");
    expect(out.evidence?.contradictions).toEqual(["Woven shirt, not knitted"]);
    expect(out.confidenceSignals?.length).toBeGreaterThan(0);
  });

  it("does not mutate the input candidate", () => {
    const input = cand("6109.10.00", true);
    calibrateCandidate(input, ctx, false);
    expect(input.evidence).toBeUndefined();
    expect(input.confidence).toBe(0.99);
  });
});
