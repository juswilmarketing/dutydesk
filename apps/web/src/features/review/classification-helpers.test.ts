import { describe, expect, it } from "vitest";
import type { CandidateEvidence, ClassificationRecommendationCandidate } from "@pas/shared-types";
import { isAutoApplyable } from "./classification-helpers";

type Item = Parameters<typeof isAutoApplyable>[0];

const evidence: CandidateEvidence = {
  historyMatch: null,
  familyResolved: true,
  compatibilityPassed: true,
  contradictions: [],
  retrievalRank: 0,
  aiSelected: true,
  aiConfidence: 0.9,
  dbTopAgrees: true,
  officialVerified: true,
  descriptionCoverage: 0.9,
  historyConflict: false,
};

function candidate(over: Partial<ClassificationRecommendationCandidate> = {}): ClassificationRecommendationCandidate {
  return {
    code: "6109.10.00",
    description: "T-shirts of cotton",
    chapter: "61",
    dutyRate: 20,
    vatRate: 12.5,
    reason: "r",
    source: "ai",
    confidence: 0.9,
    confidenceLabel: "Strong Match",
    provisional: false,
    evidence,
    ...over,
  };
}

function item(over: Record<string, unknown> = {}): Item {
  return {
    id: 1,
    desc: "cotton t-shirts",
    tariff_code: null,
    classification_status: "Suggestion Ready",
    classification_conflict: false,
    pending_questions: [],
    classification_recommendation: { status: "recommended", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] },
    ...over,
  } as unknown as Item;
}

describe("isAutoApplyable", () => {
  it("accepts a fully corroborated Strong candidate", () => {
    expect(isAutoApplyable(item(), candidate())).toBe(true);
  });

  it("accepts approved history even without family/compatibility", () => {
    const c = candidate({ evidence: { ...evidence, historyMatch: "learned", familyResolved: false, compatibilityPassed: false } });
    expect(isAutoApplyable(item(), c)).toBe(true);
  });

  it.each([
    ["no candidate", item(), null],
    ["label not Strong", item(), candidate({ confidenceLabel: "Likely Match" })],
    ["confidence below 0.85", item(), candidate({ confidence: 0.84 })],
    ["missing confidence", item(), candidate({ confidence: undefined as unknown as number })],
    ["provisional", item(), candidate({ provisional: true })],
    ["no evidence (cached before calibration)", item(), candidate({ evidence: undefined })],
    ["family not resolved", item(), candidate({ evidence: { ...evidence, familyResolved: false } })],
    ["compatibility failed", item(), candidate({ evidence: { ...evidence, compatibilityPassed: false } })],
    ["contradictions", item(), candidate({ evidence: { ...evidence, contradictions: ["x"] } })],
    ["history conflict", item(), candidate({ evidence: { ...evidence, historyConflict: true } })],
    ["line conflict flag", item({ classification_conflict: true }), candidate()],
    ["pending question on line", item({ pending_questions: [{ id: "material" }] }), candidate()],
    ["question on recommendation", item({ classification_recommendation: { status: "recommended", question: { id: "m", prompt: "p", options: [] }, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status clarification_needed", item({ classification_recommendation: { status: "clarification_needed", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status unable_to_classify", item({ classification_recommendation: { status: "unable_to_classify", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["line status More Information Needed", item({ classification_status: "More Information Needed" }), candidate()],
  ])("rejects: %s", (_name, it_, cand) => {
    expect(isAutoApplyable(it_, cand)).toBe(false);
  });

  it("ignores recommendation_source (old shortcut removed)", () => {
    expect(isAutoApplyable(item({ recommendation_source: "ai_recommendation" }), candidate({ confidenceLabel: "Possible Match" }))).toBe(false);
  });
});
