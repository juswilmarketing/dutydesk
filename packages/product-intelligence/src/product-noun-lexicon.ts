/**
 * Data-driven product-noun → chapter lexicon.
 * Used when no high-confidence family plugin matches.
 * Prefer adding nouns here over one-off plugins for common merchandise.
 */

export type NounLexiconEntry = {
  /** Match against invoice description / expanded text */
  test: RegExp;
  canonical: string;
  noun: string;
  family: string;
  industry: string;
  primaryFunction: string;
  likelyChapters: string[];
  preferredHeadings?: string[];
  searchTerms: string[];
  confidence: number;
};

/**
 * Ordered longest/most-specific first.
 * Chapters are retrieval seeds only — final codes always come from the tariff DB.
 */
export const PRODUCT_NOUN_LEXICON: NounLexiconEntry[] = [
  // Medical / optical instruments
  {
    test: /\b(vision\s*screener|ophthalmoscope|slit\s*lamp|autorefractor|tonometer|fundus\s*camera|phoropter)\b/i,
    canonical: "ophthalmic instrument",
    noun: "ophthalmic instrument",
    family: "medical instruments",
    industry: "medical",
    primaryFunction: "ophthalmic examination",
    likelyChapters: ["90"],
    preferredHeadings: ["9018"],
    searchTerms: ["ophthalmic instruments", "appliances"],
    confidence: 0.86,
  },
  {
    test: /\b(ultrasound|ultrasonic\s*scan|mri|ecg|electrocardiograph|x[\s-]?ray\s*apparatus|patient\s*monitor)\b/i,
    canonical: "medical diagnostic apparatus",
    noun: "medical apparatus",
    family: "medical instruments",
    industry: "medical",
    primaryFunction: "medical diagnosis",
    likelyChapters: ["90"],
    preferredHeadings: ["9018"],
    searchTerms: ["instruments", "appliances", "electro-diagnostic"],
    confidence: 0.82,
  },
  // Office / IT
  {
    test: /\bprinters?\b/i,
    canonical: "printer",
    noun: "printer",
    family: "printing machinery",
    industry: "office machinery",
    primaryFunction: "printing",
    likelyChapters: ["84"],
    preferredHeadings: ["8443"],
    searchTerms: ["printers", "printing machinery"],
    confidence: 0.85,
  },
  {
    test: /\b(laptop|notebook\s*computer|desktop\s*computer|tablet\s*computer|pc\b)\b/i,
    canonical: "automatic data processing machine",
    noun: "computer",
    family: "computers",
    industry: "electronics",
    primaryFunction: "data processing",
    likelyChapters: ["84"],
    preferredHeadings: ["8471"],
    searchTerms: ["automatic data processing machines"],
    confidence: 0.84,
  },
  {
    test: /\b(monitor|display)\b.*\b(lcd|led|screen)\b|\bcomputer\s*monitor\b/i,
    canonical: "monitor",
    noun: "monitor",
    family: "displays",
    industry: "electronics",
    primaryFunction: "display",
    likelyChapters: ["85"],
    preferredHeadings: ["8528"],
    searchTerms: ["monitors", "projectors"],
    confidence: 0.8,
  },
  // Packaging / containers
  {
    test: /\b(bottle|bottles|jar|jars|carboy)\b/i,
    canonical: "bottle / jar",
    noun: "bottle",
    family: "containers",
    industry: "packaging",
    primaryFunction: "contain goods",
    likelyChapters: ["70", "39"],
    preferredHeadings: ["7010", "3923"],
    searchTerms: ["bottles", "containers", "carboys"],
    confidence: 0.72,
  },
  {
    test: /\b(carton|cartons|corrugated\s*box|packing\s*box)\b/i,
    canonical: "carton / packing box",
    noun: "carton",
    family: "paper packaging",
    industry: "packaging",
    primaryFunction: "packing",
    likelyChapters: ["48"],
    preferredHeadings: ["4819"],
    searchTerms: ["cartons", "boxes", "packing"],
    confidence: 0.8,
  },
  // Automotive already has plugin — light lexicon backup
  {
    test: /\b(tyre|tire)s?\b/i,
    canonical: "pneumatic tyre",
    noun: "tyre",
    family: "tyres",
    industry: "automotive",
    primaryFunction: "vehicle tyre",
    likelyChapters: ["40"],
    preferredHeadings: ["4011"],
    searchTerms: ["pneumatic tyres", "new"],
    confidence: 0.85,
  },
  {
    test: /\b(wheel|rim)s?\b/i,
    canonical: "road wheel",
    noun: "wheel",
    family: "vehicle parts",
    industry: "automotive",
    primaryFunction: "road wheel",
    likelyChapters: ["87"],
    preferredHeadings: ["8708"],
    searchTerms: ["road wheels", "parts"],
    confidence: 0.78,
  },
  // Machinery / industrial
  {
    test: /\b(pump|pumps)\b/i,
    canonical: "pump",
    noun: "pump",
    family: "machinery",
    industry: "machinery",
    primaryFunction: "pumping liquids/gases",
    likelyChapters: ["84"],
    preferredHeadings: ["8413"],
    searchTerms: ["pumps", "liquid"],
    confidence: 0.8,
  },
  {
    test: /\b(compressor|compressors)\b/i,
    canonical: "compressor",
    noun: "compressor",
    family: "machinery",
    industry: "machinery",
    primaryFunction: "compress air/gas",
    likelyChapters: ["84"],
    preferredHeadings: ["8414"],
    searchTerms: ["air pumps", "compressors"],
    confidence: 0.8,
  },
  {
    test: /\b(valve|valves)\b/i,
    canonical: "valve",
    noun: "valve",
    family: "machinery",
    industry: "machinery",
    primaryFunction: "control fluid flow",
    likelyChapters: ["84"],
    preferredHeadings: ["8481"],
    searchTerms: ["taps", "cocks", "valves"],
    confidence: 0.78,
  },
  {
    test: /\b(bearing|bearings)\b/i,
    canonical: "bearing",
    noun: "bearing",
    family: "machinery parts",
    industry: "machinery",
    primaryFunction: "reduce friction",
    likelyChapters: ["84"],
    preferredHeadings: ["8482"],
    searchTerms: ["ball bearings", "roller bearings"],
    confidence: 0.8,
  },
  // Electrical
  {
    test: /\b(cable|cables|wire|wires)\b/i,
    canonical: "insulated cable / wire",
    noun: "cable",
    family: "electrical conductors",
    industry: "electrical",
    primaryFunction: "conduct electricity",
    likelyChapters: ["85"],
    preferredHeadings: ["8544"],
    searchTerms: ["insulated", "wire", "cable"],
    confidence: 0.75,
  },
  {
    test: /\b(switch|switches)\b/i,
    canonical: "electrical switch",
    noun: "switch",
    family: "electrical apparatus",
    industry: "electrical",
    primaryFunction: "switching circuits",
    likelyChapters: ["85"],
    preferredHeadings: ["8536"],
    searchTerms: ["switches", "apparatus for switching"],
    confidence: 0.75,
  },
  {
    test: /\b(sensor|sensors|transducer)\b/i,
    canonical: "sensor / measuring device",
    noun: "sensor",
    family: "instruments",
    industry: "instruments",
    primaryFunction: "sensing / measuring",
    likelyChapters: ["90", "85"],
    preferredHeadings: ["9031", "8536"],
    searchTerms: ["measuring", "checking", "instruments"],
    confidence: 0.7,
  },
  // Furniture / household
  {
    test: /\b(chair|chairs|sofa|sofas|table|tables|desk|desks|cabinet|cabinets)\b/i,
    canonical: "furniture",
    noun: "furniture",
    family: "furniture",
    industry: "furniture",
    primaryFunction: "furnishing",
    likelyChapters: ["94"],
    preferredHeadings: ["9401", "9403"],
    searchTerms: ["seats", "furniture"],
    confidence: 0.78,
  },
  // Appliances: prefer common-product-dictionary fast path; lexicon is backup only
  {
    test: /\b(refrigerator|fridge|freezer|chest\s*freezer)\b/i,
    canonical: "refrigerator",
    noun: "refrigerator",
    family: "refrigeration equipment",
    industry: "appliances",
    primaryFunction: "refrigeration or freezing",
    likelyChapters: ["84"],
    preferredHeadings: ["8418"],
    searchTerms: ["refrigerators", "freezers"],
    confidence: 0.84,
  },
  {
    test: /\b(air[\s-]?conditioner|a\/?c\s*unit|split\s*a\/?c)\b/i,
    canonical: "air conditioner",
    noun: "air conditioner",
    family: "air conditioning equipment",
    industry: "appliances",
    primaryFunction: "air conditioning",
    likelyChapters: ["84"],
    preferredHeadings: ["8415"],
    searchTerms: ["air conditioning machines", "air conditioners"],
    confidence: 0.84,
  },
  // Apparel / footwear
  {
    test: /\b(shoe|shoes|sandal|sandals|boot|boots|sneaker|sneakers|footwear)\b/i,
    canonical: "footwear",
    noun: "footwear",
    family: "footwear",
    industry: "footwear",
    primaryFunction: "wear on feet",
    likelyChapters: ["64"],
    preferredHeadings: ["6402", "6403", "6404"],
    searchTerms: ["footwear"],
    confidence: 0.82,
  },
  {
    test: /\b(shirt|shirts|trouser|trousers|dress|dresses|jacket|jackets|garment)\b/i,
    canonical: "apparel",
    noun: "garment",
    family: "apparel",
    industry: "apparel",
    primaryFunction: "clothing",
    likelyChapters: ["61", "62"],
    searchTerms: ["garments", "clothing"],
    confidence: 0.75,
  },
  // Tools
  {
    test: /\b(drill|drills|screwdriver|wrench|spanner|pliers|hammer)\b/i,
    canonical: "hand tool / power tool",
    noun: "tool",
    family: "tools",
    industry: "tools",
    primaryFunction: "hand tool work",
    likelyChapters: ["82", "84"],
    preferredHeadings: ["8205", "8467"],
    searchTerms: ["tools", "hand tools", "interchangeable"],
    confidence: 0.72,
  },
  // Chemicals / cleaning
  {
    test: /\b(detergent|soap|cleaner|disinfectant|bleach)\b/i,
    canonical: "cleaning preparation",
    noun: "cleaner",
    family: "cleaning preparations",
    industry: "chemicals",
    primaryFunction: "cleaning",
    likelyChapters: ["34"],
    preferredHeadings: ["3401", "3402"],
    searchTerms: ["soap", "organic surface-active", "washing"],
    confidence: 0.78,
  },
];

export function matchProductNounLexicon(rawDescription: string): NounLexiconEntry | null {
  const raw = String(rawDescription || "").trim();
  if (!raw) return null;
  for (const entry of PRODUCT_NOUN_LEXICON) {
    if (entry.test.test(raw)) return entry;
  }
  return null;
}
