import type { SimpleRecommendationStatus } from "@pas/shared-types";

/** Maps API recommendation status to the line queue label stored on classification_lines. */
export function classificationLineStatusForRecommendation(
  status: SimpleRecommendationStatus,
): string {
  if (status === "clarification_needed") return "More Information Needed";
  if (status === "unable_to_classify" || status === "no_reliable_match") return "Needs Manual Review";
  if (status === "provisional") return "Provisional Suggestion";
  return "Suggestion Ready";
}

/** Status for the AI-ranked branch; mirrors how the candidates themselves are calibrated (provisional when unparsed). */
export function aiResponseStatus(input: {
  question: unknown;
  provisional: boolean;
  selectedConfidence: number;
  parsed: boolean;
}): SimpleRecommendationStatus {
  if (input.question && input.provisional) return "clarification_needed";
  const candidateProvisional = input.provisional || input.selectedConfidence < 0.55 || !input.parsed;
  return candidateProvisional ? "provisional" : "recommended";
}
