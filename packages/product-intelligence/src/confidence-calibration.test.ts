import { describe, expect, it } from "vitest";
import type { CandidateEvidence } from "@pas/shared-types";
import { calibrateConfidence, STRONG_MATCH_THRESHOLD } from "./confidence-calibration";

const base: CandidateEvidence = {
  historyMatch: null,
  familyResolved: false,
  compatibilityPassed: false,
  contradictions: [],
  retrievalRank: null,
  aiSelected: false,
  aiConfidence: null,
  dbTopAgrees: null,
  officialVerified: false,
  descriptionCoverage: 0.8,
  historyConflict: false,
};

const fullyCorroborated: CandidateEvidence = {
  ...base,
  familyResolved: true,
  compatibilityPassed: true,
  retrievalRank: 0,
  aiSelected: true,
  aiConfidence: 0.9,
  dbTopAgrees: true,
  officialVerified: true,
};

describe("calibrateConfidence", () => {
  it("treats approved history as Strong", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "supplier_history" });
    expect(r.label).toBe("Strong Match");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.signals).toContain("Matches approved supplier history");
  });

  it("does not trust history that the classifier contradicts", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", contradictions: ["Chapter 22 is excluded"] });
    expect(r.label).not.toBe("Strong Match");
  });

  it("rates a fully corroborated AI pick as Strong", () => {
    const r = calibrateConfidence(fullyCorroborated);
    expect(r.label).toBe("Strong Match");
    expect(r.score).toBeGreaterThanOrEqual(STRONG_MATCH_THRESHOLD);
  });

  it("does not let raw AI confidence alone reach Strong", () => {
    const r = calibrateConfidence({ ...base, aiSelected: true, aiConfidence: 0.99, retrievalRank: 0, dbTopAgrees: true });
    expect(r.label).not.toBe("Strong Match");
  });

  it("needs official verification for a non-history Strong", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, officialVerified: false });
    expect(r.label).toBe("Likely Match");
  });

  it("does not reach Strong without TTBizLink when AI confidence is maxed", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, officialVerified: false, aiConfidence: 1.0 });
    expect(r.label).not.toBe("Strong Match");
    expect(r.score).toBeLessThanOrEqual(0.84);
  });

  it("does not reach Strong without TTBizLink at high AI confidence", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, officialVerified: false, aiConfidence: 0.975 });
    expect(r.label).not.toBe("Strong Match");
  });

  it("still allows Strong on history path without TTBizLink verification", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", officialVerified: false });
    expect(r.label).toBe("Strong Match");
  });

  it("penalises AI disagreeing with the database", () => {
    const agree = calibrateConfidence(fullyCorroborated).score;
    const disagree = calibrateConfidence({ ...fullyCorroborated, dbTopAgrees: false }).score;
    expect(disagree).toBeLessThan(agree - 0.2);
    expect(calibrateConfidence({ ...fullyCorroborated, dbTopAgrees: false }).signals)
      .toContain("AI disagrees with the tariff database ranking");
  });

  it("penalises vague descriptions", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, descriptionCoverage: 0.3 });
    expect(r.label).not.toBe("Strong Match");
    expect(r.signals).toContain("Description is vague");
  });

  it("penalises contradictions and history conflicts", () => {
    expect(calibrateConfidence({ ...fullyCorroborated, contradictions: ["x"] }).label).not.toBe("Strong Match");
    expect(calibrateConfidence({ ...fullyCorroborated, historyConflict: true }).label).not.toBe("Strong Match");
  });

  it("caps provisional candidates below Possible", () => {
    const r = calibrateConfidence(fullyCorroborated, { provisional: true });
    expect(r.label).toBe("More Information Needed");
    expect(r.score).toBeLessThan(0.45);
  });

  it("rates a retrieval-only top hit with a resolved family as Likely at best", () => {
    const r = calibrateConfidence({ ...base, familyResolved: true, compatibilityPassed: true, retrievalRank: 0 });
    expect(["Likely Match", "Possible Match"]).toContain(r.label);
  });

  it("keeps scores within 0..0.98", () => {
    const hi = calibrateConfidence({ ...fullyCorroborated, historyMatch: "supplier_history" }).score;
    const lo = calibrateConfidence({ ...base, dbTopAgrees: false, descriptionCoverage: 0, contradictions: ["a"], historyConflict: true }).score;
    expect(hi).toBeLessThanOrEqual(0.98);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
});
