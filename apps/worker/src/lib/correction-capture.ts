import type { ConfidenceLabel } from "@pas/shared-types";

export interface CorrectionInput {
  description: string;
  supplier: string | null;
  appliedCode: string;
  /** Line state before this apply. */
  previousStatus: string | null;
  previousCode: string | null;
  /** Confidence label recorded when the previous code was applied. */
  previousLabel: ConfidenceLabel | null;
  /** Top candidate of the latest stored recommendation for this line. */
  suggestedCode: string | null;
  suggestedLabel: ConfidenceLabel | null;
}

export interface CorrectionCase {
  kind: "changed_applied" | "rejected_suggestion";
  rawDescription: string;
  supplier: string | null;
  expectedTariff: string;
  expectedHeading: string;
  expectedChapter: string;
  replacedCode: string;
  replacedLabel: ConfidenceLabel | null;
  notes: string;
}

const CONFIDENCE_LABELS: readonly ConfidenceLabel[] = [
  "Strong Match",
  "Likely Match",
  "Possible Match",
  "More Information Needed",
];

/** Returns the value only if it is a known confidence label; client/stored JSON is untrusted. */
export function asConfidenceLabel(value: unknown): ConfidenceLabel | null {
  return typeof value === "string" && (CONFIDENCE_LABELS as readonly string[]).includes(value)
    ? (value as ConfidenceLabel)
    : null;
}

export function codeDigits(code: string | null | undefined): string {
  return String(code ?? "").replace(/\D/g, "");
}

function withLabel(code: string, label: ConfidenceLabel | null): string {
  return label ? `${code} (${label})` : code;
}

export function detectCorrection(input: CorrectionInput): CorrectionCase | null {
  const applied = codeDigits(input.appliedCode);
  const description = input.description.trim();
  if (applied.length < 4 || !description) return null;
  const base = {
    rawDescription: description,
    supplier: input.supplier?.trim() || null,
    expectedTariff: input.appliedCode,
    expectedHeading: applied.slice(0, 4),
    expectedChapter: applied.slice(0, 2),
  };

  const previous = codeDigits(input.previousCode);
  if (input.previousStatus === "Applied" && previous) {
    if (previous === applied) return null;
    return {
      ...base,
      kind: "changed_applied",
      replacedCode: input.previousCode!,
      replacedLabel: input.previousLabel,
      notes: `Clerk changed applied code ${withLabel(input.previousCode!, input.previousLabel)} to ${input.appliedCode}`,
    };
  }

  const suggested = codeDigits(input.suggestedCode);
  if (suggested && suggested !== applied) {
    return {
      ...base,
      kind: "rejected_suggestion",
      replacedCode: input.suggestedCode!,
      replacedLabel: input.suggestedLabel,
      notes: `Clerk rejected suggestion ${withLabel(input.suggestedCode!, input.suggestedLabel)}; applied ${input.appliedCode}`,
    };
  }
  return null;
}

export function suggestedTop(
  recommendedCandidateJson: string | null | undefined,
): { code: string; label: ConfidenceLabel | null } | null {
  if (!recommendedCandidateJson) return null;
  try {
    const parsed = JSON.parse(recommendedCandidateJson) as { code?: unknown; confidenceLabel?: unknown } | null;
    if (!parsed || typeof parsed.code !== "string" || !parsed.code) return null;
    return {
      code: parsed.code,
      label: asConfidenceLabel(parsed.confidenceLabel),
    };
  } catch {
    return null;
  }
}
