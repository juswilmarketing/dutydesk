/**
 * Token-efficient Supplier Product Search helpers.
 * Resolves physical product identity — never chooses tariff codes directly.
 */

export type SupplierEvidenceSourceType =
  | "supplier_sku_history"
  | "supplier_catalogue"
  | "previous_invoice"
  | "supplier_official"
  | "manufacturer_official"
  | "catalogue"
  | "distributor"
  | "pas_record"
  | "general_web";

export type StructuredProductEvidence = {
  supplier: string;
  supplierSku: string;
  canonicalProduct: string;
  material: string;
  composition: string;
  capacity: string;
  dimensions: string;
  technicalSpecifications: Record<string, string | number | boolean | null>;
  primaryFunction: string;
  intendedUse: string;
  emptyOrFilled: "empty" | "filled" | "unknown" | "";
  sourceUrl: string;
  sourceType: SupplierEvidenceSourceType;
  retrievedAt: string;
  evidenceConfidence: number;
  /** Short supporting excerpt — never a full webpage. */
  excerpt: string;
};

export type SupplierProfile = {
  supplierName: string;
  aliases: string[];
  officialDomain: string | null;
  primaryIndustries: string[];
  knownSkuPatterns: string[];
  lastSearchDate: string | null;
};

/** Hard token / fetch limits for supplier search. */
export const SUPPLIER_SEARCH_LIMITS = {
  maxQueriesPerProduct: 3,
  maxPagesFetched: 2,
  maxEvidenceCharsPerSource: 800,
  maxTotalContextChars: 1500,
} as const;

/** Known packaging suppliers used for domain restriction. */
const SUPPLIER_PROFILES: Record<string, SupplierProfile> = {
  "k.g. international": {
    supplierName: "K.G. International, Inc.",
    aliases: ["kg international", "k.g. international, inc.", "kgint"],
    officialDomain: "kgint.com",
    primaryIndustries: ["packaging", "glass containers", "plastic containers"],
    knownSkuPatterns: ["^\\d{5,7}$"],
    lastSearchDate: null,
  },
  "kg international": {
    supplierName: "K.G. International, Inc.",
    aliases: ["k.g. international", "kgint"],
    officialDomain: "kgint.com",
    primaryIndustries: ["packaging"],
    knownSkuPatterns: ["^\\d{5,7}$"],
    lastSearchDate: null,
  },
};

export function normalizeSupplierKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSupplierProfile(supplierName: string | null | undefined): SupplierProfile | null {
  const key = normalizeSupplierKey(supplierName || "");
  if (!key) return null;
  if (SUPPLIER_PROFILES[key]) return SUPPLIER_PROFILES[key];
  for (const profile of Object.values(SUPPLIER_PROFILES)) {
    if (profile.aliases.some((a) => key.includes(a) || a.includes(key))) return profile;
  }
  return {
    supplierName: String(supplierName || "").trim(),
    aliases: [],
    officialDomain: null,
    primaryIndustries: [],
    knownSkuPatterns: [],
    lastSearchDate: null,
  };
}

export function needsSupplierSearch(input: {
  description: string;
  sku?: string | null;
  hasExactSkuMatch?: boolean;
  hasProductMaster?: boolean;
  hasCatalogueMatch?: boolean;
  profileConfidence?: number;
  productNoun?: string;
  material?: string;
  forceSearch?: boolean;
  domainConflict?: boolean;
}): boolean {
  if (input.forceSearch) return true;
  if (input.hasExactSkuMatch || input.hasProductMaster || input.hasCatalogueMatch) return false;
  if ((input.profileConfidence ?? 0) >= 0.88 && input.productNoun && input.material) return false;

  const desc = String(input.description || "");
  const vague = desc.length < 12 || /^[A-Z0-9\-_/]+$/.test(desc.trim());
  const coded = Boolean(input.sku) && !/\b(bottle|jar|tyre|tire|switch|wheel|pump)\b/i.test(desc);
  const nounUncertain = !input.productNoun;
  const materialMissing = !input.material || /unknown/i.test(input.material);
  return vague || coded || nounUncertain || materialMissing || Boolean(input.domainConflict);
}

/** Compact targeted search queries — never the full invoice. */
export function buildSupplierSearchQueries(input: {
  supplier: string;
  sku?: string | null;
  description: string;
  domain?: string | null;
}): string[] {
  const supplier = String(input.supplier || "").trim();
  const sku = String(input.sku || "").trim();
  const profile = getSupplierProfile(supplier);
  const domain = input.domain || profile?.officialDomain || null;
  const compactDesc = String(input.description || "")
    .replace(/[^\w\s.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const queries: string[] = [];
  if (supplier && sku) queries.push(`"${supplier}" ${sku}`);
  if (domain && sku) queries.push(`site:${domain} "${sku}"`);
  if (domain && compactDesc) {
    const core = compactDesc
      .replace(/\b(sauce|beverage|ketchup)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (core) queries.push(`site:${domain} "${core.slice(0, 48)}"`);
  }
  if (sku && /\b24-?414\b|\bbottle\b/i.test(input.description)) {
    queries.push(`"${sku}" "24-414" bottle`);
  }
  if (!queries.length && compactDesc) queries.push(compactDesc);

  return queries.slice(0, SUPPLIER_SEARCH_LIMITS.maxQueriesPerProduct);
}

/** Truncate evidence text for the classification model. */
export function compactEvidenceForAi(evidence: StructuredProductEvidence): string {
  const parts = [
    `supplier:${evidence.supplier}`,
    evidence.supplierSku ? `sku:${evidence.supplierSku}` : "",
    `product:${evidence.canonicalProduct}`,
    evidence.material ? `material:${evidence.material}` : "",
    evidence.capacity ? `capacity:${evidence.capacity}` : "",
    evidence.primaryFunction ? `function:${evidence.primaryFunction}` : "",
    evidence.intendedUse ? `use:${evidence.intendedUse}` : "",
    evidence.emptyOrFilled ? `state:${evidence.emptyOrFilled}` : "",
    evidence.sourceType ? `source:${evidence.sourceType}` : "",
    evidence.excerpt ? `excerpt:${evidence.excerpt.slice(0, 400)}` : "",
  ].filter(Boolean);
  return parts.join(" | ").slice(0, SUPPLIER_SEARCH_LIMITS.maxTotalContextChars);
}

export function evidenceFromInternalMatch(input: {
  supplier: string;
  sku?: string | null;
  canonicalProduct: string;
  material?: string | null;
  primaryFunction?: string | null;
  intendedUse?: string | null;
  approvedTariff?: string | null;
  sourceType: SupplierEvidenceSourceType;
  confidence?: number;
  technicalSpecifications?: Record<string, string | number | boolean | null>;
}): StructuredProductEvidence {
  return {
    supplier: input.supplier,
    supplierSku: input.sku || "",
    canonicalProduct: input.canonicalProduct,
    material: input.material || "",
    composition: "",
    capacity: String(input.technicalSpecifications?.capacity || ""),
    dimensions: "",
    technicalSpecifications: {
      ...(input.technicalSpecifications || {}),
      approvedTariff: input.approvedTariff || null,
    },
    primaryFunction: input.primaryFunction || "packaging container",
    intendedUse: input.intendedUse || "packaging",
    emptyOrFilled: (input.technicalSpecifications?.containerState as "empty" | "filled" | "unknown") || "empty",
    sourceUrl: "",
    sourceType: input.sourceType,
    retrievedAt: new Date().toISOString(),
    evidenceConfidence: input.confidence ?? 0.95,
    excerpt: `${input.canonicalProduct}${input.material ? `, ${input.material}` : ""}`.slice(
      0,
      SUPPLIER_SEARCH_LIMITS.maxEvidenceCharsPerSource,
    ),
  };
}

/**
 * Heuristic extract from a short supplier page/snippet (already truncated).
 * Used when PRODUCT_LOOKUP_URL or a fetched official page returns text.
 */
export function extractProductEvidenceFromText(input: {
  supplier: string;
  sku?: string | null;
  text: string;
  sourceUrl?: string;
  sourceType?: SupplierEvidenceSourceType;
}): StructuredProductEvidence | null {
  const text = String(input.text || "").replace(/\s+/g, " ").trim().slice(0, SUPPLIER_SEARCH_LIMITS.maxEvidenceCharsPerSource);
  if (!text) return null;
  const bottle = /\bbottle\b/i.test(text);
  const glass = /\b(flint|glass)\b/i.test(text);
  const plastic = /\b(plastic|pet|hdpe)\b/i.test(text);
  const empty = /\bempty\b/i.test(text) || /\b24-?414\b/.test(text) || bottle;
  const neck = text.match(/\b(\d{2})\s*[-–]?\s*(\d{3})\b/);
  const oz = text.match(/\b(\d+(?:\.\d+)?)\s*oz\b/i);
  if (!bottle && !glass && !plastic) return null;

  return {
    supplier: input.supplier,
    supplierSku: input.sku || "",
    canonicalProduct: glass || (!plastic && bottle)
      ? "empty glass packaging bottle"
      : "empty plastic packaging bottle",
    material: glass ? (/\bflint\b/i.test(text) ? "flint glass" : "glass") : plastic ? "plastics" : "",
    composition: "",
    capacity: oz ? `${oz[1]} oz` : "",
    dimensions: "",
    technicalSpecifications: {
      neckFinish: neck ? `${neck[1]}-${neck[2]}` : null,
      bottleStyle: /\bwoozy\b/i.test(text) ? "woozy" : null,
      suppliedEmpty: empty,
      containerState: empty ? "empty" : "unknown",
      classificationObject: "container",
    },
    primaryFunction: "contain and protect goods as packaging",
    intendedUse: "packaging",
    emptyOrFilled: empty ? "empty" : "unknown",
    sourceUrl: input.sourceUrl || "",
    sourceType: input.sourceType || "supplier_official",
    retrievedAt: new Date().toISOString(),
    evidenceConfidence: input.sourceType === "supplier_official" ? 0.85 : 0.65,
    excerpt: text,
  };
}
