import type { SimpleRecommendationStatus } from "@pas/shared-types";

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
