import type { CandidateEvidence, ConfidenceLabel } from "@pas/shared-types";

export const STRONG_MATCH_THRESHOLD = 0.85;
const LIKELY_THRESHOLD = 0.6;
const POSSIBLE_THRESHOLD = 0.45;
const HISTORY_SCORE = 0.96;
const MAX_SCORE = 0.98;
const VAGUE_COVERAGE = 0.5;

const HISTORY_SIGNAL: Record<NonNullable<CandidateEvidence["historyMatch"]>, string> = {
  supplier_history: "Matches approved supplier history",
  learned: "Matches a code the team approved before",
  supplier_evidence: "Matches approved supplier product record",
};

export function labelForScore(score: number): ConfidenceLabel {
  if (score >= STRONG_MATCH_THRESHOLD) return "Strong Match";
  if (score >= LIKELY_THRESHOLD) return "Likely Match";
  if (score >= POSSIBLE_THRESHOLD) return "Possible Match";
  return "More Information Needed";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function calibrateConfidence(
  evidence: CandidateEvidence,
  opts: { provisional?: boolean } = {},
): { score: number; label: ConfidenceLabel; signals: string[] } {
  const signals: string[] = [];
  const contradicted = evidence.contradictions.length > 0;
  let score: number;
  let historyShortCircuit = false;

  if (evidence.historyMatch && !contradicted && !evidence.historyConflict) {
    historyShortCircuit = true;
    score = HISTORY_SCORE;
    signals.push(HISTORY_SIGNAL[evidence.historyMatch]);
  } else {
    score = 0.3;
    if (evidence.historyMatch) signals.push(HISTORY_SIGNAL[evidence.historyMatch]);
    if (evidence.familyResolved && evidence.compatibilityPassed) {
      score += 0.2;
      signals.push("Product family identified and code is compatible");
    }
    if (evidence.dbTopAgrees === true) {
      score += 0.15;
      signals.push("AI and tariff database agree");
    } else if (evidence.dbTopAgrees === false) {
      score -= 0.15;
      signals.push("AI disagrees with the tariff database ranking");
    } else if (evidence.retrievalRank === 0) {
      score += 0.1;
      signals.push("Top tariff database match");
    }
    if (evidence.aiSelected && evidence.aiConfidence != null) {
      score += 0.2 * clamp(evidence.aiConfidence, 0, 1);
    }
    if (evidence.officialVerified) {
      score += 0.1;
      signals.push("Verified on TTBizLink");
    }
  }

  if (evidence.descriptionCoverage < VAGUE_COVERAGE) {
    score -= 0.15;
    signals.push("Description is vague");
  }
  if (contradicted) {
    score -= 0.3;
    signals.push("Classifier found a conflict with this code");
  }
  if (evidence.historyConflict) {
    score -= 0.25;
    signals.push("Differs from the code approved before for this item");
  }

  score = clamp(score, 0, MAX_SCORE);
  if (!historyShortCircuit && !evidence.officialVerified) {
    score = Math.min(score, STRONG_MATCH_THRESHOLD - 0.01);
  }
  if (opts.provisional) {
    score = Math.min(score, POSSIBLE_THRESHOLD - 0.01);
    signals.push("Missing product details");
  }
  score = Math.round(score * 100) / 100;
  return { score, label: labelForScore(score), signals };
}
