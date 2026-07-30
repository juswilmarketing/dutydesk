/** Normalize part numbers / SKUs for lookup without dropping meaningful alphanumerics. */

export function stripIdentifierNoise(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeIdentifierVariants(raw: string): string[] {
  const original = String(raw || "").trim();
  if (!original) return [];
  const upper = original.toUpperCase();
  const noSpaces = upper.replace(/\s+/g, "");
  const alnum = stripIdentifierNoise(original);
  const dashed = upper.replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  const variants = new Set<string>([original, upper, noSpaces, alnum, dashed].filter(Boolean));
  return [...variants];
}

export interface NormalizedSkuParts {
  original: string;
  basePartNumber: string | null;
  variantSuffix: string | null;
  normalizedSku: string | null;
}

/** Split PM922754-QTR → base PM922754 + variant QTR */
export function splitSkuVariant(raw: string | null | undefined): NormalizedSkuParts {
  const original = String(raw || "").trim();
  if (!original) {
    return { original: "", basePartNumber: null, variantSuffix: null, normalizedSku: null };
  }
  const m = original.match(/^(.+?)[-_/]([A-Za-z]{1,8})$/);
  if (m && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1])) {
    const base = stripIdentifierNoise(m[1]);
    const suffix = m[2].toUpperCase();
    return {
      original,
      basePartNumber: base || null,
      variantSuffix: suffix,
      normalizedSku: `${base}${suffix}`,
    };
  }
  const norm = stripIdentifierNoise(original);
  return {
    original,
    basePartNumber: norm || null,
    variantSuffix: null,
    normalizedSku: norm || null,
  };
}

export function identifiersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = stripIdentifierNoise(a);
  const nb = stripIdentifierNoise(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = splitSkuVariant(a);
  const sb = splitSkuVariant(b);
  if (sa.basePartNumber && sb.basePartNumber && sa.basePartNumber === sb.basePartNumber) {
    if (!sa.variantSuffix || !sb.variantSuffix) return true;
    return sa.variantSuffix === sb.variantSuffix;
  }
  return false;
}
