/**
 * Packaging product-family plugin.
 * Distinguishes empty containers from intended contents / customer industry.
 */

import type { PluginMatch, ProductFamilyPlugin } from "./types";

const FOOD = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const NECK_FINISH = /\b(\d{2})\s*[-–]?\s*(\d{3})\s*(?:finish|neck)?\b/i;
const CAPACITY_OZ = /\b(\d+(?:\.\d+)?)\s*(?:oz|fl\.?\s*oz|ounce)s?\b/i;
const CAPACITY_ML = /\b(\d+(?:\.\d+)?)\s*(?:ml|millilit(?:er|re)s?)\b/i;
const WOOZY = /\bwoozy\b/i;
const FLINT = /\bflint\b/i;
const BOTTLE = /\bbottles?\b/i;
const JAR = /\bjars?\b/i;
const CONTAINER = /\b(containers?|vials?|ampoules?|carboys?)\b/i;
const EMPTY = /\b(empty|unfilled|new\s+empty)\b/i;
const FILLED = /\b(filled\s+with|containing|with\s+\d+\s*(?:oz|ml|g)\s+of|net\s+(?:wt|weight|contents?))\b/i;
const PACKAGING_CTX = /\b(packaging|packing\s+materials?|packaging\s+materials?)\b/i;
const CONTENT_WORDS =
  /\b(sauce|ketchup|mustard|pepper\s*sauce|beverage|beer|wine|spirit|juice|oil|syrup|cocoa|chocolate|milk|soda)\b/i;

export function isPackagingContainerDescription(raw: string): boolean {
  const text = String(raw || "");
  if (!BOTTLE.test(text) && !JAR.test(text) && !CONTAINER.test(text)) return false;
  // Neck finish / flint / woozy / empty are strong empty-container signals
  if (NECK_FINISH.test(text) || FLINT.test(text) || WOOZY.test(text) || EMPTY.test(text)) return true;
  if (PACKAGING_CTX.test(text)) return true;
  // "X oz … bottle" without fill/ingredient language → packaging
  if ((CAPACITY_OZ.test(text) || CAPACITY_ML.test(text)) && (BOTTLE.test(text) || JAR.test(text)) && !FILLED.test(text)) {
    return true;
  }
  return false;
}

function detectContainerState(raw: string): "empty" | "filled" | "unknown" {
  if (FILLED.test(raw)) return "filled";
  if (EMPTY.test(raw) || NECK_FINISH.test(raw) || FLINT.test(raw) || WOOZY.test(raw) || PACKAGING_CTX.test(raw)) {
    return "empty";
  }
  if ((BOTTLE.test(raw) || JAR.test(raw)) && (CAPACITY_OZ.test(raw) || CAPACITY_ML.test(raw)) && !CONTENT_WORDS.test(raw)) {
    return "empty";
  }
  if ((BOTTLE.test(raw) || JAR.test(raw)) && CONTENT_WORDS.test(raw) && !FILLED.test(raw) && NECK_FINISH.test(raw)) {
    return "empty";
  }
  if ((BOTTLE.test(raw) || JAR.test(raw)) && CONTENT_WORDS.test(raw) && !FILLED.test(raw)) {
    // Ambiguous: "sauce bottle" often means empty packaging on packaging invoices
    return "empty";
  }
  return "unknown";
}

function matchGlassBottle(raw: string): PluginMatch | null {
  if (!BOTTLE.test(raw) && !JAR.test(raw)) return null;
  const state = detectContainerState(raw);
  if (state === "filled") return null;
  if (!isPackagingContainerDescription(raw) && state !== "empty") return null;

  const plastic = /\bplastic|pet|hdpe|ldpe|pp\b/i.test(raw);
  if (plastic) return null;

  const neck = raw.match(NECK_FINISH);
  const oz = raw.match(CAPACITY_OZ);
  const ml = raw.match(CAPACITY_ML);
  const content = raw.match(CONTENT_WORDS)?.[1] || "";
  const style = WOOZY.test(raw) ? "woozy" : "";
  const flint = FLINT.test(raw);

  return {
    pluginId: "packaging",
    confidence: 0.92,
    canonicalProduct: "empty glass bottle",
    productNoun: BOTTLE.test(raw) ? "bottle" : "jar",
    productFamily: "glass packaging container",
    industry: "packaging",
    material: flint ? "flint glass" : "glass",
    primaryFunction: "contain and protect goods as packaging",
    intendedUse: "packaging",
    physicalForm: "bottle",
    finishedState: "finished article",
    partOrCompleteArticle: "complete article",
    brand: "",
    model: style,
    skuHints: [],
    dimensions: {
      capacity: oz ? `${oz[1]} oz` : ml ? `${ml[1]} ml` : null,
      neckFinish: neck ? `${neck[1]}-${neck[2]}` : null,
      bottleStyle: style || null,
      colour: flint ? "clear/colorless" : null,
    },
    technicalSpecifications: {
      bottleStyle: style || null,
      colour: flint ? "clear/colorless" : null,
      capacity: oz ? `${oz[1]} oz` : ml ? `${ml[1]} ml` : null,
      neckFinish: neck ? `${neck[1]}-${neck[2]}` : null,
      intendedContents: content || null,
      suppliedEmpty: true,
      containerState: state === "unknown" ? "empty" : state,
      classificationObject: "container",
    },
    likelyChapters: ["70"],
    excludedChapters: [...FOOD, "18", "20", "21", "22"],
    preferredHeadings: ["7010"],
    prohibitedHeadings: ["1806", "2009", "2103", "2202"],
    missingCriticalAttributes: [],
    searchTerms: [
      "glass bottles",
      "carboys bottles",
      "containers of glass",
      "flint",
      style,
      "packaging",
    ].filter(Boolean),
    administrativeCodes: [],
    notes: [
      "Product noun is the bottle/container — intended contents (e.g. sauce) are not the merchandise.",
      "Empty packaging must not classify under food chapters.",
    ],
  };
}

function matchPlasticBottle(raw: string): PluginMatch | null {
  if (!BOTTLE.test(raw) && !JAR.test(raw)) return null;
  if (!/\bplastic|pet|hdpe|ldpe|pp\b/i.test(raw)) return null;
  const state = detectContainerState(raw);
  if (state === "filled") return null;
  if (!isPackagingContainerDescription(raw) && state !== "empty") return null;

  const content = raw.match(CONTENT_WORDS)?.[1] || "";
  const oz = raw.match(CAPACITY_OZ);

  return {
    pluginId: "packaging",
    confidence: 0.9,
    canonicalProduct: "empty plastic bottle",
    productNoun: "bottle",
    productFamily: "plastic packaging container",
    industry: "packaging",
    material: "plastics",
    primaryFunction: "contain and protect goods as packaging",
    intendedUse: "packaging",
    physicalForm: "bottle",
    finishedState: "finished article",
    partOrCompleteArticle: "complete article",
    brand: "",
    model: "",
    skuHints: [],
    dimensions: {
      capacity: oz ? `${oz[1]} oz` : null,
    },
    technicalSpecifications: {
      intendedContents: content || null,
      suppliedEmpty: true,
      containerState: "empty",
      classificationObject: "container",
    },
    likelyChapters: ["39"],
    excludedChapters: [...FOOD, "18", "20", "21", "22"],
    preferredHeadings: ["3923"],
    prohibitedHeadings: ["1806", "2103", "2009"],
    missingCriticalAttributes: [],
    searchTerms: ["plastic bottles", "articles for the conveyance", "packaging"],
    administrativeCodes: [],
    notes: ["Empty plastic packaging container — not the intended food contents."],
  };
}

export const packagingPlugin: ProductFamilyPlugin = {
  id: "packaging",
  label: "Packaging",
  match(rawDescription) {
    const raw = String(rawDescription || "").trim();
    if (!raw) return null;
    return matchGlassBottle(raw) || matchPlasticBottle(raw);
  },
  scoreCandidate(match, candidate) {
    const supporting: string[] = [];
    const conflicts: string[] = [];
    let delta = 0;
    const heading = candidate.heading.replace(/\D/g, "");
    const ch = candidate.chapter.padStart(2, "0");
    const desc = candidate.description.toLowerCase();
    const codeDigits = candidate.code.replace(/\D/g, "");

    if (FOOD.includes(ch)) {
      delta -= 100;
      conflicts.push("Empty packaging container must not classify under food chapters");
    }
    if (match.preferredHeadings.some((h) => heading.startsWith(h.replace(/\D/g, "").slice(0, 4)))) {
      delta += 40;
      supporting.push(`Preferred packaging heading ${match.preferredHeadings.join("/")}`);
    }
    if (/glass/i.test(match.material) && ch === "70") {
      delta += 20;
      supporting.push("Glass material aligns with Chapter 70");
    }
    if (/plastic/i.test(match.material) && ch === "39") {
      delta += 20;
      supporting.push("Plastic packaging aligns with Chapter 39");
    }
    if (/bottle|carboy|container|ampoule|closure/i.test(desc)) {
      delta += 15;
      supporting.push("Tariff description matches packaging container");
    }
    if (/sauce|food|cocoa|chocolate|beverage|soft drink preparation/i.test(desc) && !/bottle/i.test(desc)) {
      delta -= 80;
      conflicts.push("Food/sauce preparation line conflicts with empty packaging bottle");
    }
    // Prefer general "Other" glass bottles over soft-drink-specific when style is packaging/sauce bottle
    if (codeDigits.startsWith("70109090")) delta += 8;
    if (codeDigits.startsWith("70109010") && /sauce|woozy|flint|packaging/i.test(match.canonicalProduct + JSON.stringify(match.technicalSpecifications))) {
      delta -= 5;
    }
    return { delta, supporting, conflicts };
  },
};
