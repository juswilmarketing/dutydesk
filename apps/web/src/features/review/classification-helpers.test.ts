import { describe, expect, it } from "vitest";
import type {
  CandidateEvidence,
  ClassificationRecommendationCandidate,
  ProductQuestion,
  ProductQuestionAnswer,
} from "@pas/shared-types";
import { isAutoApplyable } from "./classification-helpers";

type Item = Parameters<typeof isAutoApplyable>[0];

const requiredQ: ProductQuestion = {
  id: "identity_product_type",
  field: "product_type",
  prompt: "What type of product is this?",
  required: true,
};
const optionalQ: ProductQuestion = {
  id: "identity_catalogue",
  field: "catalogue",
  prompt: "Catalogue or model number?",
  required: false,
};

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
  historyConfirmations: 0,
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
    const c = candidate({ evidence: { ...evidence, historyMatch: "learned", historyConfirmations: 2, familyResolved: false, compatibilityPassed: false } });
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
    ["unanswered required question on line", item({ pending_questions: [requiredQ] }), candidate()],
    ["history candidate with contradictions", item(), candidate({ evidence: { ...evidence, historyMatch: "learned", contradictions: ["x"] } })],
    ["history candidate with history conflict", item(), candidate({ evidence: { ...evidence, historyMatch: "learned", historyConflict: true } })],
    ["question on recommendation", item({ classification_recommendation: { status: "recommended", question: { id: "m", prompt: "p", options: [] }, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status clarification_needed", item({ classification_recommendation: { status: "clarification_needed", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status unable_to_classify", item({ classification_recommendation: { status: "unable_to_classify", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["line status More Information Needed", item({ classification_status: "More Information Needed" }), candidate()],
  ])("rejects: %s", (_name, it_, cand) => {
    expect(isAutoApplyable(it_, cand)).toBe(false);
  });

  it("accepts when the only line question is optional", () => {
    expect(isAutoApplyable(item({ pending_questions: [optionalQ] }), candidate())).toBe(true);
  });

  it("accepts when the required question is answered", () => {
    const answers: ProductQuestionAnswer[] = [{ question_id: "identity_product_type", field: "product_type", value: "T-shirt" }];
    expect(isAutoApplyable(item({ pending_questions: [requiredQ], question_answers: answers }), candidate())).toBe(true);
  });

  it("accepts history candidates despite unanswered required line questions", () => {
    const c = candidate({ evidence: { ...evidence, historyMatch: "learned", historyConfirmations: 2, familyResolved: false, compatibilityPassed: false } });
    expect(isAutoApplyable(item({ pending_questions: [requiredQ, optionalQ] }), c)).toBe(true);
  });

  it("rejects history applied only once despite an unanswered required question", () => {
    const c = candidate({ evidence: { ...evidence, historyMatch: "learned", historyConfirmations: 1 } });
    expect(isAutoApplyable(item({ pending_questions: [requiredQ] }), c)).toBe(false);
  });

  it("rejects once-applied history without family/compatibility evidence", () => {
    const c = candidate({
      evidence: { ...evidence, historyMatch: "learned", historyConfirmations: 1, familyResolved: false, compatibilityPassed: false },
    });
    expect(isAutoApplyable(item(), c)).toBe(false);
  });

  it("treats cached history evidence without historyConfirmations as unconfirmed", () => {
    const { historyConfirmations: _omit, ...cached } = { ...evidence, historyMatch: "learned" as const };
    const c = candidate({ evidence: cached as CandidateEvidence });
    expect(isAutoApplyable(item({ pending_questions: [requiredQ] }), c)).toBe(false);
  });

  it("rejects non-history candidates with an unanswered required question among optional ones", () => {
    expect(isAutoApplyable(item({ pending_questions: [optionalQ, requiredQ] }), candidate())).toBe(false);
  });

  it("accepts confidence of exactly 0.85", () => {
    expect(isAutoApplyable(item(), candidate({ confidence: 0.85 }))).toBe(true);
  });

  it("treats missing evidence.contradictions as safe", () => {
    const c = candidate({ evidence: { ...evidence, contradictions: undefined as unknown as string[] } });
    expect(isAutoApplyable(item(), c)).toBe(true);
  });

  it("ignores recommendation_source (old shortcut removed)", () => {
    expect(isAutoApplyable(item({ recommendation_source: "ai_recommendation" }), candidate({ confidenceLabel: "Possible Match" }))).toBe(false);
  });
});
