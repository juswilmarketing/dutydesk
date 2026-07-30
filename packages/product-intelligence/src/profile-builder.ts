import type { ProductProfile, ProductQuestion, ProductQuestionAnswer } from "@pas/shared-types";
import type { ExtractedAttributes } from "./attribute-extract";
import type { DictionaryBundle } from "./dictionaries";
import { industryByCode, matchBrand, matchProduct } from "./dictionaries";
import { applyPhraseNormalization } from "./normalize";
import { extractAttributes } from "./attribute-extract";

function polishingChemicalIndustry(attrs: ExtractedAttributes): boolean {
  return (
    attrs.flags.chemical &&
    !attrs.flags.food &&
    (/polish|restorer|scour|clean|detergent/i.test(attrs.productType || "") ||
      /polish|restorer|clean/i.test(attrs.primaryFunction || ""))
  );
}

export interface BuildProfileInput {
  description: string;
  supplier?: string | null;
  partNumber?: string | null;
  modelNumber?: string | null;
  answers?: ProductQuestionAnswer[];
  dictionaries: DictionaryBundle;
}

function applyAnswers(attrs: ExtractedAttributes, answers?: ProductQuestionAnswer[]) {
  if (!answers?.length) return attrs;
  const next = { ...attrs, attributes: { ...attrs.attributes }, flags: { ...attrs.flags } };
  for (const a of answers) {
    const v = a.value.trim();
    if (!v || v.toLowerCase() === "unknown") continue;
    next.attributes[a.field] = v;
    if (a.field === "material" || a.field === "upper_material" || a.field === "pipe_material") {
      next.material = v.toLowerCase();
    }
    if (a.field === "food_state") {
      next.flags.food = true;
      next.primaryUse = v;
      if (/frozen|chilled/i.test(v)) next.flags.temperatureControlled = true;
    }
    if (a.field === "sterile" && /yes/i.test(v)) next.flags.medical = true;
    if (a.field === "voltage" || a.field === "power" || a.field === "phase") {
      next.flags.electrical = true;
    }
  }
  return next;
}

export function buildProductProfile(input: BuildProfileInput): {
  profile: ProductProfile;
  dictionaryHit: ReturnType<typeof matchProduct>;
  brandHit: ReturnType<typeof matchBrand>;
  normalizedDesc: string;
} {
  const normalizedDesc = applyPhraseNormalization(input.description);
  let attrs = extractAttributes(input.description);
  attrs = applyAnswers(attrs, input.answers);

  const dictionaryHit = matchProduct(normalizedDesc, input.dictionaries.products);
  const brandHit = matchBrand(input.description, input.dictionaries.brands);
  const industryCode = dictionaryHit?.industry_code
    ?? (attrs.flags.printing
      ? "printing"
      : polishingChemicalIndustry(attrs)
        ? "chemicals"
        : attrs.flags.footwear
          ? "footwear"
          : attrs.flags.food
            ? "food"
            : attrs.flags.electrical
              ? "electrical"
              : attrs.flags.construction
                ? "construction"
                : attrs.flags.vehicle
                  ? "automotive"
                  : attrs.flags.medical
                    ? "medical"
                    : attrs.flags.machine
                      ? "machinery"
                      : brandHit?.industry_hints[0] ?? null);

  const industry = industryByCode(industryCode, input.dictionaries.industries);

  const profile: ProductProfile = {
    productName: input.description.trim(),
    normalizedName: dictionaryHit?.canonical_name ?? normalizedDesc,
    industry: industry?.name ?? null,
    industryCode: industryCode,
    productFamily: dictionaryHit?.product_family
      ?? (attrs.flags.printing
        ? "Printing Consumable"
        : polishingChemicalIndustry(attrs)
          ? "cleaning and polishing preparations"
          : attrs.flags.footwear
            ? "Footwear"
            : attrs.flags.food
              ? "Food"
              : attrs.productType),
    productType: attrs.productType ?? dictionaryHit?.canonical_name ?? null,
    material: attrs.material ?? dictionaryHit?.common_materials[0] ?? null,
    composition: attrs.composition,
    primaryFunction: attrs.primaryFunction,
    primaryUse: attrs.primaryUse,
    commercialUse: attrs.commercialUse,
    consumerUse: attrs.consumerUse,
    brand: brandHit?.brand ?? null,
    model: input.modelNumber ?? attrs.model,
    partNumber: input.partNumber ?? attrs.partNumber,
    supplier: input.supplier ?? null,
    countryOfOrigin: null,
    gender: attrs.gender,
    ageGroup: attrs.ageGroup,
    food: attrs.flags.food,
    chemical: attrs.flags.chemical,
    medical: attrs.flags.medical,
    electrical: attrs.flags.electrical,
    vehicle: attrs.flags.vehicle,
    construction: attrs.flags.construction,
    textile: attrs.flags.textile,
    footwear: attrs.flags.footwear,
    machine: attrs.flags.machine,
    tool: attrs.flags.tool,
    hazardous: attrs.flags.hazardous,
    fragile: attrs.flags.fragile,
    temperatureControlled: attrs.flags.temperatureControlled,
    attributes: attrs.attributes,
  };

  return { profile, dictionaryHit, brandHit, normalizedDesc };
}

export function selectQuestions(
  profile: ProductProfile,
  dictionaries: DictionaryBundle,
  maxQuestions = 3,
): ProductQuestion[] {
  const rules = dictionaries.questionRules
    .filter((r) => r.status === "active")
    .filter((r) => {
      if (r.industry_code && r.industry_code !== profile.industryCode) return false;
      if (r.product_family && r.product_family !== profile.productFamily) return false;
      return !!(r.industry_code || r.product_family);
    })
    .sort((a, b) => a.priority - b.priority);

  const out: ProductQuestion[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const q of rule.questions) {
      if (seen.has(q.id)) continue;
      const existing = profile.attributes[q.field] ?? (q.field === "material" ? profile.material : null);
      if (existing != null && String(existing).trim() !== "") continue;
      if (q.field === "upper_material" && profile.material) continue;
      out.push(q);
      seen.add(q.id);
      if (out.length >= maxQuestions) return out;
    }
  }
  return out;
}
