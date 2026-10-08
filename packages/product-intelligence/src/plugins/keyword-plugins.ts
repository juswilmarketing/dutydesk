/**
 * Lightweight keyword plugins for remaining families.
 * They narrow chapters only — final codes always come from the tariff DB.
 */

import type { ProductFamilyPlugin } from "./types";
import { isPackagingContainerDescription } from "./packaging";

const FOOD_CHS = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

function keywordPlugin(
  id: string,
  label: string,
  test: RegExp,
  fields: {
    canonical: string;
    noun: string;
    family: string;
    industry: string;
    material?: string;
    primaryFunction: string;
    intendedUse: string;
    likelyChapters: string[];
    excludedChapters?: string[];
    preferredHeadings?: string[];
    missing?: string[];
    confidence?: number;
  },
): ProductFamilyPlugin {
  return {
    id,
    label,
    match(raw) {
      if (!test.test(raw)) return null;
      // Empty packaging containers that mention "sauce"/"beverage" are not food merchandise
      if (id === "food" && isPackagingContainerDescription(raw)) return null;
      return {
        pluginId: id,
        confidence: fields.confidence ?? 0.75,
        canonicalProduct: fields.canonical,
        productNoun: fields.noun,
        productFamily: fields.family,
        industry: fields.industry,
        material: fields.material || "",
        primaryFunction: fields.primaryFunction,
        intendedUse: fields.intendedUse,
        physicalForm: "",
        finishedState: "finished article",
        partOrCompleteArticle: "complete article",
        brand: "",
        model: "",
        skuHints: [],
        dimensions: {},
        technicalSpecifications: {},
        likelyChapters: fields.likelyChapters,
        excludedChapters: fields.excludedChapters || (fields.industry === "food" ? [] : [...FOOD_CHS]),
        preferredHeadings: fields.preferredHeadings || [],
        prohibitedHeadings: [],
        missingCriticalAttributes: fields.missing || [],
        searchTerms: [fields.canonical, fields.noun],
        administrativeCodes: [],
        notes: [],
      };
    },
  };
}

export const machineryPlugin = keywordPlugin(
  "machinery",
  "Machinery",
  /\b(machine|pump|compressor|motor|generator|engine\s+part|gearbox)\b/i,
  {
    canonical: "machinery or mechanical appliance",
    noun: "machine",
    family: "machinery",
    industry: "machinery",
    primaryFunction: "mechanical work",
    intendedUse: "industrial / mechanical",
    likelyChapters: ["84"],
    preferredHeadings: ["84"],
    missing: ["complete machine or part", "principal function"],
    confidence: 0.55,
  },
);

export const chemicalsPlugin = keywordPlugin(
  "chemicals",
  "Chemicals",
  /\b(activator|adhesive|solvent|polish|restorer|cleaner|chemical|primer|accelerator)\b/i,
  {
    canonical: "chemical preparation",
    noun: "preparation",
    family: "chemical preparation",
    industry: "chemicals",
    primaryFunction: "chemical preparation",
    intendedUse: "industrial / household chemical use",
    likelyChapters: ["28", "29", "32", "34", "35", "38"],
    missing: ["chemical composition", "primary function"],
    confidence: 0.55,
  },
);

export const textilesPlugin = keywordPlugin(
  "textiles",
  "Textiles",
  /\b(towel|linen|fabric|garment|apparel|shirt|trouser|curtain|bedding)\b/i,
  {
    canonical: "textile article",
    noun: "textile",
    family: "textiles",
    industry: "textiles",
    material: "",
    primaryFunction: "textile use",
    intendedUse: "textile / apparel",
    likelyChapters: ["50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63"],
    missing: ["material"],
    confidence: 0.55,
  },
);

export const foodPlugin = keywordPlugin(
  "food",
  "Food",
  /\b(tomato|food|edible|beverage|sauce|juice|rice|sugar|milk|cheese|meat)\b/i,
  {
    canonical: "food product",
    noun: "food",
    family: "food",
    industry: "food",
    primaryFunction: "human consumption",
    intendedUse: "food",
    likelyChapters: ["01", "02", "03", "04", "07", "08", "09", "10", "11", "15", "16", "17", "18", "19", "20", "21", "22"],
    excludedChapters: ["34", "38", "63", "84", "85"],
    missing: ["preparation method"],
    confidence: 0.6,
  },
);

export const plasticsPlugin = keywordPlugin(
  "plastics",
  "Plastics",
  /\b(plastic|polyethylene|polypropylene|pvc|polymer)\b/i,
  {
    canonical: "plastic article",
    noun: "plastic article",
    family: "plastics",
    industry: "plastics",
    material: "plastics",
    primaryFunction: "plastic article",
    intendedUse: "general",
    likelyChapters: ["39"],
    confidence: 0.5,
  },
);

export const metalArticlesPlugin = keywordPlugin(
  "metal_articles",
  "Metal articles",
  /\b(stainless\s+steel|copper\s+tube|steel\s+tank|aluminium|aluminum|iron\s+or\s+steel)\b/i,
  {
    canonical: "metal article",
    noun: "metal article",
    family: "metal articles",
    industry: "metals",
    material: "metal",
    primaryFunction: "metal article",
    intendedUse: "industrial / household",
    likelyChapters: ["72", "73", "74", "76"],
    confidence: 0.6,
  },
);

export const furniturePlugin = keywordPlugin(
  "furniture",
  "Furniture",
  /\b(furniture|sofa|chair|table|cot|mattress|cabinet)\b/i,
  {
    canonical: "furniture",
    noun: "furniture",
    family: "furniture",
    industry: "furniture",
    primaryFunction: "furnishing",
    intendedUse: "household / outdoor",
    likelyChapters: ["94"],
    confidence: 0.6,
  },
);

export const footwearPlugin = keywordPlugin(
  "footwear",
  "Footwear",
  /\b(shoe|sandal|boot|sneaker|footwear)\b/i,
  {
    canonical: "footwear",
    noun: "footwear",
    family: "footwear",
    industry: "footwear",
    primaryFunction: "footwear",
    intendedUse: "apparel / footwear",
    likelyChapters: ["64"],
    missing: ["material"],
    confidence: 0.7,
  },
);

export const cosmeticsPlugin = keywordPlugin(
  "cosmetics",
  "Cosmetics",
  /\b(cosmetic|shampoo|lotion|cream|perfume|makeup|make-up|skincare)\b/i,
  {
    canonical: "cosmetic preparation",
    noun: "cosmetic",
    family: "cosmetics",
    industry: "cosmetics",
    primaryFunction: "personal care",
    intendedUse: "cosmetic / toilet",
    likelyChapters: ["33"],
    confidence: 0.6,
  },
);

export const medicalPlugin = keywordPlugin(
  "medical",
  "Medical",
  /\b(medical|surgical|syringe|bandage|diagnostic|pharmaceutical)\b/i,
  {
    canonical: "medical article",
    noun: "medical article",
    family: "medical",
    industry: "medical",
    primaryFunction: "medical use",
    intendedUse: "medical",
    likelyChapters: ["30", "90"],
    confidence: 0.55,
  },
);
