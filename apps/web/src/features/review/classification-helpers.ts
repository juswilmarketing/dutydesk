import type { HeadingCandidate, LineItem, ProductQuestion } from "@pas/shared-types";
import { catFromCode, getTariffRows } from "@pas/tariff-data";
import { domainTariffConflict, type ProductDomain } from "@pas/product-intelligence";

export type ClerkReviewStatus =
  | "confirmed"
  | "ai_suggested"
  | "needs_information"
  | "needs_review"
  | "no_reliable_match"
  | "manually_classified";

export type SuggestionLabel = "Recommended" | "Alternative" | "Low Confidence" | "Rejected";

export type CandidateSourceLabel =
  | "Supplier Exact"
  | "Previous Approved"
  | "Learned Rule"
  | "Product Dictionary"
  | "Tariff Search"
  | "AI Suggested"
  | "Manual"
  | "Product Intelligence";

export type RankedSuggestion = {
  code: string;
  description: string;
  duty: string;
  confidence: number;
  source: CandidateSourceLabel;
  label: SuggestionLabel;
  reason: string;
  supporting: string[];
  conflicting: string[];
  missing: string[];
  rejected: boolean;
};

export type ConfidenceBreakdown = {
  productIdentity: number;
  productFamily: number;
  material: number;
  primaryFunction: number;
  chapter: number;
  heading: number;
  nationalLine: number;
};

export const APPLY_CONFIDENCE_THRESHOLD = 0.72;

export function clerkReviewStatus(item: LineItem): ClerkReviewStatus {
  if (item.status === "loading") return "needs_review";
  if (item.identity_unresolved || (item.pending_questions?.some((q) => q.required) && !hasAnsweredRequired(item))) {
    return "needs_information";
  }
  if (isNoReliableMatch(item)) return "no_reliable_match";
  if (item.source === "manual" && item.tariff_code) return "manually_classified";
  if (
    item.tariff_code &&
    (item.source === "supplier_exact" || item.source === "database" || item.source === "learned") &&
    !item.requires_clerk_review &&
    item.status === "done"
  ) {
    return "confirmed";
  }
  if (item.tariff_code && (item.source === "ai" || item.source === "product_intelligence")) {
    return item.requires_clerk_review || item.status === "needs_review" ? "needs_review" : "ai_suggested";
  }
  if (item.requires_clerk_review || item.status === "needs_review" || item.status === "needs_ai") {
    return "needs_review";
  }
  if (!item.tariff_code) return "needs_review";
  return "ai_suggested";
}

export function reviewStatusLabel(status: ClerkReviewStatus): string {
  const map: Record<ClerkReviewStatus, string> = {
    confirmed: "Confirmed",
    ai_suggested: "AI Suggested",
    needs_information: "Needs Information",
    needs_review: "Needs Review",
    no_reliable_match: "No Reliable Match",
    manually_classified: "Manually Classified",
  };
  return map[status];
}

export function reviewStatusTone(status: ClerkReviewStatus): "green" | "blue" | "gold" | "default" {
  if (status === "confirmed") return "green";
  if (status === "ai_suggested") return "blue";
  if (status === "manually_classified") return "default";
  if (status === "no_reliable_match") return "gold";
  return "gold";
}

function hasAnsweredRequired(item: LineItem): boolean {
  const answers = item.question_answers ?? [];
  const required = (item.pending_questions ?? []).filter((q) => q.required);
  if (!required.length) return true;
  return required.every((q) => {
    const a = answers.find((x) => x.question_id === q.id || x.field === q.field);
    return a && a.value && a.value.toLowerCase() !== "unknown";
  });
}

export function isNoReliableMatch(item: LineItem): boolean {
  if (item.tariff_code) return false;
  const headings = item.predictions?.headings ?? [];
  const top = headings[0];
  if (!headings.length) return true;
  if ((top?.score ?? 0) < 0.45 && (item.match_confidence ?? 0) < 0.45) return true;
  if (item.explainability?.domainConflictWarning && !item.tariff_code) return false;
  return false;
}

export function confidencePct(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(Math.max(0, Math.min(1, n)) * 100);
}

export function confidenceTonePct(pct: number): "green" | "amber" | "red" {
  if (pct >= 80) return "green";
  if (pct >= 60) return "amber";
  return "red";
}

export function buildConfidenceBreakdown(item: LineItem): ConfidenceBreakdown {
  const identity = item.explainability?.identityConfidence ?? (item.identity_unresolved ? 0.25 : 0.7);
  const family =
    item.attribute_confidences?.productFamily ??
    item.attribute_confidences?.product_family ??
    (item.product_profile?.productFamily ? 0.85 : 0.4);
  const material =
    item.attribute_confidences?.material ?? (item.product_profile?.material ? 0.8 : 0.35);
  const fn =
    item.attribute_confidences?.primaryFunction ??
    item.attribute_confidences?.function ??
    (item.product_profile?.primaryFunction ? 0.8 : 0.35);
  const chapter = item.predictions?.chapterConfidence ?? 0;
  const heading = item.predictions?.headings?.[0]?.score ?? 0;
  const national =
    item.match_confidence ??
    item.explainability?.confidence ??
    (item.tariff_code ? heading * 0.85 : heading * 0.5);

  return {
    productIdentity: identity,
    productFamily: typeof family === "number" ? family : 0.4,
    material: typeof material === "number" ? material : 0.35,
    primaryFunction: typeof fn === "number" ? fn : 0.35,
    chapter,
    heading,
    nationalLine: national,
  };
}

function sourceFromItem(item: LineItem): CandidateSourceLabel {
  if (item.match_type === "Supplier Exact" || item.source === "supplier_exact") return "Supplier Exact";
  if (item.match_type === "Supplier Fuzzy" || item.source === "supplier_fuzzy") return "Previous Approved";
  if (item.source === "learned" || item.match_type === "Learning Rules") return "Learned Rule";
  if (item.source === "product_intelligence" || item.match_type === "Product Intelligence") {
    return "Product Intelligence";
  }
  if (item.source === "database") return "Product Dictionary";
  if (item.source === "manual") return "Manual";
  return "AI Suggested";
}

function lookupTariff(code: string): { desc: string; duty: string } {
  const row = getTariffRows().find((r) => r.code === code);
  return { desc: row?.desc || catFromCode(code), duty: row?.duty || "—" };
}

function missingForItem(item: LineItem): string[] {
  const gaps = [...(item.explainability?.gaps ?? [])];
  const unanswered = (item.pending_questions ?? [])
    .filter((q) => q.required)
    .filter((q) => {
      const a = item.question_answers?.find((x) => x.question_id === q.id || x.field === q.field);
      return !a?.value || a.value.toLowerCase() === "unknown";
    })
    .map((q) => q.prompt);
  return [...new Set([...gaps, ...unanswered])].slice(0, 5);
}

export function buildRankedSuggestions(item: LineItem): RankedSuggestion[] {
  const domain = (item.predictions?.domain || item.explainability?.domain || "unknown") as ProductDomain;
  const missing = missingForItem(item);
  const supporting: string[] = [];
  if (item.product_profile?.productType) supporting.push(`Type: ${item.product_profile.productType}`);
  if (item.product_profile?.primaryFunction) supporting.push(`Function: ${item.product_profile.primaryFunction}`);
  if (item.predictions?.chapter) supporting.push(`Chapter ${item.predictions.chapter}`);
  if (item.product_profile?.brand) supporting.push(`Brand: ${item.product_profile.brand}`);

  const out: RankedSuggestion[] = [];
  const seen = new Set<string>();

  const push = (
    partial: Omit<RankedSuggestion, "label" | "rejected" | "conflicting" | "missing"> & {
      label?: SuggestionLabel;
      missing?: string[];
    },
  ) => {
    if (!partial.code || seen.has(partial.code)) return;
    const conflict = domainTariffConflict(domain, partial.code);
    const rejected = conflict.conflict;
    const conf = partial.confidence;
    let label: SuggestionLabel = partial.label || "Alternative";
    if (rejected) label = "Rejected";
    else if (out.filter((s) => !s.rejected).length === 0) label = conf >= 0.6 ? "Recommended" : "Low Confidence";
    else if (conf < 0.55) label = "Low Confidence";
    else label = "Alternative";

    // Skip fuzzy-noise: don't show rejected food conflicts as alternatives for chemical products
    if (rejected && out.length >= 1) return;
    if (!rejected && conf < 0.35 && out.length >= 1) return;

    seen.add(partial.code);
    out.push({
      ...partial,
      label,
      rejected,
      conflicting: conflict.message ? [conflict.message] : [],
      missing: partial.missing ?? missing,
    });
  };

  // Primary: current / AI suggested code
  if (item.tariff_code) {
    const t = lookupTariff(item.tariff_code);
    push({
      code: item.tariff_code,
      description: item.category || t.desc,
      duty: item.duty_rate || t.duty,
      confidence: item.match_confidence ?? item.explainability?.confidence ?? 0.7,
      source: sourceFromItem(item),
      reason: item.notes || item.explainability?.reasoningSummary?.slice(0, 120) || "Current classification",
      supporting,
    });
  }

  // Predicted headings (chapter-gated) — max 3 total
  const headings: HeadingCandidate[] = item.predictions?.headings ?? [];
  for (const h of headings) {
    if (out.length >= 3) break;
    const t = lookupTariff(h.hs_code);
    push({
      code: h.hs_code,
      description: h.title || t.desc,
      duty: h.duty_rate || t.duty,
      confidence: h.score,
      source: "Product Intelligence",
      reason: `Predicted heading ${h.heading} within chapter ${item.predictions?.chapter || "—"}`,
      supporting,
    });
  }

  // Competing headings from AI
  for (const code of item.competing_headings ?? []) {
    if (out.length >= 3) break;
    const t = lookupTariff(code);
    push({
      code,
      description: t.desc,
      duty: t.duty,
      confidence: 0.5,
      source: "AI Suggested",
      reason: "Competing heading considered by AI validation",
      supporting,
    });
  }

  return out.slice(0, 3);
}

export type ApplyBlockReason =
  | "domain_conflict"
  | "low_confidence"
  | "missing_information"
  | "rejected"
  | "no_reliable_match"
  | null;

export function canApplySuggestion(
  item: LineItem,
  suggestion: RankedSuggestion,
): { ok: boolean; reason: ApplyBlockReason; message: string | null } {
  if (suggestion.rejected || suggestion.label === "Rejected") {
    return {
      ok: false,
      reason: "rejected",
      message: suggestion.conflicting[0] || "Candidate rejected by validation rules.",
    };
  }
  const domain = (item.predictions?.domain || item.explainability?.domain || "unknown") as ProductDomain;
  const conflict = domainTariffConflict(domain, suggestion.code);
  if (conflict.conflict) {
    return { ok: false, reason: "domain_conflict", message: conflict.message };
  }
  if (suggestion.confidence < APPLY_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      reason: "low_confidence",
      message: `Confidence ${confidencePct(suggestion.confidence)}% is below the ${confidencePct(APPLY_CONFIDENCE_THRESHOLD)}% apply threshold.`,
    };
  }
  if (!hasAnsweredRequired(item)) {
    return {
      ok: false,
      reason: "missing_information",
      message: "Answer required clarification questions before applying.",
    };
  }
  if (isNoReliableMatch(item) && suggestion.label === "Low Confidence") {
    return {
      ok: false,
      reason: "no_reliable_match",
      message: "No reliable tariff suggestion was found.",
    };
  }
  return { ok: true, reason: null, message: null };
}

export function structuredExplanation(item: LineItem, recommended: RankedSuggestion | null): {
  productType: string;
  recommended: string;
  why: string[];
  uncertainty: string[];
  nextStep: string;
} {
  const profile = item.product_profile;
  const productType =
    profile?.productType ||
    item.parsed_description?.productType ||
    item.explainability?.productFamily ||
    "Unknown product";

  const why: string[] = [];
  if (profile?.primaryFunction) why.push(`Primary function: ${profile.primaryFunction}`);
  if (item.predictions?.chapter) {
    why.push(`Predicted HS chapter ${item.predictions.chapter}${item.predictions.chapterTitle ? ` (${item.predictions.chapterTitle.slice(0, 60)})` : ""}`);
  }
  if (recommended?.source) why.push(`Source: ${recommended.source}`);
  if (item.explainability?.domainLabel) why.push(`Domain: ${item.explainability.domainLabel}`);
  if (!why.length) why.push("Matched available product attributes against tariff heading titles");

  const uncertainty = [
    ...missingForItem(item).slice(0, 3),
    ...(item.explainability?.domainConflictWarning ? [item.explainability.domainConflictWarning] : []),
    ...(item.why_rejected?.slice(0, 2) || []),
  ].slice(0, 4);

  const status = clerkReviewStatus(item);
  let nextStep = "Review the recommendation and apply if correct.";
  if (status === "needs_information") nextStep = "Answer the clarification questions, then update classification.";
  else if (status === "no_reliable_match") {
    nextStep = "Upload a specification/SDS, search previous classifications, or enter a tariff manually.";
  } else if (status === "needs_review") nextStep = "Compare alternatives, then apply or edit the tariff code.";
  else if (status === "confirmed") nextStep = "Line is confirmed — continue to the next item.";

  return {
    productType,
    recommended: recommended
      ? `${recommended.code} — ${recommended.description.slice(0, 80)}`
      : "No reliable tariff suggestion",
    why: why.slice(0, 3),
    uncertainty,
    nextStep,
  };
}

export function clarificationQuestions(item: LineItem): ProductQuestion[] {
  const pending = item.pending_questions ?? [];
  if (pending.length) return pending.slice(0, 4);

  const parsedQs = item.parsed_description?.suggestedQuestions ?? [];
  if (parsedQs.length) return parsedQs.slice(0, 4);

  // Lightweight defaults only when classification-critical gaps exist
  const qs: ProductQuestion[] = [];
  if (!item.product_profile?.productType && !item.parsed_description?.productType) {
    qs.push({
      id: "clarify_product_type",
      field: "product_type",
      prompt: "What is the product?",
      required: true,
    });
  }
  if (!item.product_profile?.primaryFunction) {
    qs.push({
      id: "clarify_function",
      field: "primary_function",
      prompt: "What is the primary function?",
      options: ["Cleaning", "Polishing", "Rust removal", "Protective coating", "Other", "Unknown"],
      required: true,
    });
  }
  if (!item.product_profile?.material && item.product_profile?.chemical) {
    qs.push({
      id: "clarify_form",
      field: "physical_form",
      prompt: "What is the physical form?",
      options: ["Liquid", "Paste or cream", "Powder", "Aerosol", "Other", "Unknown"],
      required: false,
    });
  }
  return qs.slice(0, 3);
}

export function shortDescription(desc: string, max = 48): string {
  const t = desc.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
