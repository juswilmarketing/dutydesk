import type { EvidenceParsedDescription } from "@pas/shared-types";

const COLOUR_ABBREVIATIONS: Record<string, string> = {
  BK: "BLACK",
  BLK: "BLACK",
  WHT: "WHITE",
  WH: "WHITE",
  GRY: "GREY",
};

const COLOURS = new Set([
  "BLACK", "WHITE", "RED", "BLUE", "GREEN", "YELLOW", "GOLD", "SILVER", "GREY",
  "GRAY", "BROWN", "ORANGE", "PURPLE", "PINK", "CLEAR", "BRONZE", "BEIGE", "NAVY",
]);

const MATERIALS: Record<string, string> = {
  COTTON: "Cotton",
  MICROFIBRE: "Microfibre",
  MICROFIBER: "Microfibre",
  PAPER: "Paper",
  PLASTIC: "Plastic",
  PVC: "PVC",
  RUBBER: "Rubber",
  STEEL: "Steel",
  SS: "Stainless Steel",
  TEXTILE: "Textile",
  POLYESTER: "Polyester",
  NYLON: "Nylon",
};

const SAFE_PRODUCT_ABBREVIATIONS: Record<string, string> = {
  ASSY: "ASSEMBLY",
  CBL: "CABLE",
  SHWR: "SHOWER",
  DISP: "DISPOSABLE",
  TWL: "TOWEL",
};

const PRODUCT_TERMS = new Set([
  "ACTIVATOR", "ADHESIVE", "ASSEMBLY", "BAG", "BEARING", "BELT", "BOTTLE", "CABLE",
  "CAP", "CARTRIDGE", "CHEMICAL", "COATING", "COUPLING", "DISPOSABLE", "FILTER", "FITTING",
  "GLOVE", "HOSE", "KIT", "MOTOR", "PRIMER", "PUMP", "RIBBON", "ROLLER", "SHEET", "SHOWER",
  "SOLVENT", "TOWEL", "TOWELS", "VALVE", "WIRE",
]);

const KNOWN_BRANDS: Record<string, string> = {
  FLEXLAG: "FLEXCO",
  "FLEX-LAG": "FLEXCO",
  "3M": "3M",
};

const NON_PRODUCT_WORDS = new Set([
  "EURO", "MATTE", "GLOSS", "SATIN", "BRUSHED", "POLISHED", "PK", "PACK", "EA", "EACH",
  "PC", "PCS", "PIECE", "PIECES",
]);

function cleanToken(value: string): string {
  return value.toUpperCase().replace(/^[,;()[\]{}]+|[,;()[\]{}]+$/g, "");
}

function codeKey(value: string): string {
  return value.replace(/[^A-Z0-9]/g, "");
}

function isProductCode(token: string): boolean {
  if (!token || COLOURS.has(token) || COLOUR_ABBREVIATIONS[token] || MATERIALS[token]) return false;
  if (/^[A-Z]{1,8}\d+[A-Z0-9]*(?:[-_/][A-Z0-9]+)+$/.test(token)) return true;
  if (/^[A-Z]{1,6}-[A-Z0-9]{2,}$/.test(token)) return true;
  if (/^[A-Z]{1,5}\d{2,}(?:[-_/][A-Z0-9]+)*$/.test(token)) return true;
  return /^[A-Z0-9]{2,}-\d{2,}$/.test(token);
}

function isDimension(token: string): boolean {
  return /^\d+\s*\/\s*\d+(?:"|IN)?$/.test(token)
    || /^\d+(?:\.\d+)?(?:MM|CM|IN|")$/.test(token)
    || /^\d+(?:\.\d+)?[X×]\d+(?:\.\d+)?(?:[X×]\d+(?:\.\d+)?)?(?:MM|CM|IN|")?$/.test(token);
}

function title(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Parse an invoice description as clues. No tariff or product identity is inferred here. */
export function parseEvidenceDescription(
  rawDescription: string,
  opts?: {
    knownBrand?: string | null;
    knownManufacturer?: string | null;
    abbreviations?: Array<{
      abbreviation: string;
      meaning: string;
      approved: boolean;
      supplier?: string | null;
      surroundingTerms?: string[];
    }>;
  },
): EvidenceParsedDescription {
  const raw = String(rawDescription || "").trim();
  const sourceTokens = raw
    .toUpperCase()
    .replace(/([A-Z]+)\s*\/\s*([A-Z]+)/g, "$1/$2")
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean);

  const possibleProductCode = sourceTokens.find(isProductCode) || "";
  const possibleSku = possibleProductCode;
  const colours: string[] = [];
  const dimensions: string[] = [];
  const productWords: string[] = [];
  const unresolvedTokens: string[] = [];
  let quantity = "";
  let size = "";
  let grade = "";
  let material = "";
  let model = "";

  const explicitBrand = opts?.knownBrand?.trim().toUpperCase() || "";
  const brandToken = sourceTokens.find((token) => KNOWN_BRANDS[token]);
  const possibleBrand = explicitBrand || brandToken || "";
  const possibleManufacturer =
    opts?.knownManufacturer?.trim().toUpperCase()
    || (possibleBrand ? KNOWN_BRANDS[possibleBrand] || "" : "");

  for (const original of sourceTokens) {
    const token = original.replace(/[.,;:]$/g, "");
    if (!token || token === possibleProductCode || token === possibleBrand) continue;

    const quantityMatch = token.match(/^(\d+)(PC|PCS|PK|PACK|EA)$/);
    if (quantityMatch) {
      quantity = `${quantityMatch[1]} ${quantityMatch[2] === "EA" ? "EACH" : quantityMatch[2].startsWith("P") && quantityMatch[2] !== "PC" && quantityMatch[2] !== "PCS" ? "PACK" : "PIECES"}`;
      continue;
    }
    if (isDimension(token)) {
      dimensions.push(token.replace(/\s+/g, ""));
      continue;
    }
    if (/^(XXS|XS|S|M|L|XL|XXL|XXXL)$/.test(token)) {
      size = token;
      continue;
    }
    if (/^(GRADE|GR)\d+[A-Z]?$/.test(token) || /^\d{3,4}[A-Z]?$/.test(token)) {
      grade = token.replace(/^GR(?:ADE)?/, "");
      continue;
    }
    if (COLOUR_ABBREVIATIONS[token]) {
      colours.push(COLOUR_ABBREVIATIONS[token]);
      continue;
    }
    const slashColours = token.split("/");
    if (slashColours.length > 1 && slashColours.every((part) => COLOURS.has(part))) {
      colours.push(...slashColours.map((part) => part === "GRAY" ? "GREY" : part));
      continue;
    }
    if (COLOURS.has(token)) {
      colours.push(token === "GRAY" ? "GREY" : token);
      continue;
    }
    if (MATERIALS[token]) {
      material = MATERIALS[token];
      continue;
    }
    if (SAFE_PRODUCT_ABBREVIATIONS[token]) {
      productWords.push(SAFE_PRODUCT_ABBREVIATIONS[token]);
      continue;
    }
    const dynamicMeanings = (opts?.abbreviations || [])
      .filter((entry) => entry.approved && entry.abbreviation.toUpperCase() === token)
      .filter((entry) => {
        if (!entry.surroundingTerms?.length) return true;
        return entry.surroundingTerms.some((term) => sourceTokens.includes(term.toUpperCase()));
      })
      .map((entry) => entry.meaning.toUpperCase())
      .filter((meaning, index, all) => all.indexOf(meaning) === index);
    if (dynamicMeanings.length === 1) {
      const meaning = dynamicMeanings[0];
      if (COLOURS.has(meaning)) colours.push(meaning);
      else if (MATERIALS[meaning]) material = MATERIALS[meaning];
      else productWords.push(...meaning.split(/\s+/).filter(Boolean));
      continue;
    }
    if (PRODUCT_TERMS.has(token)) {
      productWords.push(token);
      continue;
    }
    if (token === "ACT") {
      const contextSupportsActivator = sourceTokens.some((value) =>
        ["ADHESIVE", "RUBBER", "PRIMER", "FLEXLAG"].includes(value));
      if (contextSupportsActivator) productWords.push("ACTIVATOR");
      else unresolvedTokens.push(token);
      continue;
    }
    if (NON_PRODUCT_WORDS.has(token)) {
      if (token === "EURO") unresolvedTokens.push(token);
      continue;
    }
    if (/^[A-Z]{1,4}$/.test(token)) {
      unresolvedTokens.push(token);
      continue;
    }
    if (/^[A-Z0-9][A-Z0-9._/-]+$/.test(token)) {
      if (!model && /\d/.test(token)) model = token;
      else unresolvedTokens.push(token);
      continue;
    }
    productWords.push(token);
  }

  const uniqueProductWords = [...new Set(productWords)];
  const uniqueColours = [...new Set(colours)];
  return {
    rawDescription: raw,
    possibleProductCode,
    possibleSku,
    possibleBrand: possibleBrand ? title(possibleBrand.replace(/FLEXLAG/g, "Flex-Lag")) : "",
    possibleManufacturer: possibleManufacturer ? title(possibleManufacturer) : "",
    productWords: uniqueProductWords.map(title),
    attributes: {
      colour: uniqueColours.join("/"),
      size,
      dimensions: dimensions.join(" × "),
      quantity,
      model,
      grade,
      material,
    },
    unresolvedTokens: [...new Set(unresolvedTokens)],
    coreDescription: uniqueProductWords.map(title).join(" "),
  };
}

export function normalizeEvidenceSearch(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/([A-Z])[-_/](?=[A-Z0-9])/g, "$1")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProductCode(value: string): string {
  return codeKey(String(value || "").toUpperCase());
}
