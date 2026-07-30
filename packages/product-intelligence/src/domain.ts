import type { ProductProfile } from "@pas/shared-types";
import { catFromCode } from "@pas/tariff-data";

/** Broad product domains used for chapter gating. */
export type ProductDomain =
  | "food"
  | "animal_plant"
  | "chemicals"
  | "plastics_rubber"
  | "leather"
  | "wood_paper"
  | "textiles"
  | "footwear"
  | "metals"
  | "machinery_electrical"
  | "vehicles"
  | "instruments"
  | "furniture_misc"
  | "unknown";

export const DOMAIN_LABELS: Record<ProductDomain, string> = {
  food: "Food Products",
  animal_plant: "Animal / Plant Origin",
  chemicals: "Chemical / cleaning preparation",
  plastics_rubber: "Plastics / Rubber",
  leather: "Leather",
  wood_paper: "Wood / Paper",
  textiles: "Textiles",
  footwear: "Footwear",
  metals: "Metals",
  machinery_electrical: "Machinery / Electrical",
  vehicles: "Vehicles",
  instruments: "Instruments",
  furniture_misc: "Furniture / Miscellaneous",
  unknown: "Uncertain",
};

/** Chapters typically allowed per domain (inclusive gates). */
export const DOMAIN_CHAPTERS: Record<ProductDomain, string[]> = {
  food: ["01", "02", "03", "04", "07", "08", "09", "10", "11", "12", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"],
  animal_plant: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"],
  chemicals: ["27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38"],
  plastics_rubber: ["39", "40"],
  leather: ["41", "42", "43"],
  wood_paper: ["44", "45", "46", "47", "48", "49"],
  textiles: ["50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63"],
  footwear: ["64", "65", "66", "67"],
  metals: ["72", "73", "74", "75", "76", "78", "79", "80", "81", "82", "83"],
  machinery_electrical: ["84", "85"],
  vehicles: ["86", "87", "88", "89"],
  instruments: ["90", "91", "92"],
  furniture_misc: ["94", "95", "96", "97"],
  unknown: [],
};

const FOOD_CHAPTERS = new Set(DOMAIN_CHAPTERS.food);

export type DomainSignal = {
  domain: ProductDomain;
  confidence: number;
  likelyChapters: string[];
  excludedChapters: string[];
  productTypeHint: string | null;
  functionHints: string[];
  reasons: string[];
};

/**
 * Detect product domain BEFORE tariff / Explanatory Note search.
 * Generic words like paste/cream/polish/preparation must not open food chapters.
 */
export function detectProductDomain(desc: string, profile?: Partial<ProductProfile> | null): DomainSignal {
  const blob = `${desc} ${profile?.normalizedName || ""} ${profile?.productType || ""} ${profile?.productFamily || ""} ${profile?.primaryFunction || ""}`.toLowerCase();
  const reasons: string[] = [];
  const functionHints: string[] = [];
  let productTypeHint: string | null = null;

  // --- High-priority chemical / polishing / cleaning (must beat food false positives) ---
  const isMetalPolish =
    /\bmetal\s+(restorer|polish(?:es|ing)?|cleaner|compound)\b/i.test(blob) ||
    (/\b(polish(?:es|ing)?|restorer)\b/i.test(blob) && /\bmetal\b/i.test(blob));
  const isPolishPrep =
    isMetalPolish ||
    /\b(furniture|shoe|floor|coachwork|glass)\s+polish/i.test(blob) ||
    /\b(scouring\s+(paste|powder|preparation)|cleaning\s+preparation|metal\s+polish)\b/i.test(blob) ||
    (/\bpolish(?:es|ing)?\b/i.test(blob) &&
      !/\b(nail\s+polish|shoe\s+polish\s+remover)\b/i.test(blob) &&
      (/\b(restorer|cream|paste|compound|preparation)\b/i.test(blob) || /\b3m\b/i.test(blob)));

  const isCleaningChem =
    /\b(detergent|degreaser|cleaner|disinfectant|sanitizer|sanitiser|solvent\s+cleaner)\b/i.test(blob);

  if (isMetalPolish || isPolishPrep) {
    reasons.push("metal/cleaning polish preparation signals");
    functionHints.push("polish metal", "restore metal finish", "clean metal");
    productTypeHint = isMetalPolish ? "metal polishing preparation" : "polishing preparation";
    return {
      domain: "chemicals",
      confidence: isMetalPolish ? 0.92 : 0.85,
      likelyChapters: ["34"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint,
      functionHints,
      reasons,
    };
  }

  if (isCleaningChem) {
    reasons.push("cleaning / detergent preparation");
    functionHints.push("clean surfaces");
    productTypeHint = "cleaning preparation";
    return {
      domain: "chemicals",
      confidence: 0.88,
      likelyChapters: ["34", "38"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint,
      functionHints,
      reasons,
    };
  }

  if (profile?.footwear || /\b(shoe|boot|sandal|footwear)\b/i.test(blob)) {
    return {
      domain: "footwear",
      confidence: 0.9,
      likelyChapters: ["64"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: "footwear",
      functionHints: ["wear on feet"],
      reasons: ["footwear signals"],
    };
  }

  // Storage racks / shelving — tire/tyre is intended contents, not the product
  const isStorageRack =
    /\b(tire|tyre)\s+racks?\b/i.test(blob) ||
    /\b(storage|metal|warehouse|display)\s+racks?\b/i.test(blob) ||
    /\b(shelving\s+units?|racking)\b/i.test(blob) ||
    /\b(storage\s+rack|shelving)\b/i.test(`${profile?.productType || ""} ${profile?.productFamily || ""}`) ||
    (/\bracks?\b/i.test(blob) && !/\b(track|racket|rackets)\b/i.test(blob));

  if (isStorageRack) {
    return {
      domain: "furniture_misc",
      confidence: 0.78,
      // Furniture first; also keep metal structures and plastics open when material unknown
      likelyChapters: ["94", "73", "39"],
      excludedChapters: [...FOOD_CHAPTERS, "40", "87"],
      productTypeHint: profile?.productType || "storage rack",
      functionHints: ["store goods", "display goods"],
      reasons: ["storage rack / shelving signals — not a tyre or vehicle part"],
    };
  }

  if (profile?.electrical || /\b(electrical|led|transformer|battery|motor)\b/i.test(blob)) {
    return {
      domain: "machinery_electrical",
      confidence: 0.85,
      likelyChapters: ["85", "84"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: profile?.productType || "electrical article",
      functionHints: ["electrical operation"],
      reasons: ["electrical signals"],
    };
  }

  if (profile?.vehicle || /\b(automotive|vehicle)\b/i.test(blob) || /\b(tyre|tire)s?\b/i.test(blob)) {
    // Bare tyre/tire (not rack) → rubber + vehicle parts
    return {
      domain: "vehicles",
      confidence: 0.8,
      likelyChapters: ["87", "40"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: "vehicle article",
      functionHints: ["vehicle use"],
      reasons: ["vehicle signals"],
    };
  }

  if (profile?.machine || profile?.tool || /\b(machine|pump|compressor|wrench|drill)\b/i.test(blob)) {
    return {
      domain: "machinery_electrical",
      confidence: 0.75,
      likelyChapters: ["84", "82"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: profile?.productType || "machinery/tool",
      functionHints: [],
      reasons: ["machinery/tool signals"],
    };
  }

  if (profile?.textile || /\b(textile|fabric|garment|apparel)\b/i.test(blob)) {
    return {
      domain: "textiles",
      confidence: 0.8,
      likelyChapters: DOMAIN_CHAPTERS.textiles.slice(10, 14),
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: "textile article",
      functionHints: [],
      reasons: ["textile signals"],
    };
  }

  if (profile?.construction || /\b(cement|concrete|rebar|lumber)\b/i.test(blob)) {
    return {
      domain: "metals",
      confidence: 0.7,
      likelyChapters: ["25", "39", "73"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: "construction material",
      functionHints: [],
      reasons: ["construction signals"],
    };
  }

  if (profile?.chemical || /\b(chemical|solvent|acid|adhesive|paint|fertilizer)\b/i.test(blob)) {
    return {
      domain: "chemicals",
      confidence: 0.8,
      likelyChapters: DOMAIN_CHAPTERS.chemicals,
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: "chemical preparation",
      functionHints: [],
      reasons: ["chemical signals"],
    };
  }

  // Explicit edible food — require food-specific nouns, NOT bare paste/cream/preparation
  const edibleFood =
    profile?.food === true ||
    /\b(food|edible|milk|tomato|sugar|rice|flour|meat|fish|fruit|vegetable|spice|spices|beverage|sauce|condiment|cereal|dairy|chocolate|biscuit|cookie)\b/i.test(
      blob,
    ) ||
    /\b(tomato\s+paste|fish\s+paste|meat\s+paste|food\s+paste|food\s+preparation)\b/i.test(blob);

  // Industrial / household / cosmetic / chemical / electrical etc. → never open food on weak terms
  const nonFoodIndustrial =
    /\b(industrial|household|cosmetic|automotive|electrical|mechanical|textile|hardware|abrasive|lubricant)\b/i.test(
      blob,
    ) ||
    Boolean(
      profile?.chemical ||
        profile?.electrical ||
        profile?.vehicle ||
        profile?.machine ||
        profile?.tool ||
        profile?.textile ||
        profile?.construction ||
        profile?.medical,
    );

  if (edibleFood && !nonFoodIndustrial) {
    return {
      domain: "food",
      confidence: 0.75,
      likelyChapters: DOMAIN_CHAPTERS.food,
      excludedChapters: [],
      productTypeHint: "food product",
      functionHints: ["human consumption"],
      reasons: ["edible food signals"],
    };
  }

  if (nonFoodIndustrial) {
    return {
      domain: "chemicals",
      confidence: 0.55,
      likelyChapters: ["34", "38", "32"],
      excludedChapters: [...FOOD_CHAPTERS],
      productTypeHint: profile?.productType || null,
      functionHints: [],
      reasons: ["non-food industrial/household signals — food chapters gated"],
    };
  }

  return {
    domain: "unknown",
    confidence: 0.2,
    likelyChapters: [],
    excludedChapters: [],
    productTypeHint: null,
    functionHints: [],
    reasons: ["insufficient identity for domain gate"],
  };
}

export function chapterInDomain(chapter: string | null | undefined, domain: ProductDomain): boolean {
  if (!chapter || domain === "unknown") return true;
  const ch = chapter.padStart(2, "0");
  const allowed = DOMAIN_CHAPTERS[domain];
  if (!allowed.length) return true;
  return allowed.includes(ch);
}

export function isFoodChapter(codeOrChapter: string | null | undefined): boolean {
  if (!codeOrChapter) return false;
  const ch = codeOrChapter.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
  return FOOD_CHAPTERS.has(ch);
}

/** Strong penalty when selected tariff domain conflicts with predicted product domain. */
export function domainTariffConflict(
  domain: ProductDomain,
  tariffCode: string | null | undefined,
): { conflict: boolean; message: string | null } {
  if (!tariffCode || domain === "unknown") return { conflict: false, message: null };
  const ch = tariffCode.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
  const tariffDomainLabel = catFromCode(tariffCode);

  if (domain !== "food" && isFoodChapter(ch)) {
    return {
      conflict: true,
      message: `Selected tariff belongs to ${tariffDomainLabel}, but this item was identified as ${DOMAIN_LABELS[domain].toLowerCase()}.`,
    };
  }

  if (domain === "chemicals" && FOOD_CHAPTERS.has(ch)) {
    return {
      conflict: true,
      message: `Selected tariff belongs to Food Products, but this item was identified as an industrial metal-polishing or cleaning preparation.`,
    };
  }

  if (DOMAIN_CHAPTERS[domain].length && !DOMAIN_CHAPTERS[domain].includes(ch)) {
    // Softer: only hard-block food↔non-food and clear chemical↔food; other cross-domain is warn-level via message
    if (domain === "footwear" && !["64", "65"].includes(ch)) {
      return {
        conflict: true,
        message: `Selected tariff belongs to ${tariffDomainLabel}, but this item was identified as footwear.`,
      };
    }
  }

  return { conflict: false, message: null };
}

export function applyDomainToProfile(profile: ProductProfile, signal: DomainSignal): ProductProfile {
  const next = { ...profile, attributes: { ...profile.attributes } };
  next.attributes.domain = signal.domain;
  next.attributes.domainLabel = DOMAIN_LABELS[signal.domain];
  next.attributes.likelyChapters = signal.likelyChapters.join(",");
  next.attributes.excludedChapters = signal.excludedChapters.slice(0, 24).join(",");
  if (signal.productTypeHint && !next.productType) next.productType = signal.productTypeHint;
  if (signal.functionHints.length && !next.primaryFunction) {
    next.primaryFunction = signal.functionHints[0];
  }
  if (signal.domain === "chemicals") {
    next.chemical = true;
    next.food = false;
    if (!next.industryCode) {
      next.industryCode = "chemicals";
      next.industry = "Chemicals";
    }
    if (!next.productFamily) next.productFamily = "cleaning and polishing preparations";
  }
  if (signal.domain === "food") {
    next.food = true;
  } else if (signal.confidence >= 0.55) {
    next.food = false;
  }
  return next;
}
