import type { HeadingCandidate } from "@pas/tariff-data";

export type AiRankingParsed = {
  selectedCode?: string | null;
  confidence?: number;
  reason?: string;
  altReasons?: Record<string, string>;
};

export type AiRankingOutcome =
  | {
      kind: "picked";
      selected: HeadingCandidate;
      confidence: number;
      reason: string;
      altReasons: Record<string, string>;
    }
  | { kind: "abstain"; reason: string }
  | {
      kind: "retrieval_fallback";
      selected: HeadingCandidate;
      confidence: number;
      reason: string;
    };

const RETRIEVAL_FALLBACK_REASON =
  "Provisional retrieved match — confirm missing attributes before relying on this code.";

/** Resolve AI JSON + retrieved candidates into pick, abstain, or retrieval-only fallback. */
export function resolveAiRankingOutcome(input: {
  parsed: AiRankingParsed | null;
  rawSelected: string | null | undefined;
  selectedFromList: HeadingCandidate | null;
  candidates: HeadingCandidate[];
  defaultReason: string;
}): AiRankingOutcome {
  const { parsed, rawSelected, selectedFromList, candidates, defaultReason } = input;

  if (selectedFromList) {
    const confidence = Number.isFinite(parsed?.confidence)
      ? Number(parsed!.confidence)
      : selectedFromList.score;
    return {
      kind: "picked",
      selected: selectedFromList,
      confidence,
      reason: parsed?.reason || defaultReason,
      altReasons: parsed?.altReasons || {},
    };
  }

  // Valid JSON but no allowed code: do not attach the AI reason to a wrong retrieved candidate.
  if (parsed) {
    return {
      kind: "abstain",
      reason:
        parsed.reason?.trim()
        || "None of the retrieved tariff candidates fit this product — use tariff search or add missing details.",
    };
  }

  const top = candidates[0];
  if (!top) {
    return {
      kind: "abstain",
      reason: "No tariff candidates were retrieved for this description.",
    };
  }

  return {
    kind: "retrieval_fallback",
    selected: top,
    confidence: Math.min(top.score, 0.55),
    reason: RETRIEVAL_FALLBACK_REASON,
  };
}

/** Whether rawSelected was an explicit null/empty abstention (vs missing field). */
export function aiExplicitlyAbstained(
  parsed: AiRankingParsed | null,
  rawSelected: string | null | undefined,
): boolean {
  if (!parsed) return false;
  if (rawSelected == null) return true;
  const s = String(rawSelected).trim();
  return s === "" || /^null$/i.test(s);
}
