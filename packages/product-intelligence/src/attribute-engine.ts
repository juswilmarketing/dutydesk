import type {
  AttributeDefinition,
  AttributeLearningEntry,
  InferredAttribute,
  ProductAttributeLibraryEntry,
  ProductProfile,
  ProductQuestion,
} from "@pas/shared-types";
import type { BrandDictionaryEntry, ProductDictionaryEntry } from "@pas/shared-types";
import attributeLibrarySeed from "../seed/attribute-library.json";
import { normalizeKey } from "./normalize";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const MAX_QUESTIONS = 5;

export type AttributeLibraryBundle = ProductAttributeLibraryEntry[];

export function loadSeedAttributeLibrary(): AttributeLibraryBundle {
  return attributeLibrarySeed.map((p, idx) => ({
    id: idx + 1,
    productFamily: p.productFamily,
    industry: p.industry,
    typicalChapters: p.typicalChapters ?? [],
    requiredAttributes: (p.requiredAttributes ?? []) as AttributeDefinition[],
    optionalAttributes: (p.optionalAttributes ?? []) as AttributeDefinition[],
    questionOrder: p.questionOrder ?? [],
    validationRules: (p.validationRules ?? []) as ProductAttributeLibraryEntry["validationRules"],
    status: "active",
  }));
}

/** Map common seed/product family names onto library profiles. */
const FAMILY_ALIASES: Record<string, string> = {
  footwear: "Footwear",
  food: "Food",
  "electrical appliance": "Electrical Equipment",
  "electrical equipment": "Electrical Equipment",
  electrical: "Electrical Equipment",
  "power supply": "Electrical Equipment",
  furniture: "Furniture",
  chemical: "Chemical",
  chemicals: "Chemical",
  textiles: "Textiles",
  textile: "Textiles",
  garment: "Textiles",
  automotive: "Automotive",
  "vehicle part": "Automotive",
  printing: "Printing Consumable",
  "printing consumable": "Printing Consumable",
  "printer ribbon": "Printing Consumable",
  construction: "Construction",
  pipe: "Construction",
  "pipe/fitting": "Construction",
  "medical device": "Medical Device",
  medical: "Medical Device",
  "general goods": "General Goods",
  general: "General Goods",
};

export function resolveAttributeProfile(
  productFamily: string | null | undefined,
  industryCode: string | null | undefined,
  library: AttributeLibraryBundle,
): ProductAttributeLibraryEntry | null {
  const active = library.filter((p) => p.status === "active");
  if (!active.length) return null;

  if (productFamily) {
    const exact = active.find((p) => p.productFamily.toLowerCase() === productFamily.toLowerCase());
    if (exact) return exact;
    const alias = FAMILY_ALIASES[productFamily.toLowerCase()];
    if (alias) {
      const byAlias = active.find((p) => p.productFamily === alias);
      if (byAlias) return byAlias;
    }
  }

  if (industryCode) {
    const byIndustry = active.find((p) => p.industry.toLowerCase() === industryCode.toLowerCase());
    if (byIndustry) return byIndustry;
    const alias = FAMILY_ALIASES[industryCode.toLowerCase()];
    if (alias) {
      const byAlias = active.find((p) => p.productFamily === alias);
      if (byAlias) return byAlias;
    }
  }

  return active.find((p) => p.productFamily === "General Goods") ?? null;
}

function profileValue(profile: ProductProfile, key: string): string | null {
  const fromAttrs = profile.attributes[key];
  if (fromAttrs != null && String(fromAttrs).trim() !== "") return String(fromAttrs);

  const map: Record<string, string | null | undefined> = {
    material: profile.material,
    upper_material: profile.material,
    gender: profile.gender,
    age_group: profile.ageGroup,
    brand: profile.brand,
    model: profile.model,
    part_number: profile.partNumber,
    primary_function: profile.primaryFunction,
    function: profile.primaryFunction,
    country_of_origin: profile.countryOfOrigin,
    fibre_composition: profile.composition,
    chemical_composition: profile.composition,
    hazardous: profile.hazardous ? "Yes" : null,
    vehicle_part: profile.productType,
    device_type: profile.productType,
    product_form: profile.productType,
  };
  const v = map[key];
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

function matchPatterns(text: string, patterns?: string[]): { value: string; confidence: number } | null {
  if (!patterns?.length) return null;
  for (const raw of patterns) {
    try {
      const re = new RegExp(raw, "i");
      const m = text.match(re);
      if (!m) continue;
      const captured = (m[1] ?? m[0]).trim();
      if (!captured) continue;
      // Boolean-ish patterns that match a keyword → Yes
      if (!m[1] && /^(yes|no)$/i.test(captured) === false && patterns.some((p) => !p.includes("("))) {
        return { value: "Yes", confidence: 0.88 };
      }
      return { value: captured, confidence: 0.86 };
    } catch {
      /* invalid pattern — skip */
    }
  }
  return null;
}

function learningLookup(
  key: string,
  learning: AttributeLearningEntry[] | undefined,
  supplier?: string | null,
  model?: string | null,
  part?: string | null,
  productKey?: string | null,
): InferredAttribute | null {
  if (!learning?.length) return null;
  const supplierNorm = supplier ? normalizeKey(supplier) : "";
  const candidates = learning.filter((l) => l.attribute_key === key);
  if (!candidates.length) return null;

  const scored = candidates
    .map((l) => {
      let score = 0;
      if (model && l.model_number && l.model_number.toLowerCase() === model.toLowerCase()) score += 50;
      if (part && l.part_number && l.part_number.toLowerCase() === part.toLowerCase()) score += 40;
      if (supplierNorm && l.normalized_supplier === supplierNorm) score += 30;
      if (productKey && l.product_key && l.product_key === productKey) score += 20;
      score += Math.min(l.usage_count, 10);
      return { l, score };
    })
    .filter((x) => x.score >= 30)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.l;
  if (!best) return null;
  return {
    key,
    value: best.attribute_value,
    confidence: Math.min(0.99, best.confidence || 0.95),
    source: "attribute_learning",
  };
}

export interface AttributeEngineInput {
  profile: ProductProfile;
  description: string;
  library: AttributeLibraryBundle;
  learning?: AttributeLearningEntry[];
  dictionaryHit?: ProductDictionaryEntry | null;
  brandHit?: BrandDictionaryEntry | null;
  maxQuestions?: number;
}

export interface AttributeEngineResult {
  profile: ProductAttributeLibraryEntry | null;
  inferred: InferredAttribute[];
  confidences: Record<string, number>;
  pendingQuestions: ProductQuestion[];
  attributeSnapshot: Record<string, string | null>;
  enrichedProfile: ProductProfile;
}

export function runAttributeEngine(input: AttributeEngineInput): AttributeEngineResult {
  const attrProfile = resolveAttributeProfile(
    input.profile.productFamily,
    input.profile.industryCode,
    input.library,
  );

  const allDefs: AttributeDefinition[] = attrProfile
    ? [...attrProfile.requiredAttributes, ...attrProfile.optionalAttributes]
    : [];
  const requiredKeys = new Set(attrProfile?.requiredAttributes.map((a) => a.key) ?? []);
  const order = attrProfile?.questionOrder?.length
    ? attrProfile.questionOrder
    : allDefs.map((d) => d.key);

  const inferred: InferredAttribute[] = [];
  const confidences: Record<string, number> = {};
  const values: Record<string, string> = {};

  const productKey = normalizeKey(input.profile.normalizedName);
  const desc = input.description;

  // Align product family on profile when library resolves an alias
  const enriched: ProductProfile = {
    ...input.profile,
    productFamily: attrProfile?.productFamily ?? input.profile.productFamily,
    attributes: { ...input.profile.attributes },
  };

  for (const def of allDefs) {
    // 1. Already on profile / clerk answers
    const existing = profileValue(enriched, def.key);
    if (existing) {
      values[def.key] = existing;
      confidences[def.key] = existing === String(input.profile.attributes[def.key] ?? "") ? 0.95 : 0.99;
      inferred.push({
        key: def.key,
        value: existing,
        confidence: confidences[def.key],
        source: input.profile.attributes[def.key] != null ? "clerk" : "profile",
      });
      continue;
    }

    // 2. Attribute learning cache
    const learned = learningLookup(
      def.key,
      input.learning,
      enriched.supplier,
      enriched.model,
      enriched.partNumber,
      productKey,
    );
    if (learned) {
      values[def.key] = learned.value;
      confidences[def.key] = learned.confidence;
      inferred.push(learned);
      continue;
    }

    // 3. Brand dictionary for brand key
    if (def.key === "brand" && input.brandHit?.brand) {
      values[def.key] = input.brandHit.brand;
      confidences[def.key] = 0.99;
      inferred.push({
        key: def.key,
        value: input.brandHit.brand,
        confidence: 0.99,
        source: "brand_dictionary",
      });
      continue;
    }

    // 4. Product dictionary materials / uses
    if (def.key === "material" && input.dictionaryHit?.common_materials?.[0]) {
      values[def.key] = input.dictionaryHit.common_materials[0];
      confidences[def.key] = 0.82;
      inferred.push({
        key: def.key,
        value: input.dictionaryHit.common_materials[0],
        confidence: 0.82,
        source: "product_dictionary",
      });
      continue;
    }

    // 5. OCR / description pattern inference
    const fromPattern = matchPatterns(desc, def.inferencePatterns);
    if (fromPattern) {
      // Normalize boolean-ish option answers
      let value = fromPattern.value;
      if (def.options?.includes("Yes") && !def.options.includes(value) && fromPattern.confidence >= 0.8) {
        value = "Yes";
      }
      values[def.key] = value;
      confidences[def.key] = fromPattern.confidence;
      inferred.push({
        key: def.key,
        value,
        confidence: fromPattern.confidence,
        source: "ocr",
      });
      continue;
    }

    // 6. Synonym scan in description
    if (def.synonyms?.length) {
      for (const syn of def.synonyms) {
        if (new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(desc)) {
          values[def.key] = syn;
          confidences[def.key] = 0.7;
          inferred.push({ key: def.key, value: syn, confidence: 0.7, source: "ocr" });
          break;
        }
      }
      if (values[def.key]) continue;
    }

    // 7. Default value (low confidence — still may ask)
    if (def.defaultValue) {
      values[def.key] = def.defaultValue;
      confidences[def.key] = 0.4;
      inferred.push({
        key: def.key,
        value: def.defaultValue,
        confidence: 0.4,
        source: "default",
      });
    }
  }

  // Brand sports footwear inference example: Nike + running → sports_footwear Yes
  if (
    requiredKeys.has("sports_footwear") &&
    !values.sports_footwear &&
    input.brandHit &&
    /nike|adidas|puma|asics|reebok/i.test(input.brandHit.brand)
  ) {
    values.sports_footwear = "Yes";
    confidences.sports_footwear = 0.9;
    inferred.push({
      key: "sports_footwear",
      value: "Yes",
      confidence: 0.9,
      source: "brand_dictionary",
    });
  }

  // Write inferred values onto profile attributes
  for (const [k, v] of Object.entries(values)) {
    enriched.attributes[k] = v;
    if (k === "material" || k === "upper_material") enriched.material = v.toLowerCase();
    if (k === "gender") enriched.gender = v;
    if (k === "age_group") enriched.ageGroup = v;
    if (k === "brand") enriched.brand = v;
    if (k === "model") enriched.model = v;
    if (k === "part_number") enriched.partNumber = v;
    if (k === "primary_function" || k === "function") enriched.primaryFunction = v;
    if (k === "fibre_composition" || k === "chemical_composition") enriched.composition = v;
    if (k === "hazardous" && /^yes$/i.test(v)) enriched.hazardous = true;
  }

  // Build questions: required attrs missing OR below confidence threshold
  const defByKey = new Map(allDefs.map((d) => [d.key, d]));
  const pending: ProductQuestion[] = [];
  const maxQ = input.maxQuestions ?? MAX_QUESTIONS;

  for (const key of order) {
    if (pending.length >= maxQ) break;
    if (!requiredKeys.has(key)) continue;
    const def = defByKey.get(key);
    if (!def) continue;
    const threshold = def.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const conf = confidences[key] ?? 0;
    const hasValue = values[key] != null && String(values[key]).trim() !== "";
    if (hasValue && conf >= threshold) continue;

    pending.push({
      id: `attr_${key}`,
      field: key,
      prompt: def.prompt,
      options: def.options,
      required: true,
    });
  }

  const attributeSnapshot: Record<string, string | null> = {};
  for (const key of order) {
    attributeSnapshot[key] = values[key] ?? null;
  }

  return {
    profile: attrProfile,
    inferred,
    confidences,
    pendingQuestions: pending,
    attributeSnapshot,
    enrichedProfile: enriched,
  };
}

export function buildLearningKey(parts: {
  supplier?: string | null;
  model?: string | null;
  part?: string | null;
  productKey?: string | null;
  attributeKey: string;
}): string {
  return [
    normalizeKey(parts.supplier || ""),
    (parts.model || "").toLowerCase().trim(),
    (parts.part || "").toLowerCase().trim(),
    parts.productKey || "",
    parts.attributeKey,
  ].join("|");
}
