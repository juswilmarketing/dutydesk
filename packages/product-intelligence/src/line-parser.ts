import type {
  AbbreviationDictionaryEntry,
  DescriptionToken,
  DescriptionTokenType,
  ParsedDimensions,
  ParsedLineDescription,
  ProductQuestion,
} from "@pas/shared-types";
import { splitSkuVariant, stripIdentifierNoise } from "./sku-normalize";

const PRODUCT_NOUNS: Array<{ phrase: string; type: string }> = [
  { phrase: "pipe fitting", type: "Pipe fitting" },
  { phrase: "id card ribbon", type: "Printer ribbon" },
  { phrase: "printer ribbon", type: "Printer ribbon" },
  { phrase: "ink cartridge", type: "Ink cartridge" },
  { phrase: "toner cartridge", type: "Toner cartridge" },
  { phrase: "engraving machine", type: "Engraving machine" },
  { phrase: "power supply", type: "Power supply" },
  { phrase: "cleaning roller", type: "Cleaning roller" },
  // Storage / racking — longest phrases first; tire/tyre is use, not the product
  { phrase: "tire rack", type: "Storage Rack" },
  { phrase: "tyre rack", type: "Storage Rack" },
  { phrase: "storage rack", type: "Storage Rack" },
  { phrase: "shelving unit", type: "Shelving" },
  { phrase: "metal rack", type: "Storage Rack" },
  { phrase: "warehouse rack", type: "Storage Rack" },
  { phrase: "display rack", type: "Storage Rack" },
  { phrase: "racking", type: "Storage Rack" },
  { phrase: "shelving", type: "Shelving" },
  { phrase: "shelf", type: "Shelf" },
  { phrase: "rack", type: "Storage Rack" },
  { phrase: "pipe", type: "Pipe" },
  { phrase: "fitting", type: "Pipe fitting" },
  { phrase: "elbow", type: "Pipe fitting" },
  { phrase: "coupling", type: "Pipe fitting" },
  { phrase: "sheet", type: "Sheet" },
  { phrase: "film", type: "Film" },
  { phrase: "ribbon", type: "Ribbon" },
  { phrase: "cartridge", type: "Cartridge" },
  { phrase: "pump", type: "Pump" },
  { phrase: "tank", type: "Tank" },
  { phrase: "bottle", type: "Bottle" },
  { phrase: "shoe", type: "Shoe" },
  { phrase: "sandal", type: "Sandal" },
  { phrase: "boot", type: "Boot" },
  { phrase: "glove", type: "Glove" },
  { phrase: "cable", type: "Cable" },
  { phrase: "wire", type: "Wire" },
  { phrase: "motor", type: "Motor" },
  { phrase: "valve", type: "Valve" },
  { phrase: "filter", type: "Filter" },
  { phrase: "bearing", type: "Bearing" },
  { phrase: "cutter", type: "Cutter" },
  { phrase: "substrate", type: "Substrate" },
  { phrase: "laminate", type: "Laminate" },
  { phrase: "metal polish", type: "Metal polishing preparation" },
  { phrase: "metal restorer", type: "Metal polishing preparation" },
  { phrase: "furniture polish", type: "Furniture polish" },
  { phrase: "shoe polish", type: "Shoe polish" },
  { phrase: "scouring paste", type: "Scouring preparation" },
  { phrase: "scouring powder", type: "Scouring preparation" },
  { phrase: "cleaning preparation", type: "Cleaning preparation" },
  { phrase: "restorer", type: "Metal polishing preparation" },
  { phrase: "polish", type: "Polishing preparation" },
  { phrase: "detergent", type: "Cleaning preparation" },
  { phrase: "degreaser", type: "Cleaning preparation" },
  { phrase: "adhesive", type: "Adhesive" },
  { phrase: "solvent", type: "Solvent" },
  { phrase: "paint", type: "Paint" },
  { phrase: "coating", type: "Coating" },
];

/** Words that look like ALL-CAPS brands but are product nouns or modifiers. */
const NON_BRAND_LEADING = new Set([
  "tire",
  "tyre",
  "tires",
  "tyres",
  "rack",
  "shelf",
  "metal",
  "steel",
  "plastic",
  "storage",
  "warehouse",
  "display",
  "pipe",
  "pump",
  "tank",
  "valve",
  "cable",
  "wire",
  "motor",
  "filter",
  "shoe",
  "boot",
  "paint",
  "polish",
]);

const COLOURS = [
  "black", "white", "red", "blue", "green", "yellow", "gold", "silver", "grey", "gray",
  "brown", "orange", "purple", "pink", "clear", "transparent", "chrome", "bronze", "copper",
  "ivory", "beige", "navy", "maroon", "teal", "cyan", "magenta",
];

const MATERIALS = [
  "pvc", "abs", "hdpe", "ldpe", "pet", "pp", "pe", "ptfe", "nylon", "steel", "stainless",
  "aluminum", "aluminium", "brass", "copper", "rubber", "silicone", "cotton", "polyester",
  "acrylic", "polycarbonate", "carbon", "ceramic", "glass", "wood", "leather",
];

const DEFAULT_ABBREVS: Record<string, string> = {
  QTR: "quarter sheet / variant",
  PK: "pack",
  EA: "each",
  ASSY: "assembly",
  SS: "stainless steel",
  GALV: "galvanized",
  BLK: "black",
  CLR: "clear",
  WHT: "white",
  LH: "left hand",
  RH: "right hand",
  OD: "outside diameter",
  ID: "inside diameter",
  SCH: "schedule",
};

function resolveAbbrev(
  token: string,
  abbreviations: AbbreviationDictionaryEntry[] | undefined,
  supplier?: string | null,
): string | null {
  const key = token.toUpperCase();
  const supplierNorm = (supplier || "").toLowerCase();
  if (abbreviations?.length) {
    const supplierHit = abbreviations.find(
      (a) =>
        a.status === "active" &&
        a.scope === "supplier" &&
        a.abbreviation.toUpperCase() === key &&
        a.normalized_supplier &&
        supplierNorm.includes(a.normalized_supplier),
    );
    if (supplierHit) return supplierHit.meaning;
    const globalHit = abbreviations.find(
      (a) => a.status === "active" && a.scope === "global" && a.abbreviation.toUpperCase() === key,
    );
    if (globalHit) return globalHit.meaning;
  }
  return DEFAULT_ABBREVS[key] ?? null;
}

function extractDimensions(text: string): ParsedDimensions | null {
  const m = text.match(
    /(\d+(?:\.\d+)?)\s*(?:["”″]|in(?:ch(?:es)?)?|mm|cm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:["”″]|in(?:ch(?:es)?)?|mm|cm)?(?:\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:["”″]|in(?:ch(?:es)?)?|mm|cm)?)?/i,
  );
  if (!m) return null;
  const unitMatch = text.match(/(\d+(?:\.\d+)?)\s*(["”″]|in(?:ch(?:es)?)?|mm|cm)/i);
  let unit = "inch";
  if (unitMatch) {
    const u = unitMatch[2].toLowerCase();
    if (u.startsWith("mm")) unit = "mm";
    else if (u.startsWith("cm")) unit = "cm";
    else unit = "inch";
  }
  return {
    length: parseFloat(m[2]),
    width: parseFloat(m[1]),
    height: m[3] ? parseFloat(m[3]) : null,
    unit,
    raw: m[0],
  };
}

function extractThickness(text: string): string | null {
  const m = text.match(/(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(?:["”″]|in(?:ch(?:es)?)?|mm|cm|mil)\b/i);
  if (!m) return null;
  // Prefer fraction-style thickness when followed by inch marks near start
  const frac = text.match(/(\d+\s*\/\s*\d+)\s*(?:["”″]|in(?:ch(?:es)?)?)?/i);
  if (frac && !/[x×]/i.test(frac.input!.slice(frac.index!, frac.index! + 20))) {
    const unit = /mm/i.test(m[0]) ? "mm" : /cm/i.test(m[0]) ? "cm" : "inch";
    return `${frac[1].replace(/\s+/g, "")} ${unit}`;
  }
  // Avoid treating dimension width as thickness when "NxN" present
  if (/[x×]/i.test(text) && m.index != null) {
    const around = text.slice(Math.max(0, m.index - 2), m.index + m[0].length + 4);
    if (/[x×]/i.test(around)) return null;
  }
  const unit = /mm/i.test(m[0]) ? "mm" : /cm/i.test(m[0]) ? "cm" : /mil/i.test(m[0]) ? "mil" : "inch";
  return `${m[1].replace(/\s+/g, "")} ${unit}`;
}

function extractParentheticalSku(text: string): string | null {
  const m = text.match(/\(([A-Z0-9][A-Z0-9\-_/]{2,})\)/i);
  return m ? m[1].toUpperCase() : null;
}

function extractPartNumbers(text: string): string[] {
  const found: string[] = [];
  const re = /\b([A-Z]{1,6}\d{2,}[\-_]?\d{0,6}(?:[\-_/][A-Z0-9]{1,8})?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1].toUpperCase();
    if (!found.includes(v)) found.push(v);
  }
  return found;
}

function extractColoursAndFinish(text: string): { colours: string[]; styleOrFinish: string | null } {
  const colours: string[] = [];
  // Euro Gold/Black style
  const slash = text.match(
    /\b((?:Euro|Matte|Gloss|Satin|Brushed|Polished)?\s*[A-Za-z]+)\s*\/\s*([A-Za-z]+)\b/,
  );
  let styleOrFinish: string | null = null;
  if (slash) {
    styleOrFinish = `${slash[1].trim()}/${slash[2].trim()}`.replace(/\s+/g, " ");
    for (const part of [slash[1], slash[2]]) {
      for (const c of COLOURS) {
        if (new RegExp(`\\b${c}\\b`, "i").test(part) && !colours.includes(c[0].toUpperCase() + c.slice(1))) {
          colours.push(c[0].toUpperCase() + c.slice(1));
        }
      }
    }
  }
  for (const c of COLOURS) {
    if (new RegExp(`\\b${c}\\b`, "i").test(text)) {
      const label = c[0].toUpperCase() + c.slice(1);
      if (!colours.includes(label)) colours.push(label);
    }
  }
  return { colours, styleOrFinish };
}

function detectProductNoun(text: string): string | null {
  const lower = text.toLowerCase();
  for (const n of PRODUCT_NOUNS) {
    const escaped = n.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // Whole-phrase match — avoid "rack" inside "track" / "racket"
    if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(lower)) {
      return n.type;
    }
  }
  return null;
}

function detectMaterial(text: string): string | null {
  const lower = text.toLowerCase();
  for (const m of MATERIALS) {
    if (new RegExp(`\\b${m}\\b`, "i").test(lower)) {
      if (m === "stainless") return "stainless steel";
      return m.toUpperCase() === m ? m : m;
    }
  }
  return null;
}

function leadingBrand(text: string): string | null {
  const m = text.trim().match(/^([A-Z][A-Z0-9]{2,})\b/);
  if (!m) return null;
  const word = m[1];
  // Skip if it's clearly a part number (has many digits) or known packaging
  if (/^\d/.test(word)) return null;
  if (DEFAULT_ABBREVS[word]) return null;
  if (/^[A-Z]+\d+$/.test(word) && /\d{3,}/.test(word)) return null;
  if (NON_BRAND_LEADING.has(word.toLowerCase())) return null;
  return word;
}

function identityQuestions(parsed: Partial<ParsedLineDescription>): ProductQuestion[] {
  const qs: ProductQuestion[] = [];
  if (!parsed.productType && !parsed.productNoun) {
    qs.push({
      id: "identity_product_type",
      field: "product_type",
      prompt: "What is the product?",
      required: true,
    });
  }
  if (!parsed.material) {
    qs.push({
      id: "identity_material",
      field: "material",
      prompt: "What material is it made from?",
      options: ["Plastic", "Metal", "Paper", "Rubber", "Fabric", "Composite", "Unknown"],
      required: true,
    });
  }
  if (!parsed.function) {
    qs.push({
      id: "identity_function",
      field: "primary_function",
      prompt: "What is it used for?",
      required: true,
    });
  }
  qs.push({
    id: "identity_catalogue",
    field: "catalogue_available",
    prompt: "Is a product catalogue or specification available?",
    options: ["Yes", "No", "Will upload"],
    required: false,
  });
  return qs;
}

export function parseInvoiceLineDescription(
  rawDescription: string,
  opts?: {
    supplier?: string | null;
    abbreviations?: AbbreviationDictionaryEntry[];
    knownBrand?: string | null;
  },
): ParsedLineDescription {
  const raw = String(rawDescription || "").trim();
  const tokens: DescriptionToken[] = [];
  const unresolvedTokens: string[] = [];

  const dimensions = extractDimensions(raw);
  const thickness = extractThickness(raw);
  const skuParen = extractParentheticalSku(raw);
  const partCandidates = extractPartNumbers(raw.replace(/\([^)]*\)/g, " "));
  const { colours, styleOrFinish } = extractColoursAndFinish(raw);
  const productNoun = detectProductNoun(raw);
  const material = detectMaterial(raw);
  const brand = opts?.knownBrand || leadingBrand(raw);

  // Variant: QTR etc. after comma or as standalone token
  let variant: string | null = null;
  const variantMatch = raw.match(/,\s*([A-Z]{2,6})\b(?!\s*\/)/);
  if (variantMatch) {
    const meaning = resolveAbbrev(variantMatch[1], opts?.abbreviations, opts?.supplier);
    variant = variantMatch[1].toUpperCase();
    tokens.push({ text: variant, type: "variant" });
    if (meaning) tokens.push({ text: `${variant}=${meaning}`, type: "packaging" });
  }

  // Also check bare known abbrevs
  for (const tok of raw.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (tok.length >= 2 && tok.length <= 6 && resolveAbbrev(tok, opts?.abbreviations, opts?.supplier)) {
      if (!variant && DEFAULT_ABBREVS[tok] && !["SS", "OD", "ID"].includes(tok)) {
        // prefer packaging variants
        if (["QTR", "PK", "EA", "ASSY"].includes(tok)) variant = tok;
      }
    }
  }

  const sku = skuParen || (partCandidates.length > 1 ? partCandidates[partCandidates.length - 1] : null);
  let partNumber = partCandidates[0] || null;
  if (sku && partNumber && stripIdentifierNoise(sku).startsWith(stripIdentifierNoise(partNumber))) {
    // keep base part separate from full sku
  } else if (!partNumber && sku) {
    partNumber = splitSkuVariant(sku).basePartNumber;
  }

  // Prefer part without variant suffix when sku has it
  if (partNumber && /[-_/][A-Z]{2,}$/i.test(partNumber) && sku) {
    partNumber = partCandidates.find((p) => p !== sku) || splitSkuVariant(partNumber).basePartNumber;
  }

  const skuParts = splitSkuVariant(sku || partNumber);
  // Prefer base from part number when available
  const baseFromPart = partNumber ? stripIdentifierNoise(partNumber.replace(/[-_/][A-Z]{1,8}$/i, "")) : null;

  if (brand) tokens.push({ text: brand, type: "brand" });
  if (productNoun) tokens.push({ text: productNoun, type: "product_noun" });
  if (thickness) tokens.push({ text: thickness, type: "thickness" });
  if (styleOrFinish) tokens.push({ text: styleOrFinish, type: "finish" });
  for (const c of colours) tokens.push({ text: c, type: "colour" });
  if (partNumber) tokens.push({ text: partNumber, type: "part_number" });
  if (sku) tokens.push({ text: sku, type: "sku" });
  if (dimensions?.raw) tokens.push({ text: dimensions.raw, type: "dimensions" });
  if (material) tokens.push({ text: material, type: "material" });

  // Unknown leftover words
  const consumed = new Set(
    tokens.flatMap((t) => t.text.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean),
  );
  for (const w of raw.split(/[\s,;]+/)) {
    const clean = w.replace(/[()]/g, "").trim();
    if (clean.length < 2) continue;
    const key = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || consumed.has(key)) continue;
    if (/^\d/.test(clean) && /[x×"/]/.test(clean)) continue;
    unresolvedTokens.push(clean);
    tokens.push({ text: clean, type: "unknown" });
  }

  const hasIdentity = Boolean(productNoun);
  const missingFields: string[] = [];
  if (!productNoun) missingFields.push("Actual product type");
  if (!material) missingFields.push("Material");
  if (!hasIdentity) missingFields.push("Primary function/use");

  const identityStatus = hasIdentity ? (material ? "resolved" : "partial") : "unresolved";
  const identityConfidence = hasIdentity ? (material ? 0.75 : 0.45) : 0.15;

  // Keep alphabetic unresolved words (e.g. tire/tyre use modifiers) so retrieval still sees them
  const lexicalLeftovers = unresolvedTokens.filter((t) => {
    if (!/^[A-Za-z][A-Za-z-]{1,}$/.test(t)) return false;
    if (/^(tire|tyre|tires|tyres)$/i.test(t)) return true;
    return !NON_BRAND_LEADING.has(t.toLowerCase());
  });

  const normalizedBits = [
    brand,
    productNoun,
    ...lexicalLeftovers.slice(0, 4),
    material,
    thickness,
    styleOrFinish,
    partNumber,
    variant,
    dimensions ? `${dimensions.width}x${dimensions.length} ${dimensions.unit}` : null,
  ].filter(Boolean);

  const parsed: ParsedLineDescription = {
    rawDescription: raw,
    brandOrProductFamily: brand,
    productType: productNoun,
    productNoun,
    thickness,
    styleOrFinish,
    colour: colours,
    partNumber: partNumber || baseFromPart,
    modelNumber: null,
    variant: variant || skuParts.variantSuffix,
    dimensions,
    sku: sku || null,
    basePartNumber: baseFromPart || skuParts.basePartNumber,
    variantSuffix: skuParts.variantSuffix || variant,
    normalizedSku: skuParts.normalizedSku,
    material,
    function: null,
    packaging: variant ? resolveAbbrev(variant, opts?.abbreviations, opts?.supplier) : null,
    grade: null,
    normalizedDescription: normalizedBits.length ? normalizedBits.join(" · ") : null,
    identityStatus,
    identityConfidence,
    tokens,
    unresolvedTokens: unresolvedTokens.slice(0, 12),
    missingFields,
    suggestedQuestions: [],
    resolutionSource: null,
    catalogueMatchId: null,
  };
  parsed.suggestedQuestions = identityQuestions(parsed);
  return parsed;
}

export function applyClerkIdentityAnswers(
  parsed: ParsedLineDescription,
  answers: Array<{ field: string; value: string }>,
): ParsedLineDescription {
  const next = { ...parsed, colour: [...parsed.colour], tokens: [...parsed.tokens] };
  for (const a of answers) {
    const v = a.value.trim();
    if (!v || /^unknown$/i.test(v)) continue;
    if (a.field === "product_type") {
      next.productType = v;
      next.productNoun = v;
    }
    if (a.field === "material") next.material = v;
    if (a.field === "primary_function" || a.field === "function") next.function = v;
  }
  const hasType = Boolean(next.productType || next.productNoun);
  next.missingFields = [];
  if (!hasType) next.missingFields.push("Actual product type");
  if (!next.material) next.missingFields.push("Material");
  if (!next.function) next.missingFields.push("Primary function/use");
  next.identityStatus = hasType && next.material && next.function ? "resolved" : hasType ? "partial" : "unresolved";
  next.identityConfidence = next.identityStatus === "resolved" ? 0.9 : next.identityStatus === "partial" ? 0.55 : 0.2;
  next.suggestedQuestions = identityQuestions(next);
  next.normalizedDescription = [
    next.brandOrProductFamily,
    next.productType,
    next.material,
    next.thickness,
    next.styleOrFinish,
    next.partNumber,
    next.variant,
  ]
    .filter(Boolean)
    .join(" · ");
  return next;
}

export type { DescriptionTokenType };
