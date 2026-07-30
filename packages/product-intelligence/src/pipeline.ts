import type {
  AttributeLearningEntry,
  ClassificationExplainability,
  InferredAttribute,
  LiquidCompositionConflict,
  LiquidCompositionConfidences,
  LiquidCompositionLearningEntry,
  LiquidProductProfile,
  LineContextSummary,
  ParsedLineDescription,
  ProductPrediction,
  ProductProfile,
  ProductQuestion,
  ProductQuestionAnswer,
  SupplierClassificationEntry,
} from "@pas/shared-types";
import { normalizeDesc } from "@pas/tariff-data";
import type { DictionaryBundle } from "./dictionaries";
import { loadSeedDictionaries } from "./dictionaries";
import { buildProductProfile, selectQuestions } from "./profile-builder";
import { buildPrediction } from "./predict";
import { runAttributeEngine } from "./attribute-engine";
import { runLiquidCompositionEngine } from "./liquid-engine";
import { resolveProductIdentity } from "./identity-resolver";
import { domainTariffConflict, isFoodChapter, type ProductDomain } from "./domain";

/** Inferred category labels that must not unblock an unresolved product identity. */
const GENERIC_PRODUCT_TYPES = new Set([
  "vehicle article",
  "electrical article",
  "construction material",
  "general goods",
  "food product",
  "textile article",
  "chemical preparation",
  "machinery/tool",
  "polishing preparation",
]);

function isConcreteProductType(type: string | null | undefined): boolean {
  if (!type?.trim()) return false;
  return !GENERIC_PRODUCT_TYPES.has(type.trim().toLowerCase());
}

export interface ProductIntelligenceInput {
  line_id: number;
  description: string;
  supplier?: string | null;
  part_number?: string | null;
  model_number?: string | null;
  answers?: ProductQuestionAnswer[];
  supplierHistory?: SupplierClassificationEntry[];
  dictionaries?: DictionaryBundle;
  attributeLearning?: AttributeLearningEntry[];
  liquidLearning?: LiquidCompositionLearningEntry | null;
  adjacentDescriptions?: string[];
  documentSnippets?: Array<{
    source: "SDS" | "COA" | "label" | "product specification" | "TDS" | "catalogue" | "packing list";
    text: string;
  }>;
}

export interface ProductIntelligenceResult {
  line_id: number;
  profile: ProductProfile;
  predictions: ProductPrediction;
  pending_questions: ProductQuestion[];
  explainability: ClassificationExplainability;
  skip_ai: boolean;
  suggested_hs_code: string | null;
  duty_rate: string | null;
  confidence: number;
  knowledgeSources: string[];
  supplier_history_id?: number;
  supplier_usage_count?: number;
  path: string[];
  attribute_confidences?: Record<string, number>;
  inferred_attributes?: InferredAttribute[];
  liquid_profile?: LiquidProductProfile;
  liquid_confidences?: LiquidCompositionConfidences;
  liquid_conflicts?: LiquidCompositionConflict[];
  liquid_requires_review?: boolean;
  parsed_description?: ParsedLineDescription;
  line_context?: LineContextSummary;
  identity_unresolved?: boolean;
}

function supplierBoost(
  description: string,
  supplier: string | null | undefined,
  history: SupplierClassificationEntry[] | undefined,
): { hs?: string; duty?: string; id?: number; usage?: number; confidence: number } | null {
  if (!supplier || !history?.length) return null;
  const norm = normalizeDesc(description);
  const supplierNorm = supplier.toLowerCase();
  const matches = history.filter(
    (h) =>
      !h.disabled &&
      h.supplier_name.toLowerCase().includes(supplierNorm.split(" ")[0] || supplierNorm) &&
      (normalizeDesc(h.item_description) === norm ||
        normalizeDesc(h.item_description).includes(norm) ||
        norm.includes(normalizeDesc(h.item_description))),
  );
  if (!matches.length) return null;
  matches.sort((a, b) => b.usage_count - a.usage_count);
  const best = matches[0];
  return {
    hs: best.hs_code,
    duty: best.duty_rate,
    id: best.id,
    usage: best.usage_count,
    confidence: Math.min(0.98, 0.75 + Math.min(best.usage_count, 10) * 0.02),
  };
}

function mergeQuestions(a: ProductQuestion[], b: ProductQuestion[], max = 6): ProductQuestion[] {
  const out: ProductQuestion[] = [];
  const seen = new Set<string>();
  for (const q of [...a, ...b]) {
    if (seen.has(q.field) || seen.has(q.id)) continue;
    out.push(q);
    seen.add(q.field);
    seen.add(q.id);
    if (out.length >= max) break;
  }
  return out;
}

function enrichProfileFromIdentity(
  profile: ProductProfile,
  parsed: ParsedLineDescription,
): ProductProfile {
  return {
    ...profile,
    brand: parsed.brandOrProductFamily || profile.brand,
    partNumber: parsed.partNumber || profile.partNumber,
    model: parsed.sku || parsed.modelNumber || profile.model,
    material: parsed.material || profile.material,
    productType: parsed.productType || profile.productType,
    primaryFunction: parsed.function || profile.primaryFunction,
    primaryUse: parsed.function || profile.primaryUse,
    productFamily: parsed.productType || profile.productFamily,
    normalizedName: parsed.normalizedDescription || profile.normalizedName,
    attributes: {
      ...profile.attributes,
      thickness: parsed.thickness,
      finish: parsed.styleOrFinish,
      colour: parsed.colour.join(", ") || null,
      variant: parsed.variant,
      sku: parsed.sku,
      basePartNumber: parsed.basePartNumber,
      dimensions: parsed.dimensions
        ? `${parsed.dimensions.width}x${parsed.dimensions.length} ${parsed.dimensions.unit}`
        : null,
      identityStatus: parsed.identityStatus,
    },
  };
}

export function runProductIntelligence(input: ProductIntelligenceInput): ProductIntelligenceResult {
  const dictionaries = input.dictionaries ?? loadSeedDictionaries();
  const path = ["normalize", "line_parse", "product_profile", "industry", "family", "attributes"];

  const identity = resolveProductIdentity({
    description: input.description,
    supplier: input.supplier,
    part_number: input.part_number,
    model_number: input.model_number,
    answers: input.answers,
    abbreviations: dictionaries.abbreviations,
    catalogue: dictionaries.catalogue,
    identityLearning: dictionaries.identityLearning,
    supplierHistory: input.supplierHistory,
    adjacentDescriptions: input.adjacentDescriptions,
  });
  path.push(...identity.path.filter((p) => p !== "line_parse"));

  // Prefer a description enriched with resolved product type for dictionary matching
  const effectiveDescription =
    identity.parsed.productType && identity.parsed.identityStatus !== "unresolved"
      ? `${identity.parsed.productType} ${identity.parsed.material || ""} ${identity.parsed.brandOrProductFamily || ""} ${input.description}`
      : input.description;

  const { profile: baseProfile, dictionaryHit, brandHit } = buildProductProfile({
    description: effectiveDescription,
    supplier: input.supplier,
    partNumber: identity.parsed.partNumber || input.part_number,
    modelNumber: identity.parsed.sku || input.model_number,
    answers: input.answers,
    dictionaries,
  });

  let profile = enrichProfileFromIdentity(baseProfile, identity.parsed);

  // Safeguard: never let brand/SKU alone invent a product type — but keep attribute-detected types
  if (identity.blockClassification && !identity.parsed.productType && !profile.productType) {
    profile = {
      ...profile,
      productFamily: null,
      industry: null,
      industryCode: null,
    };
  } else if (identity.parsed.productType && !profile.productType) {
    profile = { ...profile, productType: identity.parsed.productType };
  }

  // Attribute/profile product type can resolve identity enough for chapter gating —
  // but generic inferred categories (e.g. "Vehicle article") must not.
  let identityBlocked = identity.blockClassification;
  if (identityBlocked && isConcreteProductType(profile.productType)) {
    identityBlocked = false;
  }

  if (dictionaryHit) path.push("product_dictionary");
  if (brandHit) path.push("brand");

  const supplierHit = supplierBoost(input.description, input.supplier, input.supplierHistory);
  if (supplierHit) path.push("supplier_history");

  path.push("attribute_library");
  const attrResult = runAttributeEngine({
    profile,
    description: effectiveDescription,
    library: dictionaries.attributeLibrary ?? [],
    learning: input.attributeLearning,
    dictionaryHit: identityBlocked && !profile.productType ? null : dictionaryHit,
    brandHit,
    maxQuestions: 4,
  });

  profile = enrichProfileFromIdentity(attrResult.enrichedProfile, identity.parsed);
  if (isConcreteProductType(profile.productType)) identityBlocked = false;
  if (attrResult.inferred.some((i) => i.source === "attribute_learning")) {
    path.push("attribute_learning");
  }
  if (attrResult.inferred.some((i) => i.source === "ocr")) {
    path.push("attribute_inference");
  }

  const liquid = runLiquidCompositionEngine({
    description: input.description,
    productProfile: profile,
    answers: input.answers,
    documentSnippets: input.documentSnippets,
    rules: dictionaries.liquidRules,
    learned: input.liquidLearning,
  });

  if (liquid.applicable) {
    path.push("liquid_composition");
    if (liquid.profile.composition.length) path.push("composition_extract");
    if (liquid.profile.essentialCharacterComponent) path.push("essential_character");
    profile = {
      ...profile,
      primaryFunction: profile.primaryFunction || liquid.profile.primaryFunction,
      primaryUse: profile.primaryUse || liquid.profile.intendedUse,
      hazardous: liquid.profile.hazardous ?? profile.hazardous,
      chemical: profile.chemical || liquid.applicable,
      composition:
        liquid.profile.composition.map((c) => `${c.name}${c.percentage != null ? ` ${c.percentage}%` : ""}`).join("; ") ||
        profile.composition,
      attributes: {
        ...profile.attributes,
        liquidType: liquid.profile.liquidType,
        physicalForm: liquid.profile.physicalForm,
        solvent: liquid.profile.solvent,
        essentialCharacter: liquid.profile.essentialCharacterComponent,
        alcoholContentPercent: liquid.profile.alcoholContentPercent,
      },
    };
  }

  path.push("domain_gate", "chapter_prediction", "heading_prediction");
  let predictionBundle = buildPrediction(profile, dictionaries.chapterRules, dictionaryHit, brandHit);
  profile = predictionBundle.gatedProfile;

  let predictions = (() => {
    const { domainSignal: _ds, gatedProfile: _gp, ...rest } = predictionBundle;
    return rest;
  })();

  if (identityBlocked && (predictions.domainConfidence ?? 0) >= 0.8 && predictions.chapter) {
    identityBlocked = false;
  }

  if (!identityBlocked && liquid.applicable && liquid.chapterHints.length && liquid.confidences.chapterPrediction >= 0.55) {
    const hinted = liquid.chapterHints[0];
    const domainBlocksFood =
      predictions.domain &&
      predictions.domain !== "food" &&
      (predictions.domainConfidence ?? 0) >= 0.55 &&
      isFoodChapter(hinted);
    if (!domainBlocksFood && (!predictions.chapter || liquid.confidences.compositionCompleteness >= 0.5)) {
      predictions = {
        ...predictions,
        chapter: predictions.chapter || hinted,
        chapterConfidence: Math.max(predictions.chapterConfidence, liquid.confidences.chapterPrediction),
      };
    }
  }

  let pending_questions = mergeQuestions(identity.parsed.suggestedQuestions, attrResult.pendingQuestions, 6);
  if (!pending_questions.length && !(dictionaries.attributeLibrary?.length) && !identityBlocked) {
    pending_questions = selectQuestions(profile, dictionaries, 3);
  }
  if (liquid.applicable) {
    pending_questions = mergeQuestions(liquid.pendingQuestions, pending_questions, 6);
  }
  if (pending_questions.length) path.push("smart_questions");

  const knowledgeSources: string[] = ["Product Profile", "Line Parser", "Domain Gate"];
  if (identity.catalogueHit) knowledgeSources.push("Supplier Catalogue");
  if (identity.learningHit) knowledgeSources.push("Identity Learning");
  if (attrResult.profile) knowledgeSources.push("Attribute Library");
  if (dictionaryHit && !identityBlocked) knowledgeSources.push("Product Dictionary");
  if (brandHit) knowledgeSources.push("Brand Dictionary");
  if (supplierHit) knowledgeSources.push("Supplier History");
  if (attrResult.inferred.some((i) => i.source === "attribute_learning")) {
    knowledgeSources.push("Attribute Learning");
  }
  for (const s of liquid.knowledgeSources) {
    if (!knowledgeSources.includes(s)) knowledgeSources.push(s);
  }
  if (predictions.chapter) knowledgeSources.push("Chapter Prediction");
  knowledgeSources.push("Explanatory Notes (validation only)");

  let suggested_hs_code: string | null = null;
  let duty_rate: string | null = null;
  let confidence = identityBlocked ? identity.parsed.identityConfidence * 0.3 : predictions.chapterConfidence * 0.5;
  let skip_ai = false;

  const blockingQuestions = pending_questions.filter((q) => q.required);
  const liquidBlocks =
    liquid.applicable &&
    (liquid.requiresReview || liquid.confidences.finalClassification < 0.7);

  if (identityBlocked) {
    skip_ai = true;
    suggested_hs_code = null;
    duty_rate = null;
    confidence = Math.min(0.35, identity.parsed.identityConfidence);
    path.push("identity_unresolved");
  } else if (identity.suggestedHsCode) {
    suggested_hs_code = identity.suggestedHsCode;
    duty_rate = identity.dutyRate;
    confidence = identity.parsed.identityConfidence;
    skip_ai = blockingQuestions.length === 0 && !liquidBlocks;
    path.push("identity_resolve");
  } else if (supplierHit?.hs && supplierHit.confidence >= 0.85 && !liquidBlocks) {
    suggested_hs_code = supplierHit.hs;
    duty_rate = supplierHit.duty ?? null;
    confidence = supplierHit.confidence;
    skip_ai = blockingQuestions.length === 0;
    path.push("supplier_resolve");
  } else if (
    dictionaryHit?.typical_chapter &&
    predictions.predictedHsCode &&
    predictions.headings[0]?.score >= 0.7 &&
    blockingQuestions.length === 0 &&
    !liquidBlocks
  ) {
    suggested_hs_code = predictions.predictedHsCode;
    duty_rate = predictions.predictedDuty ?? null;
    confidence = Math.min(0.9, 0.55 + predictions.headings[0].score * 0.3 + (brandHit?.confidence_boost ?? 0));
    skip_ai = confidence >= 0.82;
    if (skip_ai) path.push("dictionary_resolve");
  } else if (predictions.predictedHsCode) {
    suggested_hs_code = predictions.predictedHsCode;
    duty_rate = predictions.predictedDuty ?? null;
    confidence = Math.min(0.8, 0.4 + (predictions.headings[0]?.score ?? 0) * 0.35);
    if (liquid.applicable) {
      confidence = Math.min(confidence, liquid.confidences.finalClassification);
    }
  }

  if (liquidBlocks) {
    skip_ai = false;
    confidence = Math.min(confidence, 0.6);
  }

  if (!skip_ai && !identityBlocked) path.push("ai_validation");
  path.push("en_validation_deferred", "clerk_review");

  const domainConflict = domainTariffConflict(
    (predictions.domain as ProductDomain) || "unknown",
    suggested_hs_code,
  );

  const gaps = [
    ...identity.parsed.missingFields,
    ...pending_questions.map((q) => q.prompt),
    ...liquid.conflicts.map((c) => c.description),
  ];
  const explainAttrs: Record<string, string | null> = {
    ...attrResult.attributeSnapshot,
    material: profile.material,
    function: profile.primaryFunction,
    use: profile.primaryUse,
    gender: profile.gender,
    brand: profile.brand,
    thickness: identity.parsed.thickness,
    finish: identity.parsed.styleOrFinish,
    sku: identity.parsed.sku,
    partNumber: identity.parsed.partNumber,
    domain: predictions.domainLabel || predictions.domain || null,
  };

  const explainability: ClassificationExplainability = {
    productName: profile.productName,
    normalizedName: identity.parsed.normalizedDescription || profile.normalizedName,
    industry: profile.industry,
    productFamily: profile.productFamily,
    attributes: explainAttrs,
    attributeConfidences: attrResult.confidences,
    inferredAttributes: attrResult.inferred,
    liquidProfile: liquid.applicable ? liquid.profile : undefined,
    liquidConfidences: liquid.applicable ? liquid.confidences : undefined,
    predictedChapter: predictions.chapter,
    predictedHeading: predictions.headings[0]?.heading ?? null,
    predictedSubheading: predictions.subheading ?? null,
    confidence,
    questionsAsked: pending_questions.map((q) => q.prompt),
    knowledgeSources,
    reasoningSummary: [
      identityBlocked
        ? "Product identity unresolved — colour, size, thickness, SKU and brand alone are not enough to classify. Showing domain-gated chapter hints only."
        : `Normalized to "${identity.parsed.normalizedDescription || profile.normalizedName}".`,
      identity.parsed.brandOrProductFamily
        ? `Brand/family: ${identity.parsed.brandOrProductFamily}.`
        : null,
      identity.parsed.partNumber ? `Part: ${identity.parsed.partNumber}.` : null,
      identity.parsed.sku ? `SKU: ${identity.parsed.sku}.` : null,
      identity.parsed.productType || profile.productType
        ? `Product type: ${identity.parsed.productType || profile.productType}.`
        : "Product type unknown.",
      predictions.domainLabel ? `Domain: ${predictions.domainLabel}.` : null,
      profile.industry ? `Detected industry: ${profile.industry}.` : null,
      identity.catalogueHit ? `Matched supplier catalogue #${identity.catalogueHit.id}.` : null,
      predictions.chapter
        ? `Predicted Chapter ${predictions.chapter} (${Math.round(predictions.chapterConfidence * 100)}%). Explanatory Notes are consulted only after heading candidates are selected.`
        : "No chapter predicted.",
      domainConflict.conflict ? domainConflict.message : null,
      gaps.length ? `Missing: ${gaps.slice(0, 4).join("; ")}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    gaps,
    parsedDescription: identity.parsed,
    identityStatus: identity.parsed.identityStatus,
    identityConfidence: identity.parsed.identityConfidence,
    classificationPath: path,
    domain: predictions.domain,
    domainLabel: predictions.domainLabel,
    domainConflictWarning: domainConflict.message,
    enValidationStatus: "Deferred until candidate headings are selected (not used for initial search).",
  };

  return {
    line_id: input.line_id,
    profile,
    predictions,
    pending_questions,
    explainability,
    skip_ai: identityBlocked ? true : skip_ai,
    suggested_hs_code,
    duty_rate,
    confidence,
    knowledgeSources,
    supplier_history_id: supplierHit?.id,
    supplier_usage_count: supplierHit?.usage,
    path,
    attribute_confidences: attrResult.confidences,
    inferred_attributes: attrResult.inferred,
    liquid_profile: liquid.applicable ? liquid.profile : undefined,
    liquid_confidences: liquid.applicable ? liquid.confidences : undefined,
    liquid_conflicts: liquid.applicable ? liquid.conflicts : undefined,
    liquid_requires_review: liquid.applicable ? liquid.requiresReview : undefined,
    parsed_description: identity.parsed,
    line_context: identity.context,
    identity_unresolved: identityBlocked,
  };
}

export { loadSeedDictionaries };
export type { DictionaryBundle };
