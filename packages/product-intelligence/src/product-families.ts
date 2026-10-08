/**
 * Config-driven Product Family Registry.
 * Families narrow the legal tariff search space — they never invent national codes.
 * Extensible via PRODUCT_FAMILY_REGISTRY and DB product_family_rules.
 */

export type FamilyQuestion = {
  id: string;
  prompt: string;
  options: string[];
  /** Attribute key filled when answered */
  attributeKey: string;
};

export type ProductFamilyDefinition = {
  id: string;
  label: string;
  /** Match against canonical product / noun / description */
  aliases: string[];
  test?: RegExp;
  productDomain: string;
  requiredAttributes: string[];
  optionalAttributes: string[];
  questionPriority: FamilyQuestion[];
  likelyChapters: string[];
  likelyHeadings: string[];
  excludedChapters: string[];
  excludedHeadings: string[];
  /** Domains that are hard contradictions for candidates */
  forbiddenDomains: string[];
  /** Search terms for tariff lexical retrieval under gated headings */
  searchTerms: string[];
  confidence: number;
};

const FOOD_CHAPTERS = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const NON_APPLIANCE = ["39", "40", "61", "62", "63", "64", "87", "94", "95", "96", ...FOOD_CHAPTERS];

/** Built-in family profiles — data, not per-SKU tariff answers. */
export const PRODUCT_FAMILY_REGISTRY: ProductFamilyDefinition[] = [
  {
    id: "refrigeration_equipment",
    label: "Refrigeration Equipment",
    aliases: ["refrigerator", "fridge", "freezer", "chest freezer", "refrigeration", "refrigerated cabinet"],
    test: /\b(refrigerat|fridge|freezer)\b/i,
    productDomain: "machinery_appliances",
    requiredAttributes: [],
    optionalAttributes: ["refrigerator or freezer", "domestic or commercial", "capacity"],
    questionPriority: [
      {
        id: "fridge_type",
        prompt: "Is this a refrigerator, freezer, or combined refrigerator-freezer?",
        options: ["Refrigerator", "Freezer", "Combined refrigerator-freezer", "Unknown"],
        attributeKey: "refrigerator or freezer",
      },
    ],
    likelyChapters: ["84"],
    likelyHeadings: ["8418"],
    excludedChapters: [...NON_APPLIANCE, "85", "73"],
    excludedHeadings: ["8415", "8501", "8528"],
    forbiddenDomains: ["food", "furniture", "textile", "vehicle", "display", "motor"],
    searchTerms: ["refrigerators", "freezers", "refrigerating"],
    confidence: 0.98,
  },
  {
    id: "air_conditioning",
    label: "Air Conditioning Equipment",
    aliases: ["air conditioner", "air conditioning", "split ac", "a/c unit"],
    test: /\bair[\s-]?condition|\bsplit\s*a\/?c\b|\ba\/?c\s*unit\b/i,
    productDomain: "machinery_appliances",
    requiredAttributes: [],
    optionalAttributes: ["window or split", "domestic or commercial"],
    questionPriority: [],
    likelyChapters: ["84"],
    likelyHeadings: ["8415"],
    excludedChapters: [...NON_APPLIANCE, "73"],
    excludedHeadings: ["8418", "8501"],
    forbiddenDomains: ["food", "furniture", "textile", "vehicle", "refrigeration"],
    searchTerms: ["air conditioning machines", "air conditioners"],
    confidence: 0.97,
  },
  {
    id: "microwave_cooking",
    label: "Microwave Cooking Appliance",
    aliases: ["microwave", "microwave oven"],
    test: /\bmicrowaves?\b/i,
    productDomain: "electrothermic",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["85"],
    likelyHeadings: ["8516"],
    excludedChapters: [...NON_APPLIANCE, "73", "84"],
    excludedHeadings: ["8501", "8418"],
    forbiddenDomains: ["food", "motor", "refrigeration", "furniture"],
    searchTerms: ["microwave ovens", "electro-thermic"],
    confidence: 0.98,
  },
  {
    id: "cooking_appliances",
    label: "Cooking Appliances",
    aliases: ["stove", "cooker", "range", "oven", "cooktop", "cooking range"],
    test: /\b(stoves?|cookers?|cooktops?|cooking\s*ranges?|ovens?)\b/i,
    productDomain: "cooking_appliances",
    requiredAttributes: ["energy source"],
    optionalAttributes: ["domestic or commercial", "combined oven or cooktop"],
    questionPriority: [
      {
        id: "energy_source",
        prompt: "What powers this stove?",
        options: ["Electric", "Gas", "Dual fuel", "Other", "Unknown"],
        attributeKey: "energy source",
      },
    ],
    likelyChapters: ["85", "73"],
    likelyHeadings: ["8516", "7321"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "87", "94"],
    excludedHeadings: ["8501", "8418"],
    forbiddenDomains: ["food", "furniture", "textile", "vehicle", "motor"],
    searchTerms: ["cooking", "stoves", "ovens", "cookers"],
    confidence: 0.96,
  },
  {
    id: "laundry_equipment",
    label: "Laundry Equipment",
    aliases: ["washing machine", "washer", "dryer", "tumble dryer", "clothes dryer"],
    test: /\bwashing\s*machines?\b|\bclothes\s*washer\b|\b(tumble\s*)?dryers?\b/i,
    productDomain: "machinery_appliances",
    requiredAttributes: [],
    optionalAttributes: ["washer or dryer", "capacity"],
    questionPriority: [],
    likelyChapters: ["84"],
    likelyHeadings: ["8450", "8451"],
    excludedChapters: [...NON_APPLIANCE, "73"],
    excludedHeadings: ["8501"],
    forbiddenDomains: ["food", "textile", "furniture", "vehicle"],
    searchTerms: ["washing machines", "dryers", "laundry"],
    confidence: 0.96,
  },
  {
    id: "dishwashing_equipment",
    label: "Dishwashing Equipment",
    aliases: ["dishwasher", "dish washer"],
    test: /\bdish\s*washers?\b/i,
    productDomain: "machinery_appliances",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["84"],
    likelyHeadings: ["8422"],
    excludedChapters: [...NON_APPLIANCE, "73"],
    excludedHeadings: [],
    forbiddenDomains: ["food", "textile", "furniture"],
    searchTerms: ["dish washing machines"],
    confidence: 0.97,
  },
  {
    id: "display_equipment",
    label: "Display Equipment",
    aliases: [
      "interactive display",
      "interactive flat panel",
      "flat panel display",
      "monitor",
      "display",
      "digital signage",
      "touch screen display",
    ],
    test: /\b(interactive\s*(flat\s*)?(panel\s*)?display|flat\s*panel|digital\s*signage|touch\s*screen\s*display|\bmonitors?\b)\b/i,
    productDomain: "display_equipment",
    requiredAttributes: [],
    optionalAttributes: ["tuner present", "integrated computer", "touch capability"],
    questionPriority: [
      {
        id: "tuner_present",
        prompt: "Does the unit have a television tuner?",
        options: ["Yes", "No", "Unknown"],
        attributeKey: "tuner present",
      },
    ],
    likelyChapters: ["85"],
    likelyHeadings: ["8528"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "73", "84", "87", "94"],
    excludedHeadings: ["8501", "8504", "8536", "8544"],
    forbiddenDomains: ["motor", "food", "furniture", "textile", "vehicle", "switch"],
    searchTerms: ["monitors", "projectors", "reception apparatus", "display"],
    confidence: 0.95,
  },
  {
    id: "television_equipment",
    label: "Television Equipment",
    aliases: ["television", "tv", "smart tv", "led tv", "lcd tv"],
    test: /\b(smart\s*)?t\.?v\.?s?\b|\btelevisions?\b|\b(led|lcd|oled)\s*tv\b/i,
    productDomain: "display_equipment",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["85"],
    likelyHeadings: ["8528"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "73", "84", "87", "94"],
    excludedHeadings: ["8501"],
    forbiddenDomains: ["motor", "food", "furniture", "textile"],
    searchTerms: ["television receivers", "monitors"],
    confidence: 0.97,
  },
  {
    id: "electrical_switching",
    label: "Electrical Switches",
    aliases: ["wall switch", "light switch", "smart switch", "switch"],
    test: /\b(wall|light|smart)?\s*switches?\b/i,
    productDomain: "electrical_apparatus",
    requiredAttributes: [],
    optionalAttributes: ["voltage", "smart or mechanical"],
    questionPriority: [],
    likelyChapters: ["85"],
    likelyHeadings: ["8536"],
    excludedChapters: [...FOOD_CHAPTERS, "63", "73", "84", "87", "94"],
    excludedHeadings: ["8501", "8528"],
    forbiddenDomains: ["motor", "food", "display", "textile"],
    searchTerms: ["switches", "apparatus for switching"],
    confidence: 0.9,
  },
  {
    id: "automotive_tyres",
    label: "Passenger Vehicle Tyres",
    aliases: ["tyre", "tire", "pneumatic tyre", "passenger tyre"],
    test: /\b(tyres?|tires?)\b|\b\d{3}\/\d{2}\s*r\s*\d{2}\b/i,
    productDomain: "automotive_tyres",
    requiredAttributes: [],
    optionalAttributes: ["new or used", "vehicle type", "tyre dimensions"],
    questionPriority: [],
    likelyChapters: ["40"],
    likelyHeadings: ["4011"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "73", "84", "85", "87", "94"],
    excludedHeadings: ["4016", "8708"],
    forbiddenDomains: ["vehicle_parts", "food", "furniture", "textile", "motor"],
    searchTerms: ["pneumatic tyres", "new", "motor cars"],
    confidence: 0.97,
  },
  {
    id: "automotive_wheels",
    label: "Vehicle Wheels",
    aliases: ["wheel", "rim", "alloy wheel", "road wheel"],
    test: /\b(alloy\s*)?(wheels?|rims?)\b|\broad\s*wheels?\b/i,
    productDomain: "vehicle_parts",
    requiredAttributes: [],
    optionalAttributes: ["material", "size"],
    questionPriority: [],
    likelyChapters: ["87"],
    likelyHeadings: ["8708"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "40", "63", "84", "85"],
    excludedHeadings: ["4011"],
    forbiddenDomains: ["tyre", "food", "textile", "motor"],
    searchTerms: ["road wheels", "parts and accessories"],
    confidence: 0.92,
  },
  {
    id: "packaging_plastic",
    label: "Plastic Packaging",
    aliases: ["plastic bottle", "plastic jar", "plastic container"],
    test: /\bplastic\s*(bottles?|jars?|containers?)\b/i,
    productDomain: "packaging",
    requiredAttributes: ["empty or filled"],
    optionalAttributes: ["capacity"],
    questionPriority: [
      {
        id: "empty_or_filled",
        prompt: "Is the container imported empty or filled?",
        options: ["Empty", "Filled", "Unknown"],
        attributeKey: "empty or filled",
      },
    ],
    likelyChapters: ["39"],
    likelyHeadings: ["3923"],
    excludedChapters: [...FOOD_CHAPTERS, "63", "70", "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["food", "furniture", "textile"],
    searchTerms: ["articles for the conveyance or packing of goods of plastics", "bottles"],
    confidence: 0.93,
  },
  {
    id: "packaging_glass",
    label: "Glass Packaging",
    aliases: ["glass bottle", "flint bottle", "woozy bottle", "carboy", "glass jar"],
    test: /\b(glass|flint|woozy)\b.*\b(bottles?|jars?|carboys?)\b|\b(bottles?|jars?)\b.*\b(glass|flint|woozy)\b|\bwoozy\b/i,
    productDomain: "packaging",
    requiredAttributes: ["empty or filled"],
    optionalAttributes: ["capacity", "container type"],
    questionPriority: [
      {
        id: "empty_or_filled",
        prompt: "Is the bottle imported empty or filled?",
        options: ["Empty", "Filled", "Unknown"],
        attributeKey: "empty or filled",
      },
    ],
    likelyChapters: ["70"],
    likelyHeadings: ["7010"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["food", "furniture", "textile", "vehicle", "motor"],
    searchTerms: ["carboys", "bottles", "flasks", "containers of glass"],
    confidence: 0.94,
  },
  {
    id: "household_textiles",
    label: "Household Textiles",
    aliases: ["bath towel", "towel", "towels", "b towels", "terry towel"],
    test: /\b(?!paper\b)(?:bath\s*)?towels?\b|\bb[\s.\-]*towels?\b|\bterry\b/i,
    productDomain: "textiles",
    requiredAttributes: ["material"],
    optionalAttributes: ["knitted or woven"],
    questionPriority: [
      {
        id: "material",
        prompt: "What material is the towel made from?",
        options: ["Cotton", "Synthetic textile", "Microfibre", "Paper", "Unknown"],
        attributeKey: "material",
      },
    ],
    likelyChapters: ["63"],
    likelyHeadings: ["6302"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["machinery", "food", "vehicle", "motor", "chemical"],
    searchTerms: ["toilet linen", "kitchen linen", "terry", "towels"],
    confidence: 0.94,
  },
  {
    id: "headgear",
    label: "Headgear",
    aliases: ["shower cap", "shower caps", "hair net", "cap"],
    test: /\bshower\s*caps?\b|\bhair[\s-]?nets?\b/i,
    productDomain: "headgear",
    requiredAttributes: ["material"],
    optionalAttributes: [],
    questionPriority: [
      {
        id: "material",
        prompt: "What is the primary material?",
        options: ["Plastic film", "Rubber", "Nonwoven textile", "Other", "Unknown"],
        attributeKey: "material",
      },
    ],
    likelyChapters: ["39", "65", "63"],
    likelyHeadings: ["3926", "6505", "6307"],
    excludedChapters: [...FOOD_CHAPTERS, "84", "85", "87"],
    excludedHeadings: [],
    forbiddenDomains: ["machinery", "food", "vehicle", "chemical"],
    searchTerms: ["headgear", "hair-nets", "bathing caps", "plastics"],
    confidence: 0.9,
  },
  {
    id: "cleaning_polishing",
    label: "Cleaning / Polishing Preparations",
    aliases: ["metal polish", "polish", "restorer", "metal restorer", "cleaner", "detergent"],
    test: /\b(metal\s*)?(polish|restorer)\b|\b(detergent|cleaner|scouring)\b/i,
    productDomain: "chemical_preparations",
    requiredAttributes: [],
    optionalAttributes: ["composition", "retail or industrial"],
    questionPriority: [],
    likelyChapters: ["34"],
    likelyHeadings: ["3405", "3402"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["food", "textile", "furniture", "vehicle", "machinery"],
    searchTerms: ["polishes", "creams", "scouring", "metal"],
    confidence: 0.94,
  },
  {
    id: "chemical_preparations",
    label: "Chemical Preparations",
    aliases: ["activator", "solvent", "adhesive", "chemical preparation"],
    test: /\b(activat|solvent|adhesive|primer|bonding)\b/i,
    productDomain: "chemical_preparations",
    requiredAttributes: ["primary function"],
    optionalAttributes: ["composition", "concentration"],
    questionPriority: [
      {
        id: "primary_function",
        prompt: "What is its principal function?",
        options: [
          "Adhesive or bonding accelerator",
          "Surface primer",
          "Solvent or cleaner",
          "Chemical reaction accelerator",
          "Unknown",
        ],
        attributeKey: "primary function",
      },
    ],
    likelyChapters: ["38", "35", "34", "32"],
    likelyHeadings: ["3815", "3506", "3402", "3208"],
    excludedChapters: ["39", "63", "64", "84", "85", "87", "94", ...FOOD_CHAPTERS.filter((c) => c !== "15")],
    excludedHeadings: [],
    forbiddenDomains: ["food", "textile", "furniture", "vehicle", "machinery"],
    searchTerms: ["prepared", "chemical", "products", "adhesives"],
    confidence: 0.88,
  },
  {
    id: "footwear",
    label: "Footwear",
    aliases: ["sandal", "shoe", "boot", "footwear", "sneakers"],
    test: /\b(sandals?|shoes?|boots?|sneakers?|footwear)\b/i,
    productDomain: "footwear",
    requiredAttributes: [],
    optionalAttributes: ["material", "upper material"],
    questionPriority: [],
    likelyChapters: ["64"],
    likelyHeadings: ["6402", "6403", "6404"],
    excludedChapters: [...FOOD_CHAPTERS, "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["machinery", "food", "vehicle", "chemical"],
    searchTerms: ["footwear"],
    confidence: 0.93,
  },
  {
    id: "food_preparations",
    label: "Food Preparations",
    aliases: ["diced tomatoes", "tomato", "tomatoes", "food preparation", "prepared vegetables"],
    test: /\b(diced\s*tomatoes?|tomatoes?\b|edible|food\s*preparation|prepared\s*vegetables?)\b/i,
    productDomain: "food",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["20", "07", "21"],
    likelyHeadings: ["2002", "0702"],
    excludedChapters: ["39", "63", "70", "84", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["packaging", "machinery", "chemical", "textile"],
    searchTerms: ["tomatoes", "prepared", "vegetables"],
    confidence: 0.9,
  },
  {
    id: "furniture",
    label: "Furniture",
    aliases: ["camping cot", "folding cot", "chair", "sofa", "desk", "cabinet"],
    test: /\b(camping\s*cots?|folding\s*cots?|chairs?|sofas?|desks?|cabinets?)\b/i,
    productDomain: "furniture",
    requiredAttributes: [],
    optionalAttributes: ["material"],
    questionPriority: [],
    likelyChapters: ["94"],
    likelyHeadings: ["9401", "9403"],
    excludedChapters: [...FOOD_CHAPTERS, "84", "85", "87"],
    excludedHeadings: [],
    forbiddenDomains: ["machinery", "food", "vehicle", "chemical"],
    searchTerms: ["seats", "furniture"],
    confidence: 0.9,
  },
  {
    id: "electrothermic_small",
    label: "Electro-thermic Appliances",
    aliases: ["kettle", "water heater", "blender"],
    test: /\b(kettles?|water\s*heaters?|blenders?)\b/i,
    productDomain: "electrothermic",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["85"],
    likelyHeadings: ["8516", "8509"],
    excludedChapters: [...NON_APPLIANCE, "73"],
    excludedHeadings: ["8501"],
    forbiddenDomains: ["food", "motor", "furniture", "textile"],
    searchTerms: ["electro-thermic", "electro-mechanical domestic"],
    confidence: 0.92,
  },
  {
    id: "ventilating_fans",
    label: "Ventilating Fans",
    aliases: ["fan", "ceiling fan", "pedestal fan"],
    test: /\b(ceiling|standing|pedestal|table|exhaust)?\s*fans?\b/i,
    productDomain: "machinery_appliances",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["84"],
    likelyHeadings: ["8414"],
    excludedChapters: [...NON_APPLIANCE, "73"],
    excludedHeadings: ["8501"],
    forbiddenDomains: ["food", "textile", "furniture"],
    searchTerms: ["fans", "ventilating"],
    confidence: 0.9,
  },
  {
    id: "electrical_control",
    label: "Electrical Protection / Control",
    aliases: ["led driver", "voltage protector", "surge protector", "driver"],
    test: /\b(led\s*drivers?|voltage\s*protectors?|surge\s*protectors?)\b/i,
    productDomain: "electrical_apparatus",
    requiredAttributes: [],
    optionalAttributes: [],
    questionPriority: [],
    likelyChapters: ["85"],
    likelyHeadings: ["8504", "8536"],
    excludedChapters: [...FOOD_CHAPTERS, "63", "73", "87", "94"],
    excludedHeadings: ["8501", "8528"],
    forbiddenDomains: ["food", "textile", "motor", "display"],
    searchTerms: ["static converters", "electrical apparatus"],
    confidence: 0.9,
  },
  {
    id: "metal_articles",
    label: "Metal Articles / Tubes / Tanks",
    aliases: ["copper tube", "stainless tank", "stainless steel tank"],
    test: /\b(copper\s*tubes?|stainless\s*(steel\s*)?tanks?)\b/i,
    productDomain: "metal_articles",
    requiredAttributes: [],
    optionalAttributes: ["material"],
    questionPriority: [],
    likelyChapters: ["74", "73"],
    likelyHeadings: ["7411", "7309"],
    excludedChapters: [...FOOD_CHAPTERS, "39", "63", "85", "87", "94"],
    excludedHeadings: [],
    forbiddenDomains: ["food", "textile", "chemical"],
    searchTerms: ["tubes", "pipes", "tanks", "reservoirs"],
    confidence: 0.9,
  },
];

export function findProductFamily(
  text: string,
  hints?: { productFamily?: string; productNoun?: string; canonicalProduct?: string },
): ProductFamilyDefinition | null {
  const blob = [
    hints?.canonicalProduct,
    hints?.productNoun,
    hints?.productFamily,
    text,
  ]
    .filter(Boolean)
    .join(" ");
  if (!blob.trim()) return null;

  // Prefer explicit family label match
  if (hints?.productFamily) {
    const fam = hints.productFamily.toLowerCase();
    const byLabel = PRODUCT_FAMILY_REGISTRY.find(
      (f) => f.label.toLowerCase() === fam || f.id === fam.replace(/\s+/g, "_"),
    );
    if (byLabel) return byLabel;
    const byAlias = PRODUCT_FAMILY_REGISTRY.find((f) =>
      f.aliases.some((a) => fam.includes(a) || a.includes(fam)),
    );
    if (byAlias) return byAlias;
  }

  for (const family of PRODUCT_FAMILY_REGISTRY) {
    // Paper towels are chapter 48 — not household textiles
    if (family.id === "household_textiles" && /\bpaper\s*towels?\b/i.test(blob)) continue;
    if (family.id === "packaging_glass" && /\bplastic\b/i.test(blob)) continue;
    if (family.test?.test(blob)) return family;
    for (const alias of family.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(blob)) return family;
    }
  }
  return null;
}

export function getFamilyById(id: string): ProductFamilyDefinition | null {
  return PRODUCT_FAMILY_REGISTRY.find((f) => f.id === id) || null;
}
