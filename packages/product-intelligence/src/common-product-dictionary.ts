/**
 * High-confidence Common Product Dictionary + Product Family Router.
 * Deterministic fast path for obvious household/commercial appliances.
 * Does not invent tariff codes — only seeds chapters/headings for DB retrieval.
 */

const FOOD_AND_UNRELATED = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
  "39", "40", "61", "62", "63", "64", "87", "94", "95", "96",
];

export type CommonProductEntry = {
  canonicalProduct: string;
  aliases: string[];
  /** Extra regex patterns (optional) beyond alias word-boundary match */
  test?: RegExp;
  productFamily: string;
  productNoun: string;
  primaryFunction: string;
  industry: string;
  likelyChapters: string[];
  likelyHeadings: string[];
  preferredHeadings: string[];
  prohibitedHeadings?: string[];
  excludedChapters?: string[];
  requiredAttributes?: string[];
  searchTerms: string[];
  /** When true, classifier keeps only preferred-heading nationals. */
  hardHeadingGate: boolean;
  confidence: number;
  /** Detect energy from description (stove / oven). */
  energySensitive?: boolean;
};

export type CommonProductMatch = {
  fastPath: true;
  canonicalProduct: string;
  productFamily: string;
  productNoun: string;
  primaryFunction: string;
  industry: string;
  likelyChapters: string[];
  likelyHeadings: string[];
  preferredHeadings: string[];
  prohibitedHeadings: string[];
  excludedChapters: string[];
  requiredAttributes: string[];
  missingCriticalAttributes: string[];
  /** 0–1 product-family confidence */
  confidence: number;
  productFamilyConfidence: number;
  searchTerms: string[];
  hardHeadingGate: boolean;
  energySource?: string;
  notes: string[];
};

/** Built-in dictionary — most specific aliases / patterns first. */
export const COMMON_PRODUCT_DICTIONARY: CommonProductEntry[] = [
  // --- Refrigeration (8418) ---
  {
    canonicalProduct: "chest freezer",
    aliases: ["chest freezer", "chest freezers"],
    productFamily: "refrigeration equipment",
    productNoun: "freezer",
    primaryFunction: "freezing",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8418"],
    preferredHeadings: ["8418"],
    excludedChapters: [...FOOD_AND_UNRELATED, "85", "73"],
    searchTerms: ["freezers", "refrigerators", "freezing"],
    hardHeadingGate: true,
    confidence: 0.99,
  },
  {
    canonicalProduct: "freezer",
    aliases: ["freezer", "freezers", "upright freezer", "deep freezer"],
    productFamily: "refrigeration equipment",
    productNoun: "freezer",
    primaryFunction: "freezing",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8418"],
    preferredHeadings: ["8418"],
    excludedChapters: [...FOOD_AND_UNRELATED, "85", "73"],
    searchTerms: ["freezers", "refrigerators", "freezing"],
    hardHeadingGate: true,
    confidence: 0.99,
  },
  {
    canonicalProduct: "display refrigerator",
    aliases: ["display refrigerator", "display fridge", "refrigerated cabinet", "commercial refrigerator"],
    productFamily: "refrigeration equipment",
    productNoun: "refrigerator",
    primaryFunction: "refrigeration",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8418"],
    preferredHeadings: ["8418"],
    excludedChapters: [...FOOD_AND_UNRELATED, "85", "73"],
    searchTerms: ["refrigerators", "freezers", "refrigerating"],
    hardHeadingGate: true,
    confidence: 0.98,
  },
  {
    canonicalProduct: "refrigerator",
    aliases: [
      "refrigerator",
      "refrigerators",
      "fridge",
      "fridges",
      "refridgerator",
      "refrigeration unit",
      "domestic refrigerator",
    ],
    test: /\brefrig(?:erator|eration)\b|\bfridge\b/i,
    productFamily: "refrigeration equipment",
    productNoun: "refrigerator",
    primaryFunction: "refrigeration or freezing",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8418"],
    preferredHeadings: ["8418"],
    excludedChapters: [...FOOD_AND_UNRELATED, "85", "73"],
    searchTerms: ["refrigerators", "freezers", "refrigerating equipment"],
    hardHeadingGate: true,
    confidence: 0.99,
  },

  // --- Air conditioning (8415) — before generic "conditioner" ---
  {
    canonicalProduct: "air conditioner",
    aliases: [
      "air conditioner",
      "air conditioners",
      "air-conditioner",
      "a/c unit",
      "ac unit",
      "split ac",
      "split a/c",
      "window ac",
    ],
    test: /\bair[\s-]?condition(?:er|ing)?\b|\bsplit\s*a\/?c\b|\ba\/?c\s*unit\b/i,
    productFamily: "air conditioning equipment",
    productNoun: "air conditioner",
    primaryFunction: "air conditioning",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8415"],
    preferredHeadings: ["8415"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["air conditioning machines", "air conditioners"],
    hardHeadingGate: true,
    confidence: 0.98,
  },

  // --- Laundry ---
  {
    canonicalProduct: "washing machine",
    aliases: ["washing machine", "washing machines", "washer", "washers", "clothes washer"],
    test: /\bwashing\s*machines?\b|\bclothes\s*washer\b|\bwasher\b(?!\s*fluid)/i,
    productFamily: "laundry equipment",
    productNoun: "washing machine",
    primaryFunction: "washing clothes",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8450"],
    preferredHeadings: ["8450"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["washing machines", "household or laundry"],
    hardHeadingGate: true,
    confidence: 0.98,
  },
  {
    canonicalProduct: "clothes dryer",
    aliases: ["tumble dryer", "clothes dryer", "laundry dryer", "dryer", "dryers"],
    test: /\b(tumble\s*)?dryers?\b|\bclothes\s*dryer\b/i,
    productFamily: "laundry equipment",
    productNoun: "dryer",
    primaryFunction: "drying clothes",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8451"],
    preferredHeadings: ["8451"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["dryers", "drying machines", "clothes"],
    hardHeadingGate: true,
    confidence: 0.96,
  },

  // --- Dishwasher ---
  {
    canonicalProduct: "dishwasher",
    aliases: ["dishwasher", "dishwashers", "dish washer"],
    productFamily: "dishwashing equipment",
    productNoun: "dishwasher",
    primaryFunction: "washing dishes",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8422"],
    preferredHeadings: ["8422"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["dish washing machines", "dishwasher"],
    hardHeadingGate: true,
    confidence: 0.98,
  },

  // --- Microwave ---
  {
    canonicalProduct: "microwave oven",
    aliases: ["microwave", "microwaves", "microwave oven", "microwave ovens"],
    test: /\bmicrowaves?\b/i,
    productFamily: "microwave cooking appliance",
    productNoun: "microwave",
    primaryFunction: "microwave cooking",
    industry: "appliances",
    likelyChapters: ["85"],
    likelyHeadings: ["8516"],
    preferredHeadings: ["8516"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "84", "94"],
    searchTerms: ["microwave ovens", "electro-thermic"],
    hardHeadingGate: true,
    confidence: 0.99,
  },

  // --- Cooking / stove (energy-sensitive) ---
  {
    canonicalProduct: "stove",
    aliases: [
      "stove",
      "stoves",
      "cooker",
      "cookers",
      "range",
      "ranges",
      "cooking range",
      "cooktop",
      "cook top",
      "gas stove",
      "electric stove",
      "oven",
      "ovens",
    ],
    test: /\b(stoves?|cookers?|cooktops?|cooking\s*ranges?|ranges?|ovens?)\b/i,
    productFamily: "cooking appliance",
    productNoun: "stove",
    primaryFunction: "cooking",
    industry: "appliances",
    likelyChapters: ["85", "73"],
    likelyHeadings: ["8516", "7321"],
    preferredHeadings: ["8516", "7321"],
    excludedChapters: [...FOOD_AND_UNRELATED, "87", "94", "63"],
    requiredAttributes: ["energy source"],
    searchTerms: ["cooking", "stoves", "ovens", "cookers"],
    hardHeadingGate: false,
    confidence: 0.97,
    energySensitive: true,
  },

  // --- Display / interactive panels (before generic "range"/machinery) ---
  {
    canonicalProduct: "interactive flat panel display",
    aliases: [
      "interactive display",
      "interactive flat panel",
      "interactive flat panel display",
      "flat panel display",
      "digital signage",
      "touch screen display",
    ],
    test: /\binteractive\s*(flat\s*)?(panel\s*)?display\b|\bflat\s*panel\s*display\b|\bdigital\s*signage\b/i,
    productFamily: "display equipment",
    productNoun: "display",
    primaryFunction: "interactive visual display / presentation",
    industry: "electronics",
    likelyChapters: ["85"],
    likelyHeadings: ["8528"],
    preferredHeadings: ["8528"],
    prohibitedHeadings: ["8501", "8504"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "84", "94"],
    searchTerms: ["monitors", "projectors", "reception apparatus for television"],
    hardHeadingGate: true,
    confidence: 0.96,
  },

  // --- Television ---
  {
    canonicalProduct: "television",
    aliases: ["television", "televisions", "tv", "tvs", "smart tv", "led tv", "lcd tv"],
    test: /\b(smart\s*)?t\.?v\.?s?\b|\btelevisions?\b|\b(led|lcd|oled)\s*tv\b/i,
    productFamily: "television equipment",
    productNoun: "television",
    primaryFunction: "television reception / display",
    industry: "electronics",
    likelyChapters: ["85"],
    likelyHeadings: ["8528"],
    preferredHeadings: ["8528"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "84", "94"],
    searchTerms: ["television receivers", "monitors"],
    hardHeadingGate: true,
    confidence: 0.98,
  },

  // --- Fan ---
  {
    canonicalProduct: "fan",
    aliases: ["fan", "fans", "ceiling fan", "standing fan", "pedestal fan", "table fan"],
    test: /\b(ceiling|standing|pedestal|table|exhaust)?\s*fans?\b/i,
    productFamily: "ventilating fan",
    productNoun: "fan",
    primaryFunction: "ventilating / air moving",
    industry: "appliances",
    likelyChapters: ["84"],
    likelyHeadings: ["8414"],
    preferredHeadings: ["8414"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["fans", "ventilating"],
    hardHeadingGate: true,
    confidence: 0.94,
  },

  // --- Small electrothermic / electromechanical ---
  {
    canonicalProduct: "blender",
    aliases: ["blender", "blenders", "food blender", "smoothie blender"],
    productFamily: "electro-mechanical domestic appliance",
    productNoun: "blender",
    primaryFunction: "blending food",
    industry: "appliances",
    likelyChapters: ["85"],
    likelyHeadings: ["8509"],
    preferredHeadings: ["8509"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "84", "94"],
    searchTerms: ["electro-mechanical domestic appliances", "food grinders"],
    hardHeadingGate: true,
    confidence: 0.96,
  },
  {
    canonicalProduct: "electric kettle",
    aliases: ["kettle", "kettles", "electric kettle", "tea kettle"],
    test: /\b(electric\s*)?kettles?\b/i,
    productFamily: "electro-thermic appliance",
    productNoun: "kettle",
    primaryFunction: "heating water",
    industry: "appliances",
    likelyChapters: ["85"],
    likelyHeadings: ["8516"],
    preferredHeadings: ["8516"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["electric instantaneous", "water heaters", "kettles"],
    hardHeadingGate: true,
    confidence: 0.95,
  },
  {
    canonicalProduct: "water heater",
    aliases: ["water heater", "water heaters", "geyser", "hot water heater", "electric water heater"],
    productFamily: "water heating appliance",
    productNoun: "water heater",
    primaryFunction: "heating water",
    industry: "appliances",
    likelyChapters: ["85"],
    likelyHeadings: ["8516"],
    preferredHeadings: ["8516"],
    excludedChapters: [...FOOD_AND_UNRELATED, "73", "94"],
    searchTerms: ["water heaters", "immersion heaters", "electric"],
    hardHeadingGate: true,
    confidence: 0.96,
  },
];

function normalizeEnergySource(value: string | undefined | null): string {
  const v = String(value || "").toLowerCase().trim();
  if (!v || /^unknown$/i.test(v)) return "";
  if (/dual/.test(v)) return "dual fuel";
  if (/electric|elec\b|induction/.test(v)) return "electric";
  if (/gas|lpg|propane|natural gas/.test(v)) return "gas";
  if (/solid|wood|charcoal|coal/.test(v)) return "solid fuel";
  if (/other/.test(v)) return "other";
  return v;
}

function detectEnergyFromText(text: string): string {
  const t = text.toLowerCase();
  if (/\bdual[\s-]?fuel\b/.test(t)) return "dual fuel";
  if (/\b(electric|induction|elec\.?)\b/.test(t)) return "electric";
  if (/\b(gas|lpg|propane)\b/.test(t)) return "gas";
  if (/\b(wood|charcoal|solid\s*fuel)\b/.test(t)) return "solid fuel";
  return "";
}

function aliasMatches(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function findEntry(raw: string, dictionary: CommonProductEntry[]): CommonProductEntry | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  // Prefer longer alias hits — dictionary is ordered specific-first
  for (const entry of dictionary) {
    // Avoid hair dryer → laundry dryer; microwave already matched earlier
    if (entry.canonicalProduct === "clothes dryer" && /\bhair\s*dryers?\b/i.test(text)) continue;
    if (entry.canonicalProduct === "stove" && /\bmicrowaves?\b/i.test(text)) continue;
    if (entry.test?.test(text)) return entry;
    for (const alias of entry.aliases) {
      if (aliasMatches(text, alias)) return entry;
    }
  }
  return null;
}

/** Map a product_family_rules DB row into a dictionary entry. */
export function commonProductEntryFromRule(row: {
  canonical_product: string;
  alias: string;
  product_family: string;
  likely_chapters?: string[] | string;
  likely_headings?: string[] | string;
  required_attributes?: string[] | string;
  prohibited_chapters?: string[] | string;
  priority?: number;
}): CommonProductEntry {
  const parseList = (v: string[] | string | undefined): string[] => {
    if (Array.isArray(v)) return v;
    if (!v) return [];
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  const chapters = parseList(row.likely_chapters);
  const headings = parseList(row.likely_headings);
  const required = parseList(row.required_attributes);
  const prohibited = parseList(row.prohibited_chapters);
  return {
    canonicalProduct: row.canonical_product,
    aliases: [row.alias],
    productFamily: row.product_family,
    productNoun: row.canonical_product,
    primaryFunction: row.product_family,
    industry: "appliances",
    likelyChapters: chapters.length ? chapters : ["84"],
    likelyHeadings: headings,
    preferredHeadings: headings,
    excludedChapters: prohibited.length ? prohibited : [...FOOD_AND_UNRELATED],
    requiredAttributes: required,
    searchTerms: [row.canonical_product, row.product_family, ...headings],
    hardHeadingGate: headings.length === 1 && !required.includes("energy source"),
    confidence: 0.97,
    energySensitive: required.includes("energy source"),
  };
}

function applyEnergyRouting(
  entry: CommonProductEntry,
  energy: string,
): Pick<
  CommonProductMatch,
  | "likelyChapters"
  | "likelyHeadings"
  | "preferredHeadings"
  | "excludedChapters"
  | "hardHeadingGate"
  | "missingCriticalAttributes"
  | "searchTerms"
  | "notes"
> {
  const baseExcluded = [...(entry.excludedChapters || FOOD_AND_UNRELATED)];
  if (!entry.energySensitive) {
    return {
      likelyChapters: [...entry.likelyChapters],
      likelyHeadings: [...entry.likelyHeadings],
      preferredHeadings: [...entry.preferredHeadings],
      excludedChapters: baseExcluded,
      hardHeadingGate: entry.hardHeadingGate,
      missingCriticalAttributes: [],
      searchTerms: [...entry.searchTerms],
      notes: [],
    };
  }

  if (energy === "electric") {
    return {
      likelyChapters: ["85"],
      likelyHeadings: ["8516"],
      preferredHeadings: ["8516"],
      excludedChapters: [...baseExcluded, "73", "84"],
      hardHeadingGate: true,
      missingCriticalAttributes: [],
      searchTerms: ["electric", "ovens", "cookers", "cooking", "electro-thermic"],
      notes: ["Electric cooking appliance → Chapter 85 / 8516"],
    };
  }
  if (energy === "gas" || energy === "solid fuel") {
    return {
      likelyChapters: ["73"],
      likelyHeadings: ["7321"],
      preferredHeadings: ["7321"],
      excludedChapters: [...baseExcluded, "85", "84"],
      hardHeadingGate: true,
      missingCriticalAttributes: [],
      searchTerms: ["cooking appliances", "stoves", "of iron or steel", "gas"],
      notes: ["Non-electric domestic cooking appliance → Chapter 73 / 7321"],
    };
  }
  if (energy === "dual fuel") {
    return {
      likelyChapters: ["85", "73"],
      likelyHeadings: ["8516", "7321"],
      preferredHeadings: ["8516", "7321"],
      excludedChapters: baseExcluded,
      hardHeadingGate: false,
      missingCriticalAttributes: [],
      searchTerms: ["cooking", "stoves", "ovens", "electric", "gas"],
      notes: ["Dual fuel — provisional candidates under 8516 and 7321"],
    };
  }

  // Unknown energy — ask clerk; keep both families provisional
  return {
    likelyChapters: ["85", "73"],
    likelyHeadings: ["8516", "7321"],
    preferredHeadings: ["8516", "7321"],
    excludedChapters: baseExcluded,
    hardHeadingGate: false,
    missingCriticalAttributes: ["energy source"],
    searchTerms: [...entry.searchTerms],
    notes: ["Energy source unknown — ask clerk before strong recommendation"],
  };
}

/**
 * Resolve obvious merchandise to a product family before broad tariff search.
 */
export function resolveCommonProduct(
  description: string,
  clarification?: { id: string; value: string } | null,
  options?: { extraEntries?: CommonProductEntry[] },
): CommonProductMatch | null {
  const raw = String(description || "").trim();
  if (!raw) return null;

  const clarifiedEnergy =
    clarification?.id === "energy_source" || clarification?.id === "energy source"
      ? normalizeEnergySource(clarification.value)
      : "";
  const searchText = clarifiedEnergy ? `${raw} ${clarifiedEnergy}` : raw;

  // Admin DB rules (extraEntries) take precedence over built-ins
  const dictionary = [
    ...(options?.extraEntries || []),
    ...COMMON_PRODUCT_DICTIONARY,
  ];
  const entry = findEntry(searchText, dictionary) || findEntry(raw, dictionary);
  if (!entry) return null;

  const energy =
    clarifiedEnergy
    || detectEnergyFromText(searchText)
    || detectEnergyFromText(raw);

  const routed = applyEnergyRouting(entry, energy);

  return {
    fastPath: true,
    canonicalProduct: entry.canonicalProduct,
    productFamily: entry.productFamily,
    productNoun: entry.productNoun,
    primaryFunction: entry.primaryFunction,
    industry: entry.industry,
    likelyChapters: routed.likelyChapters,
    likelyHeadings: routed.likelyHeadings,
    preferredHeadings: routed.preferredHeadings,
    prohibitedHeadings: [...(entry.prohibitedHeadings || [])],
    excludedChapters: routed.excludedChapters,
    requiredAttributes: [...(entry.requiredAttributes || [])],
    missingCriticalAttributes: routed.missingCriticalAttributes,
    confidence: entry.confidence,
    productFamilyConfidence: entry.confidence,
    searchTerms: routed.searchTerms,
    hardHeadingGate: routed.hardHeadingGate,
    energySource: energy || undefined,
    notes: routed.notes,
  };
}
