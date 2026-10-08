/**
 * Separate invoice tokens so SKU/admin codes do not dominate tariff search.
 */

export type TokenRole =
  | "supplier_sku"
  | "manufacturer_part"
  | "product_noun"
  | "brand_model"
  | "functional"
  | "material"
  | "dimension_spec"
  | "colour"
  | "pack_quantity"
  | "administrative"
  | "other";

export type WeightedToken = {
  token: string;
  role: TokenRole;
  /** Relative weight for tariff description similarity (0–1). */
  weight: number;
};

const COLOURS = /\b(black|blk|white|wht|red|blue|green|grey|gray|silver|gold|chrome|pass)\b/i;
const PACK = /\b(\d+)\s*(pk|pack|pcs|pc|ea|ctn|pair)\b/i;
const TYRE_SIZE = /\b\d{3}\/\d{2}R\d{2}\b/i;
const DIM = /\b\d+(\.\d+)?\s*(mm|cm|in|inch|"|x)\b/i;

/** Codes that must never drive classification (fuel surcharge, etc.). */
const ADMIN_CODES = new Set(["DF", "FUEL", "SC", "FSC"]);

export function classifyToken(token: string): WeightedToken {
  const t = token.trim();
  if (!t) return { token: t, role: "other", weight: 0 };
  const upper = t.toUpperCase();

  if (ADMIN_CODES.has(upper) || /^DF$/i.test(t)) {
    return { token: t, role: "administrative", weight: 0 };
  }
  if (TYRE_SIZE.test(t) || DIM.test(t) || /^\d{2}X\d/i.test(t) || /^\d+-\d+\.\d+$/.test(t)) {
    return { token: t, role: "dimension_spec", weight: 0.35 };
  }
  if (COLOURS.test(t)) return { token: t, role: "colour", weight: 0.05 };
  if (PACK.test(t)) return { token: t, role: "pack_quantity", weight: 0.08 };
  if (/^(cotton|steel|rubber|plastic|glass|aluminium|aluminum|copper|polyester|nylon)$/i.test(t)) {
    return { token: t, role: "material", weight: 0.85 };
  }
  if (/^(switch|tyre|tire|wheel|rim|nut|bolt|towel|cap|tank|tube|cot|sandal|polish|activator)$/i.test(t)) {
    return { token: t, role: "product_noun", weight: 1 };
  }
  if (/^(wifi|smart|touch|gang|spline|hub|freight|shipping)$/i.test(t)) {
    return { token: t, role: "functional", weight: 0.7 };
  }
  // Long alphanumeric SKUs
  if (/^[A-Z0-9][A-Z0-9+/._-]{5,}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t)) {
    return { token: t, role: "supplier_sku", weight: 0.05 };
  }
  if (/^\d{5,8}$/.test(t)) {
    return { token: t, role: "administrative", weight: 0.02 };
  }
  if (/^[A-Z]{2,}[A-Z0-9-]*$/i.test(t) && t.length >= 3) {
    return { token: t, role: "brand_model", weight: 0.25 };
  }
  return { token: t, role: "other", weight: 0.4 };
}

export function tokenizeForClassification(description: string): WeightedToken[] {
  return String(description || "")
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(classifyToken);
}

/** Query text for tariff retrieval — down-weights SKUs and admin codes. */
export function semanticSearchText(description: string, extraTerms: string[] = []): string {
  const tokens = tokenizeForClassification(description);
  const kept = tokens
    .filter((t) => t.weight >= 0.2)
    .map((t) => t.token);
  const admin = tokens.filter((t) => t.role === "supplier_sku" || t.role === "administrative");
  return [...kept, ...extraTerms, ...admin.map((t) => t.token)].join(" ").trim();
}

export function extractAdministrativeCodes(description: string): string[] {
  return tokenizeForClassification(description)
    .filter((t) => t.role === "supplier_sku" || t.role === "administrative" || t.role === "manufacturer_part")
    .map((t) => t.token);
}
