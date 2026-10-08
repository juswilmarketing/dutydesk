/**
 * Product Classification Profile — structured interpretation of an invoice line.
 * Used as the sole input to hierarchical tariff retrieval (Phase 1).
 */

import { matchProductFamilyPlugin } from "./plugins";
import {
  resolveCommonProduct,
  type CommonProductEntry,
} from "./common-product-dictionary";
import { routeProductFamily, applyFamilyRouteToProfile } from "./product-family-router";
import { matchProductNounLexicon } from "./product-noun-lexicon";
import { extractAdministrativeCodes, semanticSearchText } from "./token-roles";
import { isNonMerchandiseLine } from "./line-type";

export type ProductClassificationProfile = {
  rawDescription: string;
  normalizedDescription: string;
  canonicalProduct: string;
  productNoun: string;
  productFamily: string;
  /** High-level domain e.g. display_equipment, packaging, textiles */
  productDomain?: string;
  industry: string;
  material: string;
  composition: string;
  materials?: string[];
  primaryFunction: string;
  secondaryFunctions?: string[];
  intendedUse: string;
  physicalForm: string;
  finishedState: string;
  disposable: boolean | null;
  retailPrepared: boolean | null;
  partOrCompleteArticle: string;
  brand: string;
  manufacturer: string;
  sku: string;
  model: string;
  dimensions: string;
  likelySections: string[];
  likelyChapters: string[];
  likelyHeadings?: string[];
  excludedChapters: string[];
  excludedHeadings?: string[];
  criticalAttributes?: string[];
  knownAttributes: Record<string, string | number | boolean | null>;
  missingCriticalAttributes: string[];
  interpretationConfidence: number;
  productConfidence?: number;
  familyConfidence?: number;
  /** Plugin that enriched this profile, if any. */
  pluginId?: string;
  /** Preferred heading digits for retrieval bias. */
  preferredHeadings?: string[];
  prohibitedHeadings?: string[];
  technicalSpecifications?: Record<string, string | number | boolean | null>;
  cleanDescription?: string;
  /** True when this description must not enter tariff classification. */
  nonMerchandise?: boolean;
};

const FOOD_CHAPTERS = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

/** Invoice shorthand → expanded product phrases (longest first). */
const EXPANSIONS: Array<{ pattern: RegExp; expansion: string }> = [
  { pattern: /\bb[\s/.\-]*towels?\b/i, expansion: "bath towels" },
  { pattern: /\bbath[\s/.\-]*twls?\b/i, expansion: "bath towels" },
  { pattern: /\bbath[\s/.\-]*towels?\b/i, expansion: "bath towels" },
  { pattern: /\bpaper[\s/.\-]*towels?\b/i, expansion: "paper towels" },
  { pattern: /\bsh(?:wr)?[\s/.\-]*caps?\b/i, expansion: "shower caps" },
  { pattern: /\bshower[\s/.\-]*caps?\b/i, expansion: "shower caps" },
  { pattern: /\bled[\s/.\-]*drivers?\b/i, expansion: "LED driver" },
  { pattern: /\bvoltage[\s/.\-]*protectors?\b/i, expansion: "voltage protector" },
  { pattern: /\bcopper[\s/.\-]*tubes?\b/i, expansion: "copper tubes" },
  { pattern: /\bcamping[\s/.\-]*cots?\b/i, expansion: "camping cot" },
  { pattern: /\bladies[\s/.\-]*sandals?\b/i, expansion: "ladies sandals" },
  { pattern: /\bstainless[\s/.\-]*(?:steel[\s/.\-]*)?tanks?\b/i, expansion: "stainless steel tank" },
  { pattern: /\bmetal[\s/.\-]*restorer(?:\s+and\s+polish)?\b/i, expansion: "metal restorer and polish" },
  { pattern: /\bdiced[\s/.\-]*tomatoes?\b/i, expansion: "diced tomatoes" },
];

const STOP = new Set([
  "the", "and", "or", "of", "for", "with", "a", "an", "to", "from", "in", "on", "at",
  "pack", "pcs", "pc", "ea", "each", "box", "ctn", "carton", "new", "assorted",
]);

function extractSku(raw: string): string {
  const m = raw.match(/\b([A-Z]{1,6}[-/]?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)\b/);
  return m ? m[1].toUpperCase() : "";
}

function extractBrand(raw: string, expanded: string): string {
  if (/\b3m\b/i.test(raw) || /\b3m\b/i.test(expanded)) return "3M";
  if (/\bflex[\s\-]?lag\b/i.test(raw)) return "Flex-Lag";
  const m = raw.trim().match(/^([A-Z][A-Z0-9]{2,})\b/);
  if (!m) return "";
  const w = m[1];
  if (/^(B|SH|FL|LED|PCS|CTN)$/i.test(w)) return "";
  if (/towel|cap|tank|tube|cot|sandal/i.test(w)) return "";
  return w;
}

function detectMaterialHints(text: string): { material: string; missing: boolean } {
  const t = text.toLowerCase();
  if (/\bpaper\b/.test(t)) return { material: "paper", missing: false };
  if (/\bcotton\b/.test(t)) return { material: "cotton", missing: false };
  if (/\bmicrofibre|microfiber\b/.test(t)) return { material: "microfibre", missing: false };
  if (/\bflint\b|\bglass\b/.test(t)) return { material: /\bflint\b/.test(t) ? "flint glass" : "glass", missing: false };
  if (/\bplastic|pvc|polyethylene|pe\b/.test(t)) return { material: "plastics", missing: false };
  if (/\brubber\b/.test(t)) return { material: "rubber", missing: false };
  if (/\bnonwoven|non-woven\b/.test(t)) return { material: "nonwoven textile", missing: false };
  if (/\bsynthetic|polyester|nylon\b/.test(t)) return { material: "synthetic textile", missing: false };
  if (/\bstainless|steel\b/.test(t)) return { material: "stainless steel", missing: false };
  if (/\bcopper\b/.test(t)) return { material: "copper", missing: false };
  if (/\bwood(en)?\b/.test(t)) return { material: "wood", missing: false };
  return { material: "", missing: true };
}

/** Consignee / customer industry is weak context only (max weight 3). */
export const CUSTOMER_INDUSTRY_WEIGHT_MAX = 3;

function inferCustomerIndustryHint(consignee?: string | null): string {
  const c = String(consignee || "").toLowerCase();
  if (!c) return "";
  if (/\bcocoa|chocolate|confection|bakery|food|restaurant|catering\b/.test(c)) return "food";
  if (/\bpackag|bottle|container|glass\b/.test(c)) return "packaging";
  if (/\bauto|tire|tyre|motor\b/.test(c)) return "automotive";
  return "";
}

type ProductRule = {
  test: RegExp;
  canonical: string;
  noun: string;
  family: string;
  industry: string;
  primaryFunction: string;
  intendedUse: string;
  finishedState: string;
  physicalForm: string;
  partOrComplete: string;
  likelyChapters: string[];
  excludedChapters: string[];
  criticalAttrs: string[];
  confidence: number;
};

const PRODUCT_RULES: ProductRule[] = [
  {
    test: /\bpaper\s+towels?\b/i,
    canonical: "paper towels",
    noun: "towels",
    family: "paper household articles",
    industry: "paper products",
    primaryFunction: "wiping and drying",
    intendedUse: "household / sanitary",
    finishedState: "finished article",
    physicalForm: "sheet / roll",
    partOrComplete: "complete article",
    likelyChapters: ["48"],
    excludedChapters: ["63", "01", "02", "20", "34", "84", "85"],
    criticalAttrs: [],
    confidence: 0.88,
  },
  {
    test: /\b(?:bath\s+)?towels?\b/i,
    canonical: "bath towels",
    noun: "towels",
    family: "toilet linen",
    industry: "textiles",
    primaryFunction: "drying the body after bathing",
    intendedUse: "personal / household",
    finishedState: "finished article",
    physicalForm: "textile article",
    partOrComplete: "complete article",
    likelyChapters: ["63"],
    excludedChapters: [...FOOD_CHAPTERS, "28", "29", "34", "38", "84", "85", "87"],
    criticalAttrs: ["material"],
    confidence: 0.82,
  },
  {
    test: /\bshower\s+caps?\b/i,
    canonical: "shower caps",
    noun: "caps",
    family: "hair protection article",
    industry: "personal care",
    primaryFunction: "protect hair while bathing",
    intendedUse: "personal care",
    finishedState: "finished article",
    physicalForm: "cap / covering",
    partOrComplete: "complete article",
    likelyChapters: ["39", "65", "63"],
    excludedChapters: [...FOOD_CHAPTERS, "84", "85", "87"],
    criticalAttrs: ["material"],
    confidence: 0.8,
  },
  {
    test: /\bactivat/i,
    canonical: "industrial activator",
    noun: "activator",
    family: "industrial chemical preparation",
    industry: "chemicals",
    primaryFunction: "unknown; likely used in a bonding, priming or curing system",
    intendedUse: "industrial",
    finishedState: "preparation",
    physicalForm: "chemical preparation",
    partOrComplete: "complete product",
    likelyChapters: ["38", "35", "34", "32"],
    excludedChapters: [...FOOD_CHAPTERS, "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63"],
    criticalAttrs: ["primary function", "chemical composition"],
    confidence: 0.62,
  },
  {
    test: /\b(?:metal\s+)?(?:restorer|polish)/i,
    canonical: "metal polishing preparation",
    noun: "polish",
    family: "cleaning and polishing preparations",
    industry: "chemicals",
    primaryFunction: "clean, restore and polish metal surfaces",
    intendedUse: "maintenance",
    finishedState: "preparation",
    physicalForm: "paste / cream / liquid",
    partOrComplete: "complete product",
    likelyChapters: ["34"],
    excludedChapters: [...FOOD_CHAPTERS, "63", "64", "94"],
    criticalAttrs: [],
    confidence: 0.9,
  },
  {
    test: /\bsandals?\b/i,
    canonical: "sandals",
    noun: "sandals",
    family: "footwear",
    industry: "footwear",
    primaryFunction: "wear on feet",
    intendedUse: "personal",
    finishedState: "finished article",
    physicalForm: "footwear",
    partOrComplete: "complete article",
    likelyChapters: ["64"],
    excludedChapters: [...FOOD_CHAPTERS],
    criticalAttrs: ["material"],
    confidence: 0.85,
  },
  {
    test: /\bled\s+driver|power\s+supply\b/i,
    canonical: "LED driver / power supply",
    noun: "driver",
    family: "electrical apparatus",
    industry: "electrical",
    primaryFunction: "electrical power conversion",
    intendedUse: "lighting / electrical",
    finishedState: "finished article",
    physicalForm: "electrical apparatus",
    partOrComplete: "complete article",
    likelyChapters: ["85"],
    excludedChapters: [...FOOD_CHAPTERS, "63", "64"],
    criticalAttrs: [],
    confidence: 0.86,
  },
  {
    test: /\bvoltage\s+protector\b/i,
    canonical: "voltage protector",
    noun: "protector",
    family: "electrical apparatus",
    industry: "electrical",
    primaryFunction: "protect electrical equipment from voltage surge",
    intendedUse: "electrical",
    finishedState: "finished article",
    physicalForm: "electrical apparatus",
    partOrComplete: "complete article",
    likelyChapters: ["85"],
    excludedChapters: [...FOOD_CHAPTERS],
    criticalAttrs: [],
    confidence: 0.84,
  },
  {
    test: /\bstainless.*tank|steel\s+tank\b/i,
    canonical: "stainless steel tank",
    noun: "tank",
    family: "metal containers",
    industry: "metals",
    primaryFunction: "store liquids or materials",
    intendedUse: "industrial / storage",
    finishedState: "finished article",
    physicalForm: "tank / vessel",
    partOrComplete: "complete article",
    likelyChapters: ["73"],
    excludedChapters: [...FOOD_CHAPTERS],
    criticalAttrs: [],
    confidence: 0.84,
  },
  {
    test: /\bcamping\s+cot\b/i,
    canonical: "camping cot",
    noun: "cot",
    family: "furniture / camping equipment",
    industry: "furniture",
    primaryFunction: "sleeping / resting furniture",
    intendedUse: "camping / outdoor",
    finishedState: "finished article",
    physicalForm: "furniture",
    partOrComplete: "complete article",
    likelyChapters: ["94"],
    excludedChapters: [...FOOD_CHAPTERS],
    criticalAttrs: ["material"],
    confidence: 0.78,
  },
  {
    test: /\bdiced\s+tomatoes?\b|\btomatoes?\b/i,
    canonical: "diced tomatoes",
    noun: "tomatoes",
    family: "prepared vegetables",
    industry: "food",
    primaryFunction: "human consumption",
    intendedUse: "food",
    finishedState: "prepared food",
    physicalForm: "preserved / prepared vegetable",
    partOrComplete: "complete product",
    likelyChapters: ["20", "07"],
    excludedChapters: ["34", "38", "63", "84", "85"],
    criticalAttrs: [],
    confidence: 0.88,
  },
  {
    test: /\bcopper\s+tubes?\b/i,
    canonical: "copper tubes",
    noun: "tubes",
    family: "copper articles",
    industry: "metals",
    primaryFunction: "convey fluids / structural tubing",
    intendedUse: "plumbing / industrial",
    finishedState: "finished article",
    physicalForm: "tube / pipe",
    partOrComplete: "complete article",
    likelyChapters: ["74"],
    excludedChapters: [...FOOD_CHAPTERS],
    criticalAttrs: [],
    confidence: 0.86,
  },
];

function expandDescription(raw: string): string {
  let text = raw.trim();
  for (const { pattern, expansion } of EXPANSIONS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, expansion);
    }
  }
  // Flex-Lag activator style
  if (/\bflex[\s\-]?lag\b/i.test(text) && /\bactivat/i.test(text)) {
    text = `${text} industrial chemical activator rubber bonding belt lagging`;
  }
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTokens(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .join(" ");
}

/**
 * Build a Product Classification Profile from an invoice description.
 * Clarification answers update material / function when provided.
 * Product-family plugins enrich chapters/attributes without inventing tariff codes.
 */
export function buildProductClassificationProfile(
  rawDescription: string,
  clarification?: { id: string; value: string } | null,
  context?: {
    supplier?: string | null;
    consignee?: string | null;
    invoiceNotes?: string | null;
    /** Admin product_family_rules converted to dictionary entries. */
    commonProductEntries?: CommonProductEntry[];
    /** Structured supplier evidence already resolved (SKU / catalogue / web). */
    productEvidence?: {
      canonicalProduct?: string;
      material?: string;
      primaryFunction?: string;
      intendedUse?: string;
      emptyOrFilled?: string;
    } | null;
  },
): ProductClassificationProfile {
  const raw = String(rawDescription || "").trim();

  if (isNonMerchandiseLine(raw)) {
    return {
      rawDescription: raw,
      normalizedDescription: raw.toLowerCase(),
      canonicalProduct: raw,
      productNoun: "",
      productFamily: "",
      industry: "",
      material: "",
      composition: "",
      primaryFunction: "",
      intendedUse: "",
      physicalForm: "",
      finishedState: "",
      disposable: null,
      retailPrepared: null,
      partOrCompleteArticle: "",
      brand: "",
      manufacturer: "",
      sku: "",
      model: "",
      dimensions: "",
      likelySections: [],
      likelyChapters: [],
      excludedChapters: [],
      knownAttributes: {},
      missingCriticalAttributes: [],
      interpretationConfidence: 0,
      nonMerchandise: true,
      cleanDescription: raw,
    };
  }

  let expanded = expandDescription(raw);
  const adminCodes = extractAdministrativeCodes(raw);
  const sku = adminCodes[0] || extractSku(raw);
  const brand = extractBrand(raw, expanded);

  if (clarification?.id === "material" && clarification.value && !/^unknown$/i.test(clarification.value)) {
    expanded = `${expanded} ${clarification.value}`;
  }
  if (
    (clarification?.id === "primary_use" || clarification?.id === "primary_function")
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    expanded = `${expanded} ${clarification.value}`;
  }
  if (clarification?.id === "product_type" && clarification.value && !/^other|unknown/i.test(clarification.value)) {
    expanded = `${expanded} ${clarification.value}`;
  }
  if (
    (clarification?.id === "energy_source" || clarification?.id === "energy source")
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    expanded = `${expanded} ${clarification.value}`;
  }

  // Common Product Dictionary wins for obvious appliances (fridge, stove, TV, …)
  const commonOpts = { extraEntries: context?.commonProductEntries };
  const common = resolveCommonProduct(expanded, clarification, commonOpts)
    || resolveCommonProduct(raw, clarification, commonOpts);

  const rule = common
    ? null
    : PRODUCT_RULES.find((r) => r.test.test(expanded) || r.test.test(raw));
  const pluginRaw = common ? null : matchProductFamilyPlugin(raw, context);
  // Prefer high-confidence family parsers (auto/electrical) or fall back to product rules
  const plugin =
    pluginRaw && (!rule || pluginRaw.confidence >= 0.85)
      ? pluginRaw
      : null;
  // Lexicon fills gaps when no common/plugin/rule
  const lexicon = !common && !plugin && !rule
    ? matchProductNounLexicon(expanded) || matchProductNounLexicon(raw)
    : null;
  const mat = detectMaterialHints(expanded);

  let material = plugin?.material || mat.material;
  if (clarification?.id === "material" && clarification.value && !/^unknown$/i.test(clarification.value)) {
    material = clarification.value.toLowerCase();
  }

  let primaryFunction =
    common?.primaryFunction
    || plugin?.primaryFunction
    || rule?.primaryFunction
    || lexicon?.primaryFunction
    || "";
  if (
    (clarification?.id === "primary_use" || clarification?.id === "primary_function")
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    primaryFunction = clarification.value;
  }

  // Material-specific chapter tuning for towels / shower caps
  let likelyChapters = common?.likelyChapters?.length
    ? [...common.likelyChapters]
    : plugin?.likelyChapters?.length
      ? [...plugin.likelyChapters]
      : rule?.likelyChapters
        ? [...rule.likelyChapters]
        : lexicon?.likelyChapters
          ? [...lexicon.likelyChapters]
          : [];
  let excludedChapters = common?.excludedChapters?.length
    ? [...common.excludedChapters]
    : plugin?.excludedChapters?.length
      ? [...plugin.excludedChapters]
      : rule?.excludedChapters
        ? [...rule.excludedChapters]
        : [];
  if ((plugin?.canonicalProduct || rule?.canonical) === "bath towels" && /paper/i.test(material)) {
    likelyChapters = ["48"];
    excludedChapters = excludedChapters.filter((c) => c !== "48");
    if (!excludedChapters.includes("63")) excludedChapters.push("63");
  }
  if ((rule?.canonical === "shower caps" || /shower\s*cap/i.test(plugin?.canonicalProduct || ""))) {
    if (/plastic|film/i.test(material)) likelyChapters = ["39", "65"];
    else if (/rubber/i.test(material)) likelyChapters = ["40", "65"];
    else if (/nonwoven|textile|fabric/i.test(material)) likelyChapters = ["63", "65", "56"];
  }

  if (!likelyChapters.length && clarification?.id === "product_type" && clarification.value) {
    const v = clarification.value.toLowerCase();
    if (/machiner|equipment/.test(v)) likelyChapters = ["84", "85"];
    else if (/electrical/.test(v)) likelyChapters = ["85", "84"];
    else if (/medical|scientific/.test(v)) likelyChapters = ["90"];
    else if (/plastic|rubber/.test(v)) likelyChapters = ["39", "40"];
    else if (/textile|apparel|footwear/.test(v)) likelyChapters = ["61", "62", "63", "64"];
    else if (/food|beverage/.test(v)) likelyChapters = ["20", "21", "22"];
    else if (/packaging|container/.test(v)) likelyChapters = ["39", "48", "70"];
  }

  if (!likelyChapters.length) {
    // Never infer food chapters from consignee alone — only from merchandise description
    if (/\b(food|edible|tomato|milk|sugar|rice)\b/i.test(expanded) && !/\bbottle|jar|container|packaging\b/i.test(expanded)) {
      likelyChapters = ["20", "21", "04"];
    } else {
      likelyChapters = [];
      excludedChapters = [...FOOD_CHAPTERS];
    }
  }

  // Apply structured supplier evidence when stronger than weak consignee industry
  if (context?.productEvidence?.canonicalProduct) {
    if (context.productEvidence.material) material = context.productEvidence.material;
    if (context.productEvidence.primaryFunction) primaryFunction = context.productEvidence.primaryFunction;
  }

  const customerIndustry = inferCustomerIndustryHint(context?.consignee);
  // Packaging invoice notes reinforce packaging industry without overriding product noun
  if (/packaging\s+materials?/i.test(String(context?.invoiceNotes || "")) && plugin?.industry === "packaging") {
    // already packaging from plugin
  }

  const missingCriticalAttributes: string[] = [
    ...(common?.missingCriticalAttributes || []),
    ...(plugin?.missingCriticalAttributes || []),
  ];
  for (const attr of rule?.criticalAttrs || []) {
    if (attr === "material" && (!material || material === "unknown textile material" || material === "unknown")) {
      if (!missingCriticalAttributes.includes("material")) missingCriticalAttributes.push("material");
    } else if (attr === "primary function" && (!primaryFunction || /unknown/i.test(primaryFunction))) {
      if (!missingCriticalAttributes.includes("primary function")) missingCriticalAttributes.push("primary function");
    } else if (attr === "chemical composition") {
      if (!missingCriticalAttributes.includes("chemical composition")) missingCriticalAttributes.push("chemical composition");
    }
  }
  if (rule?.canonical === "bath towels" && !material) {
    material = "unknown textile material";
    if (!missingCriticalAttributes.includes("material")) missingCriticalAttributes.push("material");
  }
  // Hub rings: drop material question once answered
  if (
    clarification?.id === "material"
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    const idx = missingCriticalAttributes.indexOf("material");
    if (idx >= 0) missingCriticalAttributes.splice(idx, 1);
  }
  if (clarification?.id === "product_type" && likelyChapters.length) {
    const idx = missingCriticalAttributes.indexOf("product type");
    if (idx >= 0) missingCriticalAttributes.splice(idx, 1);
  }
  if (
    (clarification?.id === "energy_source" || clarification?.id === "energy source")
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    const idx = missingCriticalAttributes.indexOf("energy source");
    if (idx >= 0) missingCriticalAttributes.splice(idx, 1);
  }

  const searchExtras = common?.searchTerms || plugin?.searchTerms || lexicon?.searchTerms || [];
  const normalizedDescription = normalizeTokens(
    semanticSearchText(expanded, searchExtras),
  );
  const interpretationConfidence = common
    ? Math.min(
      0.99,
      common.confidence
        - (common.missingCriticalAttributes.length ? 0.08 : 0)
        + (clarification ? 0.02 : 0),
    )
    : plugin
      ? Math.min(0.96, plugin.confidence + (clarification ? 0.03 : 0))
      : rule
        ? Math.min(0.95, rule.confidence + (material && !mat.missing ? 0.05 : 0) + (clarification ? 0.05 : 0))
        : lexicon
          ? Math.min(0.88, lexicon.confidence + (clarification ? 0.03 : 0))
          : 0.2;

  const dimText = plugin?.dimensions
    ? Object.entries(plugin.dimensions)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}:${v}`)
      .join("; ")
    : "";

  const evidenceCanonical = context?.productEvidence?.canonicalProduct?.trim();
  // Exact product noun from common dictionary overrides weak consignee/evidence labels
  const canonicalProduct =
    common?.canonicalProduct
    || evidenceCanonical
    || plugin?.canonicalProduct
    || rule?.canonical
    || lexicon?.canonical
    || expanded.slice(0, 80)
    || raw.slice(0, 80);

  // Product-type clarification when identity is still unknown
  if (
    !common
    && !plugin
    && !rule
    && !lexicon
    && !likelyChapters.length
    && !missingCriticalAttributes.includes("product type")
  ) {
    missingCriticalAttributes.push("product type");
  }

  const draft: ProductClassificationProfile = {
    rawDescription: raw,
    normalizedDescription,
    canonicalProduct,
    productNoun: common?.productNoun || plugin?.productNoun || rule?.noun || lexicon?.noun || "",
    productFamily: common?.productFamily || plugin?.productFamily || rule?.family || lexicon?.family || "",
    // Merchandise industry from product noun/material — never from consignee alone
    industry: common?.industry || plugin?.industry || rule?.industry || lexicon?.industry || "",
    material,
    composition: "",
    materials: material ? [material] : [],
    primaryFunction,
    secondaryFunctions: [],
    intendedUse:
      context?.productEvidence?.intendedUse
      || plugin?.intendedUse
      || rule?.intendedUse
      || "",
    physicalForm: plugin?.physicalForm || rule?.physicalForm || "",
    finishedState: plugin?.finishedState || rule?.finishedState || "",
    disposable: null,
    retailPrepared: null,
    partOrCompleteArticle: plugin?.partOrCompleteArticle || rule?.partOrComplete || "",
    brand: plugin?.brand || brand,
    manufacturer: "",
    sku,
    model: plugin?.model || "",
    dimensions: dimText,
    likelySections: [],
    likelyChapters,
    likelyHeadings: common?.likelyHeadings || [],
    excludedChapters,
    excludedHeadings: [],
    criticalAttributes: [],
    knownAttributes: {
      expansionApplied: expanded !== raw,
      clarificationId: clarification?.id || null,
      supplier: context?.supplier || null,
      consignee: context?.consignee || null,
      customerIndustryHint: customerIndustry || null,
      customerIndustryWeight: customerIndustry ? CUSTOMER_INDUSTRY_WEIGHT_MAX : 0,
      pluginId: plugin?.pluginId || null,
      lexiconNoun: lexicon?.noun || null,
      commonProductFastPath: Boolean(common?.fastPath),
      productFamilyConfidence: common?.productFamilyConfidence ?? null,
      hardHeadingGate: Boolean(common?.hardHeadingGate),
      energySource: common?.energySource || null,
      likelyHeadings: common?.likelyHeadings?.join(",") || null,
      invoiceNotes: context?.invoiceNotes || null,
    },
    missingCriticalAttributes,
    interpretationConfidence,
    productConfidence: common?.confidence,
    familyConfidence: common?.productFamilyConfidence,
    pluginId: plugin?.pluginId,
    preferredHeadings:
      common?.preferredHeadings
      || plugin?.preferredHeadings
      || lexicon?.preferredHeadings
      || [],
    prohibitedHeadings: common?.prohibitedHeadings || plugin?.prohibitedHeadings || [],
    technicalSpecifications: {
      ...(plugin?.technicalSpecifications || {}),
      ...(common
        ? {
          commonProductFastPath: true,
          productFamily: common.productFamily,
          hardHeadingGate: common.hardHeadingGate,
        }
        : {}),
    },
    cleanDescription: semanticSearchText(raw, searchExtras).slice(0, 200),
    nonMerchandise: false,
  };

  // Universal Product Family Router — connects identity to tariff retrieval scope
  const route = routeProductFamily(expanded, clarification, {
    extraEntries: context?.commonProductEntries,
    profileHints: draft,
  });
  const routed = applyFamilyRouteToProfile(draft, route);
  if (route.family) {
    routed.productDomain = route.productDomain;
    routed.likelyHeadings = route.likelyHeadings;
    routed.excludedHeadings = route.excludedHeadings;
    routed.criticalAttributes = route.family.requiredAttributes;
    routed.productConfidence = route.productConfidence;
    routed.familyConfidence = route.familyConfidence;
    if (route.familyConfidence >= 0.85) {
      routed.interpretationConfidence = Math.max(routed.interpretationConfidence, route.productConfidence);
    }
  }
  return routed;
}

export function profileSearchQuery(profile: ProductClassificationProfile): string {
  return [
    profile.cleanDescription,
    profile.canonicalProduct,
    profile.productNoun,
    profile.productFamily,
    profile.material,
    profile.primaryFunction,
    profile.physicalForm,
    profile.finishedState,
    profile.brand,
    ...(profile.preferredHeadings || []),
  ]
    .filter(Boolean)
    .join(" ");
}
