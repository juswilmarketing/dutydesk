import type { CandidateEvidence, ClassificationRecommendationCandidate } from "@pas/shared-types";
import { calibrateConfidence } from "@pas/product-intelligence";

export interface EvidenceContext {
  familyResolved: boolean;
  descriptionCoverage: number;
  /** Database retrieval ranking after the compatibility filter, best first. */
  scored: Array<{ code: string; conflicts: string[] }>;
  aiUsed: boolean;
  aiSelectedCode: string | null;
  aiConfidence: number | null;
  history: { code: string; source: CandidateEvidence["historyMatch"] } | null;
}

function key(code: string): string {
  return code.replace(/[\s.]/g, "").toUpperCase();
}

export function buildCandidateEvidence(
  candidate: ClassificationRecommendationCandidate,
  ctx: EvidenceContext,
): CandidateEvidence {
  const code = key(candidate.code);
  const rank = ctx.scored.findIndex((s) => key(s.code) === code);
  const hit = rank >= 0 ? ctx.scored[rank] : null;
  const contradictions = hit?.conflicts ?? [];
  const aiSelected = ctx.aiUsed && ctx.aiSelectedCode != null && key(ctx.aiSelectedCode) === code;
  const dbTop = ctx.scored[0] ? key(ctx.scored[0].code) : null;
  const historyCode = ctx.history ? key(ctx.history.code) : null;
  return {
    historyMatch: historyCode === code ? ctx.history!.source : null,
    familyResolved: ctx.familyResolved,
    compatibilityPassed: hit != null && contradictions.length === 0,
    contradictions,
    retrievalRank: rank >= 0 ? rank : null,
    aiSelected,
    aiConfidence: aiSelected ? ctx.aiConfidence : null,
    dbTopAgrees: ctx.aiUsed && ctx.aiSelectedCode != null && dbTop != null ? key(ctx.aiSelectedCode) === dbTop : null,
    officialVerified: candidate.officialVerification?.status === "verified",
    descriptionCoverage: ctx.descriptionCoverage,
    historyConflict: historyCode != null && historyCode !== code,
  };
}

export function calibrateCandidate(
  candidate: ClassificationRecommendationCandidate,
  ctx: EvidenceContext,
  provisional: boolean,
): ClassificationRecommendationCandidate {
  const evidence = buildCandidateEvidence(candidate, ctx);
  const { score, label, signals } = calibrateConfidence(evidence, { provisional });
  return { ...candidate, evidence, confidence: score, confidenceLabel: label, confidenceSignals: signals };
}
