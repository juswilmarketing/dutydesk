/**
 * Candidate Compatibility Engine — profile vs tariff line before AI ranking.
 * Incompatible candidates must never be rendered.
 */

import type { ProductClassificationProfile } from "./classification-profile";
import { findProductFamily, type ProductFamilyDefinition } from "./product-families";

export type CompatibilityResult = {
  compatible: boolean;
  productScore: number;
  functionScore: number;
  materialScore: number;
  domainScore: number;
  familyScore: number;
  headingScore: number;
  contradictions: string[];
  finalScore: number;
};

const FOOD_CHAPTERS = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
]);

const MOTOR_HEADING = /^8501/;
const VEHICLE_PART_HEADING = /^8708/;
const TYRE_HEADING = /^4011/;

function chapterOf(codeOrChapter: string): string {
  return codeOrChapter.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
}

function headingOf(codeOrHeading: string): string {
  return codeOrHeading.replace(/\D/g, "").slice(0, 4);
}

function inferCandidateDomain(chapter: string, heading: string, desc: string): string {
  const d = desc.toLowerCase();
  const ch = chapterOf(chapter);
  if (FOOD_CHAPTERS.has(ch) || /vegetable|fruit|tomato|food|edible|prepared/.test(d)) return "food";
  if (MOTOR_HEADING.test(heading) || /electric motors?\b|generators?\b/.test(d)) return "motor";
  if (TYRE_HEADING.test(heading) || /pneumatic tyres?\b/.test(d)) return "tyre";
  if (VEHICLE_PART_HEADING.test(heading) || /parts and accessories of.*motor vehicles/.test(d)) return "vehicle_parts";
  if (/^8528/.test(heading) || /monitors?\b|television|projectors?\b/.test(d)) return "display";
  if (/^8536/.test(heading) || /switches?\b|relays?\b/.test(d)) return "switch";
  if (/^63/.test(ch) || /linen|terry|towel|textile/.test(d)) return "textile";
  if (/^94/.test(ch) || /furniture|seats?\b/.test(d)) return "furniture";
  if (/^34/.test(ch) || /polish|scouring|soap|detergent/.test(d)) return "chemical";
  if (/^70/.test(ch) || /glass|carboys|bottles/.test(d)) return "packaging";
  if (/^84/.test(ch)) return "machinery";
  if (/^85/.test(ch)) return "electrical";
  return "other";
}

function resolveFamily(profile: ProductClassificationProfile): ProductFamilyDefinition | null {
  return findProductFamily(profile.rawDescription || profile.cleanDescription || "", {
    productFamily: profile.productFamily,
    productNoun: profile.productNoun,
    canonicalProduct: profile.canonicalProduct,
  });
}

/**
 * Score a retrieved tariff candidate against the product profile.
 * Returns compatible:false when hard contradictions fire (−100 domain/function/family).
 */
export function scoreCandidateCompatibility(
  profile: ProductClassificationProfile,
  candidate: { code: string; description: string; chapter: string; heading: string },
): CompatibilityResult {
  const contradictions: string[] = [];
  let productScore = 0;
  let functionScore = 0;
  let materialScore = 0;
  let domainScore = 0;
  let familyScore = 0;
  let headingScore = 0;

  const ch = chapterOf(candidate.chapter || candidate.code);
  const heading = headingOf(candidate.heading || candidate.code);
  const desc = candidate.description.toLowerCase();
  const family = resolveFamily(profile);
  const candidateDomain = inferCandidateDomain(ch, heading, candidate.description);

  // Excluded chapters from profile
  if (profile.excludedChapters.map((c) => c.padStart(2, "0")).includes(ch)) {
    contradictions.push(`Chapter ${ch} is excluded for this product profile`);
    domainScore = -100;
  }

  // Family excluded chapters / headings
  if (family) {
    if (family.excludedChapters.map((c) => c.padStart(2, "0")).includes(ch)) {
      contradictions.push(`Chapter ${ch} excluded by product family ${family.label}`);
      domainScore = -100;
    }
    if (family.excludedHeadings.some((h) => heading.startsWith(headingOf(h)))) {
      contradictions.push(`Heading ${heading} excluded by product family ${family.label}`);
      domainScore = -100;
    }
    if (family.forbiddenDomains.includes(candidateDomain)) {
      contradictions.push(
        `Candidate domain "${candidateDomain}" contradicts product family ${family.label}`,
      );
      domainScore = -100;
    }
    if (family.likelyChapters.map((c) => c.padStart(2, "0")).includes(ch)) {
      familyScore += 30;
    }
    if (family.likelyHeadings.some((h) => heading.startsWith(headingOf(h)))) {
      headingScore += 25;
    }
  }

  // Universal contradiction rules
  const noun = `${profile.productNoun} ${profile.canonicalProduct}`.toLowerCase();
  const famLabel = (profile.productFamily || "").toLowerCase();

  if ((/display|monitor|television|flat\s*panel/.test(noun + famLabel)) && MOTOR_HEADING.test(heading)) {
    contradictions.push("Display product cannot map to electric motor heading 8501");
    domainScore = -100;
  }
  if ((/bottle|jar|packaging|glass packaging/.test(noun + famLabel)) && FOOD_CHAPTERS.has(ch)) {
    contradictions.push("Empty packaging / container cannot map to food chapters");
    domainScore = -100;
  }
  if ((/polish|restorer|detergent|cleaner/.test(noun + famLabel)) && FOOD_CHAPTERS.has(ch)) {
    contradictions.push("Polishing/cleaning preparation cannot map to food chapters");
    domainScore = -100;
  }
  if ((/tyre|tire|pneumatic/.test(noun + famLabel)) && VEHICLE_PART_HEADING.test(heading) && !TYRE_HEADING.test(heading)) {
    contradictions.push("Passenger tyre should use tyre heading 4011, not generic vehicle parts");
    domainScore = -100;
  }
  if (/refrigerat|freezer|fridge/.test(noun + famLabel) && (/^94/.test(ch) || FOOD_CHAPTERS.has(ch))) {
    contradictions.push("Refrigerator cannot map to furniture or food chapters");
    domainScore = -100;
  }
  if (/stove|cooker|oven|cooktop/.test(noun + famLabel) && FOOD_CHAPTERS.has(ch)) {
    contradictions.push("Cooking appliance cannot map to food chapters");
    domainScore = -100;
  }
  if (/towel/.test(noun + famLabel) && (/^84/.test(ch) || /^85/.test(ch))) {
    contradictions.push("Bath towel cannot map to machinery/electrical chapters");
    domainScore = -100;
  }

  // Soft product noun / function / material affinity
  const productTokens = [profile.productNoun, profile.canonicalProduct]
    .join(" ")
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);
  for (const t of productTokens) {
    if (desc.includes(t)) productScore += 8;
  }
  productScore = Math.min(40, productScore);

  if (profile.primaryFunction) {
    const fn = profile.primaryFunction.toLowerCase();
    if (fn.split(/\W+/).some((t) => t.length > 3 && desc.includes(t))) functionScore += 20;
    if (/refrigerat|freezing/.test(fn) && /refrigerat|freez/.test(desc)) functionScore += 15;
    if (/display|television|monitor/.test(fn) && /monitor|television|display/.test(desc)) functionScore += 15;
    if (/cooking/.test(fn) && /cook|stove|oven/.test(desc)) functionScore += 15;
    if (/polish|clean/.test(fn) && /polish|scour|clean/.test(desc)) functionScore += 15;
  }
  functionScore = Math.min(35, functionScore);

  if (profile.material) {
    const mat = profile.material.toLowerCase();
    if (mat && mat !== "unknown" && desc.includes(mat.split(/\s+/)[0])) materialScore += 20;
    if (/cotton|textile|terry/.test(mat) && /cotton|terry|linen|textile/.test(desc)) materialScore += 15;
    if (/glass|flint/.test(mat) && /glass/.test(desc)) materialScore += 15;
    if (/plastic/.test(mat) && /plastic/.test(desc)) materialScore += 12;
  }
  materialScore = Math.min(30, materialScore);

  if (domainScore > -100) {
    domainScore += family ? 10 : 0;
  }

  const finalScore =
    productScore + functionScore + materialScore + domainScore + familyScore + headingScore;

  // Stricter: any −100 domain kills
  const hardFail = domainScore <= -100;

  return {
    compatible: !hardFail,
    productScore,
    functionScore,
    materialScore,
    domainScore,
    familyScore,
    headingScore,
    contradictions,
    finalScore: hardFail ? Math.min(finalScore, -100) : finalScore,
  };
}

/** Filter and annotate candidates; drop incompatible ones entirely. */
export function filterCompatibleCandidates<T extends {
  code: string;
  description: string;
  chapter: string;
  heading: string;
  finalScore: number;
  conflicts: string[];
  supportingFacts: string[];
}>(profile: ProductClassificationProfile, candidates: T[]): T[] {
  const kept: T[] = [];
  for (const c of candidates) {
    const compat = scoreCandidateCompatibility(profile, c);
    if (!compat.compatible) continue;
    kept.push({
      ...c,
      finalScore: c.finalScore + Math.max(0, compat.finalScore) * 0.15,
      conflicts: [...c.conflicts, ...compat.contradictions.filter((x) => !c.conflicts.includes(x))],
      supportingFacts: [
        ...c.supportingFacts,
        ...(compat.headingScore >= 25 ? ["Heading family matches product family"] : []),
        ...(compat.familyScore >= 30 ? ["Chapter matches product family"] : []),
      ],
    });
  }
  return kept.sort((a, b) => b.finalScore - a.finalScore);
}
