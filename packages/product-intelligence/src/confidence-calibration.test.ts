import { describe, expect, it } from "vitest";
import type { CandidateEvidence } from "@pas/shared-types";
import { calibrateConfidence, HISTORY_CONFIRMATIONS_REQUIRED, STRONG_MATCH_THRESHOLD } from "./confidence-calibration";

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
  historyConfirmations: 0,
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
  it("requires two hand-applies before history counts as approved", () => {
    expect(HISTORY_CONFIRMATIONS_REQUIRED).toBe(2);
  });

  it("treats history applied twice as Strong", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "supplier_history", historyConfirmations: 2 });
    expect(r.label).toBe("Strong Match");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.signals).toContain("Matches approved supplier history");
  });

  it("rates history applied once as Likely 0.75 and asks to confirm", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", historyConfirmations: 1 });
    expect(r.label).toBe("Likely Match");
    expect(r.score).toBe(0.75);
    expect(r.signals).toContain("Applied once before for this item — confirm");
  });

  it("words a supplier product record honestly: Likely 0.75, own signal, no 'applied before'", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "supplier_evidence", historyConfirmations: 1 });
    expect(r.label).toBe("Likely Match");
    expect(r.score).toBe(0.75);
    expect(r.signals).toContain("Matches this supplier's product record — confirm");
    expect(r.signals).not.toContain("Applied once before for this item — confirm");
    expect(r.signals).not.toContain("Matches approved supplier product record");
  });

  it("uses the supplier-record signal when that history is contradicted", () => {
    const r = calibrateConfidence({
      ...base,
      historyMatch: "supplier_evidence",
      historyConfirmations: 1,
      contradictions: ["x"],
    });
    expect(r.signals).toContain("Matches this supplier's product record — confirm");
    expect(r.signals).not.toContain("Applied once before for this item — confirm");
  });

  it("does not let vague unconfirmed history reach Strong", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", historyConfirmations: 1, descriptionCoverage: 0.3 });
    expect(r.label).toBe("Likely Match");
    expect(r.score).toBe(0.6);
    expect(r.signals).toContain("Description is vague");
  });

  it("caps provisional unconfirmed history below Possible", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", historyConfirmations: 1 }, { provisional: true });
    expect(r.label).toBe("More Information Needed");
  });

  it("treats evidence without historyConfirmations as unconfirmed", () => {
    const { historyConfirmations: _omit, ...legacy } = { ...base, historyMatch: "learned" as const };
    const r = calibrateConfidence(legacy as CandidateEvidence);
    expect(r.label).not.toBe("Strong Match");
    expect(r.score).toBe(0.75);
  });

  it("does not trust history that the classifier contradicts", () => {
    const r = calibrateConfidence({
      ...base,
      historyMatch: "learned",
      historyConfirmations: 2,
      contradictions: ["Chapter 22 is excluded"],
    });
    expect(r.label).not.toBe("Strong Match");
  });

  it("does not call contradicted or conflicting once-applied history approved", () => {
    const once = { ...base, historyMatch: "learned" as const, historyConfirmations: 1 };
    for (const r of [
      calibrateConfidence({ ...once, contradictions: ["x"] }),
      calibrateConfidence({ ...once, historyConflict: true }),
    ]) {
      expect(r.signals).toContain("Applied once before for this item — confirm");
      expect(r.signals).not.toContain("Matches a code the team approved before");
    }
  });

  it("keeps the approved signal on contradicted history that was applied twice", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", historyConfirmations: 2, contradictions: ["x"] });
    expect(r.signals).toContain("Matches a code the team approved before");
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
    const r = calibrateConfidence({ ...base, historyMatch: "learned", historyConfirmations: 2, officialVerified: false });
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
    const hi = calibrateConfidence({ ...fullyCorroborated, historyMatch: "supplier_history", historyConfirmations: 2 }).score;
    const lo = calibrateConfidence({ ...base, dbTopAgrees: false, descriptionCoverage: 0, contradictions: ["a"], historyConflict: true }).score;
    expect(hi).toBeLessThanOrEqual(0.98);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
});
