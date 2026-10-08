/**
 * Hierarchical, retrieval-grounded tariff classifier (Phase 1).
 * AI never invents codes — only ranks codes retrieved from the T&T tariff database.
 */

import {
  getChapter,
  scoreChapter,
  searchHeadingsInChapters,
  searchNationalInHeadings,
  getNationalLinesForHeading,
  searchTariff,
  chapterTitle,
  parseTariffCode,
  type TariffRow,
} from "@pas/tariff-data";
import {
  buildProductClassificationProfile,
  profileSearchQuery,
  CUSTOMER_INDUSTRY_WEIGHT_MAX,
  type ProductClassificationProfile,
} from "./classification-profile";
import { getPluginById } from "./plugins";
import { filterCompatibleCandidates } from "./candidate-compatibility";
import { routeProductFamily } from "./product-family-router";
import { findProductFamily } from "./product-families";

export type ScoredChapter = {
  chapter: string;
  chapterTitle: string;
  score: number;
  supportingFacts: string[];
  conflictingFacts: string[];
};

export type ScoredCandidate = {
  code: string;
  description: string;
  chapter: string;
  heading: string;
  duty: string;
  source: string[];
  retrievalScore: number;
  domainScore: number;
  materialScore: number;
  functionScore: number;
  historyScore: number;
  validationScore: number;
  finalScore: number;
  supportingFacts: string[];
  conflicts: string[];
  missingFacts: string[];
};

export type HierarchicalClassificationResult = {
  profile: ProductClassificationProfile;
  chapters: ScoredChapter[];
  candidates: ScoredCandidate[];
  recommendationStatus: "strong" | "likely" | "provisional" | "insufficient";
  criticalQuestion: {
    id: string;
    prompt: string;
    options: string[];
  } | null;
  warnings: string[];
  retrievalTrace: {
    chapterCount: number;
    headingCount: number;
    nationalCount: number;
  };
};

const FOOD = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
]);

function percentDuty(duty: string): number {
  if (!duty || duty === "Free" || duty === "Exempt" || duty === "—") return 0;
  return Number.parseFloat(duty.replace("%", "")) || 0;
}

function buildQuestion(profile: ProductClassificationProfile): HierarchicalClassificationResult["criticalQuestion"] {
  // Family-specific questions first (config-driven)
  const route = routeProductFamily(
    profile.rawDescription || profile.cleanDescription || profile.canonicalProduct,
    profile.knownAttributes?.clarificationId
      ? { id: String(profile.knownAttributes.clarificationId), value: "" }
      : null,
    { profileHints: profile },
  );
  if (route.criticalQuestion && profile.missingCriticalAttributes.length) {
    return {
      id: route.criticalQuestion.id,
      prompt: route.criticalQuestion.prompt,
      options: route.criticalQuestion.options,
    };
  }
  const family = findProductFamily(profile.canonicalProduct, {
    productFamily: profile.productFamily,
    productNoun: profile.productNoun,
    canonicalProduct: profile.canonicalProduct,
  });
  if (family && profile.missingCriticalAttributes.length) {
    const miss = profile.missingCriticalAttributes[0];
    const q = family.questionPriority.find(
      (item) => item.attributeKey === miss || item.id === miss.replace(/\s+/g, "_"),
    );
    if (q) return { id: q.id, prompt: q.prompt, options: q.options };
  }

  const missing = profile.missingCriticalAttributes;
  if (missing.includes("energy source")) {
    return {
      id: "energy_source",
      prompt: "What powers this stove?",
      options: ["Electric", "Gas", "Dual fuel", "Other", "Unknown"],
    };
  }
  if (missing.includes("product type") || (!profile.likelyChapters.length && profile.interpretationConfidence < 0.55)) {
    return {
      id: "product_type",
      prompt: "What is the primary product being imported?",
      options: [
        "Machinery / equipment",
        "Electrical apparatus",
        "Medical / scientific instrument",
        "Plastic / rubber article",
        "Textile / apparel / footwear",
        "Food / beverage",
        "Packaging / container",
        "Other / Unknown",
      ],
    };
  }
  if (missing.includes("material")) {
    if (/towel/i.test(profile.canonicalProduct)) {
      return {
        id: "material",
        prompt: "What is the material?",
        options: ["Cotton", "Synthetic textile", "Microfibre", "Paper", "Unknown"],
      };
    }
    if (/shower\s*cap/i.test(profile.canonicalProduct)) {
      return {
        id: "material",
        prompt: "What is the primary material?",
        options: ["Plastic film", "Rubber", "Nonwoven textile", "Other", "Unknown"],
      };
    }
    if (/hub/i.test(profile.canonicalProduct)) {
      return {
        id: "material",
        prompt: "What is the primary material of the hub ring?",
        options: ["Plastic", "Aluminium", "Steel", "Other", "Unknown"],
      };
    }
    return {
      id: "material",
      prompt: "What is the primary material?",
      options: ["Plastic", "Rubber", "Textile", "Metal", "Paper", "Unknown"],
    };
  }
  if (missing.includes("primary function") || missing.includes("chemical composition")) {
    if (/activat/i.test(profile.canonicalProduct) || /activat/i.test(profile.productNoun)) {
      return {
        id: "primary_function",
        prompt: "What is its principal function?",
        options: [
          "Adhesive or bonding accelerator",
          "Surface primer",
          "Solvent or cleaner",
          "Chemical reaction accelerator",
          "Unknown",
        ],
      };
    }
  }
  return null;
}

function scoreDomain(
  profile: ProductClassificationProfile,
  chapter: string,
): { score: number; conflicts: string[]; supporting: string[] } {
  const ch = chapter.padStart(2, "0");
  const conflicts: string[] = [];
  const supporting: string[] = [];
  let score = 0;

  if (profile.excludedChapters.map((c) => c.padStart(2, "0")).includes(ch)) {
    return { score: -100, conflicts: [`Chapter ${ch} is excluded for this product profile`], supporting };
  }

  if (profile.industry !== "food" && FOOD.has(ch) && profile.interpretationConfidence >= 0.55) {
    return { score: -100, conflicts: [`Food chapter ${ch} incompatible with non-food product`], supporting };
  }

  if (profile.likelyChapters.map((c) => c.padStart(2, "0")).includes(ch)) {
    score += 25;
    supporting.push(`Chapter ${ch} is in the predicted chapter set`);
  }

  // Material affinities
  if (/paper/i.test(profile.material) && ch === "48") {
    score += 20;
    supporting.push("Paper material aligns with Chapter 48");
  }
  if (/cotton|textile|terry|microfibre/i.test(profile.material) && ch === "63") {
    score += 18;
    supporting.push("Textile material aligns with Chapter 63");
  }
  if (/plastic/i.test(profile.material) && ch === "39") {
    score += 18;
    supporting.push("Plastic material aligns with Chapter 39");
  }
  if (/glass|flint/i.test(profile.material) && ch === "70") {
    score += 22;
    supporting.push("Glass material aligns with Chapter 70");
  }
  if (/medical|ophthalmic|diagnostic instrument/i.test(
    `${profile.industry} ${profile.productFamily} ${profile.canonicalProduct}`,
  ) && ch === "90") {
    score += 28;
    supporting.push("Medical/ophthalmic instrument aligns with Chapter 90");
  }
  if (/printing|printer/i.test(`${profile.canonicalProduct} ${profile.productNoun}`) && ch === "84") {
    score += 24;
    supporting.push("Printer aligns with Chapter 84 machinery");
  }
  if (/rubber/i.test(profile.material) && ch === "40") {
    score += 15;
    supporting.push("Rubber material aligns with Chapter 40");
  }

  // Empty packaging → food chapter hard penalty (cannot be cancelled by consignee/intended contents)
  const emptyPackaging =
    profile.industry === "packaging"
    || /empty.*(bottle|jar|container)|glass packaging|plastic packaging/i.test(profile.canonicalProduct)
    || profile.technicalSpecifications?.suppliedEmpty === true
    || profile.technicalSpecifications?.classificationObject === "container";
  if (emptyPackaging && FOOD.has(ch)) {
    return {
      score: -100,
      conflicts: ["Empty packaging container → food chapter penalty (−100)"],
      supporting,
    };
  }

  // Consignee / customer industry is weak only — never overrides product noun
  const customerWeight = Number(profile.knownAttributes?.customerIndustryWeight || 0);
  const customerHint = String(profile.knownAttributes?.customerIndustryHint || "");
  if (customerHint === "food" && FOOD.has(ch) && !emptyPackaging && profile.industry === "food") {
    score += Math.min(CUSTOMER_INDUSTRY_WEIGHT_MAX, customerWeight || CUSTOMER_INDUSTRY_WEIGHT_MAX);
    supporting.push("Weak customer-industry food context (capped)");
  }

  // Function affinities
  if (/polish|restor|scour|clean/i.test(profile.primaryFunction + profile.canonicalProduct) && ch === "34") {
    score += 30;
    supporting.push("Polishing/cleaning function aligns with Chapter 34");
  }
  if (/drying the body|toilet linen|bath towel/i.test(profile.primaryFunction + profile.canonicalProduct) && ch === "63") {
    score += 22;
    supporting.push("Bath/toilet linen function aligns with Chapter 63");
  }

  return { score, conflicts, supporting };
}

function scoreMaterialFunction(profile: ProductClassificationProfile, desc: string): {
  materialScore: number;
  functionScore: number;
  supporting: string[];
  conflicts: string[];
} {
  const d = desc.toLowerCase();
  const supporting: string[] = [];
  const conflicts: string[] = [];
  let materialScore = 0;
  let functionScore = 0;

  const mat = profile.material.toLowerCase();
  if (mat && mat !== "unknown textile material") {
    if (mat.includes("cotton") && /cotton/.test(d)) {
      materialScore += 25;
      supporting.push("Cotton material matches tariff line");
    } else if (mat.includes("paper") && /paper/.test(d)) {
      materialScore += 25;
      supporting.push("Paper material matches tariff line");
    } else if (mat.includes("plastic") && /plastic|of plastics|polymer/.test(d)) {
      materialScore += 22;
      supporting.push("Plastic material matches tariff line");
    } else if (mat.includes("man-made") || mat.includes("synthetic") || mat.includes("microfibre")) {
      if (/man-made|synthetic/.test(d)) {
        materialScore += 20;
        supporting.push("Synthetic textile material matches tariff line");
      }
    } else if (/terry|toilet linen|kitchen linen/.test(d) && /towel|textile|cotton|terry/.test(mat + " " + profile.canonicalProduct)) {
      materialScore += 12;
      supporting.push("Toilet/terry linen description matches textile towel profile");
    }
  }

  if (/towel/i.test(profile.canonicalProduct)) {
    if (/toilet linen|terry|kitchen linen|towel/.test(d)) {
      functionScore += 25;
      supporting.push("Toilet/kitchen linen heading matches towel use");
    }
    if (/bed linen|table linen/.test(d) && !/toilet|terry|kitchen/.test(d)) {
      functionScore -= 8;
    }
  }

  if (/shower\s*cap/i.test(profile.canonicalProduct)) {
    if (/headgear|hair-net|cap|hood/.test(d)) {
      functionScore += 18;
      supporting.push("Headgear/cap description matches shower cap");
    }
    if (/other articles of plastics|plastics/.test(d) && /plastic/i.test(profile.material)) {
      functionScore += 15;
      supporting.push("Plastic articles heading plausible for plastic shower cap");
    }
  }

  if (/polish|restorer/i.test(profile.canonicalProduct)) {
    if (/metal polish/.test(d)) {
      functionScore += 40;
      supporting.push("Metal polish tariff line matches product");
    } else if (/polish|scouring|cream/.test(d) && !/footwear|furniture|coachwork/.test(d)) {
      functionScore += 20;
    } else if (/footwear or furniture|coachwork/.test(d)) {
      functionScore -= 15;
      conflicts.push("Footwear/furniture/coachwork polish is a weaker fit for metal restorer");
    }
    if (/vegetable|fruit|tomato|food|prepared/.test(d)) {
      functionScore -= 60;
      conflicts.push("Food preparation line conflicts with polishing preparation");
    }
  }

  if (/activat/i.test(profile.canonicalProduct)) {
    if (/prepared|chemical|glue|adhesive|enzyme|accelerator/.test(d)) {
      functionScore += 12;
    }
    if (/textile|apparel|footwear|furniture/.test(d)) {
      functionScore -= 40;
      conflicts.push("Textile/apparel line unrelated to industrial activator");
    }
  }

  return { materialScore, functionScore, supporting, conflicts };
}

/**
 * Run hierarchical retrieval and transparent scoring.
 * Does not call AI — returns database candidates only.
 */
export function classifyHierarchically(
  rawDescription: string,
  clarification?: { id: string; value: string } | null,
  context?: {
    supplier?: string | null;
    consignee?: string | null;
    invoiceNotes?: string | null;
    commonProductEntries?: import("./common-product-dictionary").CommonProductEntry[];
    productEvidence?: {
      canonicalProduct?: string;
      material?: string;
      primaryFunction?: string;
      intendedUse?: string;
      emptyOrFilled?: string;
    } | null;
  },
): HierarchicalClassificationResult {
  const profile = buildProductClassificationProfile(rawDescription, clarification, context);
  if (profile.nonMerchandise) {
    return {
      profile,
      chapters: [],
      candidates: [],
      recommendationStatus: "insufficient",
      criticalQuestion: null,
      warnings: ["Non-merchandise invoice line — excluded from tariff classification."],
      retrievalTrace: { chapterCount: 0, headingCount: 0, nationalCount: 0 },
    };
  }

  const plugin = profile.pluginId ? getPluginById(profile.pluginId) : undefined;
  const pluginMatch = plugin?.match(rawDescription, context) || null;
  const query = profileSearchQuery(profile);
  const warnings: string[] = [];
  const preferredHeadings = pluginMatch?.preferredHeadings?.length
    ? pluginMatch.preferredHeadings
    : (profile.preferredHeadings || []);
  const hardHeadingGate = Boolean(profile.knownAttributes?.hardHeadingGate)
    || (
      Boolean(profile.knownAttributes?.commonProductFastPath)
      && preferredHeadings.length > 0
      && profile.interpretationConfidence >= 0.9
      && !profile.missingCriticalAttributes.includes("energy source")
    );
  const identityKnown =
    Boolean(pluginMatch)
    || Boolean(profile.knownAttributes?.commonProductFastPath)
    || profile.interpretationConfidence >= 0.7
    || profile.likelyChapters.length > 0;

  if (profile.knownAttributes?.commonProductFastPath) {
    warnings.push(
      `Common product fast path: ${profile.canonicalProduct} → ${profile.productFamily}`
        + (preferredHeadings[0] ? ` (heading ${preferredHeadings[0]})` : ""),
    );
  }

  // STAGE A — chapters from product family / profile only (two-stage search).
  // Unrestricted global search is NOT the normal first step.
  let chapterSeeds = profile.likelyChapters.length ? [...profile.likelyChapters] : [];
  const familyConfidence = Number(profile.familyConfidence ?? profile.knownAttributes?.productFamilyConfidence ?? 0);
  let widenedSearch = false;

  if (!chapterSeeds.length) {
    return {
      profile,
      chapters: [],
      candidates: [],
      recommendationStatus: "insufficient",
      criticalQuestion: buildQuestion(profile),
      warnings: [
        ...warnings,
        "No product family / chapter gate — ask clerk before tariff retrieval (global search blocked).",
      ],
      retrievalTrace: { chapterCount: 0, headingCount: 0, nationalCount: 0 },
    };
  }

  const chapters: ScoredChapter[] = [];
  for (const ch of chapterSeeds) {
    const lexical = scoreChapter(ch, query, 4);
    const domain = scoreDomain(profile, ch);
    const score = lexical.score + domain.score;
    if (domain.score <= -100) continue;
    chapters.push({
      chapter: ch.padStart(2, "0"),
      chapterTitle: getChapter(ch)?.title || chapterTitle(ch),
      score,
      supportingFacts: domain.supporting,
      conflictingFacts: domain.conflicts,
    });
  }
  chapters.sort((a, b) => b.score - a.score);
  const topChapters = chapters.slice(0, 5);
  if (!topChapters.length) {
    return {
      profile,
      chapters: [],
      candidates: [],
      recommendationStatus: "insufficient",
      criticalQuestion: buildQuestion(profile),
      warnings: ["No compatible chapters found for this product profile."],
      retrievalTrace: { chapterCount: 0, headingCount: 0, nationalCount: 0 },
    };
  }

  // STAGE B — headings within chapters
  const headingHits = searchHeadingsInChapters(
    query,
    topChapters.map((c) => c.chapter),
    10,
  );

  let headings = headingHits;
  if (!headings.length) {
    const fallbackQuery = [
      profile.canonicalProduct,
      profile.productFamily,
      ...(pluginMatch?.searchTerms || []),
      /towel/i.test(profile.canonicalProduct) ? "toilet linen terry kitchen linen cotton" : "",
      /polish|restorer/i.test(profile.canonicalProduct) ? "metal polishes scouring" : "",
      /shower/i.test(profile.canonicalProduct) ? "headgear plastics articles hair-nets" : "",
      /activat/i.test(profile.canonicalProduct) ? "chemical products prepared adhesives" : "",
      /tyre|tire|pneumatic/i.test(profile.canonicalProduct) ? "pneumatic tyres new rubber motor" : "",
      /road wheel|rim/i.test(profile.canonicalProduct) ? "road wheels motor vehicles parts" : "",
      /switch/i.test(profile.canonicalProduct) ? "switches apparatus for switching electrical circuits" : "",
      /lug.?nut/i.test(profile.canonicalProduct) ? "nuts screws bolts threaded articles" : "",
      /glass.*bottle|empty glass|woozy|flint/i.test(profile.canonicalProduct + profile.rawDescription)
        ? "carboys bottles flasks containers of glass"
        : "",
      /plastic.*bottle|empty plastic/i.test(profile.canonicalProduct)
        ? "articles for the conveyance or packing of goods of plastics bottles"
        : "",
      /ophthalmic|vision screener/i.test(profile.canonicalProduct + profile.rawDescription)
        ? "other ophthalmic instruments and appliances"
        : "",
      /^printers?$|\bprinter\b/i.test(profile.canonicalProduct)
        ? "other printers printing machinery automatic data processing"
        : "",
    ].filter(Boolean).join(" ");
    headings = searchHeadingsInChapters(
      fallbackQuery,
      topChapters.map((c) => c.chapter),
      10,
    );
    if (headings.length) {
      warnings.push("Used profile-expanded heading retrieval because literal invoice terms did not match tariff wording.");
    }
  }

  // Bias toward preferred headings when plugin/lexicon provides them
  if (preferredHeadings.length) {
    headings = [...headings].sort((a, b) => {
      const aHit = preferredHeadings.some((h) =>
        a.heading.replace(/\D/g, "").startsWith(h.replace(/\D/g, "").slice(0, 4)));
      const bHit = preferredHeadings.some((h) =>
        b.heading.replace(/\D/g, "").startsWith(h.replace(/\D/g, "").slice(0, 4)));
      if (aHit === bHit) return b.score - a.score;
      return aHit ? -1 : 1;
    });
  }

  const topHeadings = headings.slice(0, 6);
  if (!topHeadings.length) {
    return {
      profile,
      chapters: topChapters,
      candidates: [],
      recommendationStatus: "insufficient",
      criticalQuestion: buildQuestion(profile),
      warnings: [...warnings, "No tariff headings retrieved within predicted chapters."],
      retrievalTrace: { chapterCount: topChapters.length, headingCount: 0, nationalCount: 0 },
    };
  }

  // STAGE C/D — national lines under headings
  const nationalHits = searchNationalInHeadings(
    [
      query,
      ...(pluginMatch?.searchTerms || []),
      /towel/i.test(profile.canonicalProduct) ? "toilet linen terry cotton" : "",
      /polish|restorer/i.test(profile.canonicalProduct) ? "metal polishes" : "",
      /tyre|tire|pneumatic/i.test(profile.canonicalProduct) ? "pneumatic tyres" : "",
      /switch/i.test(profile.canonicalProduct) ? "switches" : "",
      /road wheel/i.test(profile.canonicalProduct) ? "road wheels" : "",
      /ophthalmic|vision screener/i.test(profile.canonicalProduct) ? "ophthalmic instruments" : "",
      /\bprinter\b/i.test(profile.canonicalProduct) ? "printers" : "",
    ].filter(Boolean).join(" "),
    topHeadings.map((h) => h.heading),
    20,
  );

  // Only force-include heading lines when we know the product family.
  // Blind padding with low-score nationals creates confident wrong suggestions.
  const ensured: Array<TariffRow & { score: number; heading: string; chapter: string }> = [...nationalHits];
  const seen = new Set(ensured.map((r) => r.code));
  if (identityKnown) {
    for (const h of topHeadings.slice(0, 3)) {
      for (const row of h.lines.slice(0, 8)) {
        if (seen.has(row.code)) continue;
        seen.add(row.code);
        const parsed = parseTariffCode(row.code);
        ensured.push({
          ...row,
          score: Math.max(1, h.score * 0.2),
          heading: parsed.heading,
          chapter: parsed.chapter,
        });
      }
    }
  }

  // Force-include preferred national lines named by plugin/lexicon
  if (preferredHeadings.length && (pluginMatch?.confidence ?? profile.interpretationConfidence) >= 0.7) {
    for (const pref of preferredHeadings) {
      const digits = pref.replace(/\D/g, "");
      const headingKey = digits.slice(0, 4);
      const rows = getNationalLinesForHeading(headingKey);
      for (const row of rows) {
        if (seen.has(row.code)) continue;
        if (digits.length >= 6 && !row.code.replace(/\D/g, "").startsWith(digits.slice(0, 6))) continue;
        seen.add(row.code);
        const parsed = parseTariffCode(row.code);
        ensured.push({
          ...row,
          score: 30,
          heading: parsed.heading,
          chapter: parsed.chapter,
        });
      }
    }
  }

  const candidates: ScoredCandidate[] = [];
  for (const row of ensured) {
    const parsed = parseTariffCode(row.code);
    const domain = scoreDomain(profile, parsed.chapter);
    if (domain.score <= -100) continue;

    // Prohibited headings from family / plugin
    const prohibited = [
      ...(profile.prohibitedHeadings || []),
      ...(profile.excludedHeadings || []),
    ];
    if (prohibited.some((h) => {
      const digits = h.replace(/\D/g, "");
      return parsed.heading.startsWith(digits.slice(0, 4)) || parsed.national.startsWith(digits.slice(0, 6));
    })) {
      continue;
    }

    // Hard heading gate for high-confidence families (e.g. refrigerator → 8418 only)
    if (hardHeadingGate && preferredHeadings.length) {
      const underPreferred = preferredHeadings.some((h) => {
        const digits = h.replace(/\D/g, "");
        return parsed.heading.startsWith(digits.slice(0, 4))
          || parsed.national.startsWith(digits.slice(0, 6));
      });
      if (!underPreferred) continue;
    }

    const mf = scoreMaterialFunction(profile, row.desc);
    const pluginScore = pluginMatch && plugin
      ? plugin.scoreCandidate?.(pluginMatch, {
        code: row.code,
        description: row.desc,
        chapter: parsed.chapter,
        heading: parsed.heading,
      }) || { delta: 0, supporting: [] as string[], conflicts: [] as string[] }
      : { delta: 0, supporting: [] as string[], conflicts: [] as string[] };

    // Generic text similarity capped
    const retrievalScore = Math.min(8, row.score);
    const domainScore = domain.score;
    const materialScore = mf.materialScore;
    const functionScore = mf.functionScore;
    const historyScore = 0;
    const validationScore = pluginScore.delta;
    const finalScore =
      retrievalScore
      + domainScore
      + materialScore
      + functionScore
      + historyScore
      + validationScore;

    if (finalScore <= -50) continue;

    candidates.push({
      code: row.code,
      description: row.desc,
      chapter: parsed.chapter,
      heading: parsed.heading,
      duty: row.duty,
      source: [
        "hierarchical_retrieval",
        ...(pluginMatch ? [`plugin:${pluginMatch.pluginId}`] : []),
        ...(profile.knownAttributes?.commonProductFastPath ? ["common_product_fast_path"] : []),
      ],
      retrievalScore,
      domainScore,
      materialScore,
      functionScore,
      historyScore,
      validationScore,
      finalScore,
      supportingFacts: [...domain.supporting, ...mf.supporting, ...pluginScore.supporting],
      conflicts: [...domain.conflicts, ...mf.conflicts, ...pluginScore.conflicts],
      missingFacts: profile.missingCriticalAttributes,
    });
  }

  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // Compatibility engine — drop domain/function contradictions before AI / UI
  let ranked = filterCompatibleCandidates(profile, candidates);

  if (
    preferredHeadings.length
    && (hardHeadingGate || (pluginMatch?.confidence ?? profile.interpretationConfidence) >= 0.85)
  ) {
    const preferred = ranked.filter((c) =>
      preferredHeadings.some((h) => {
        const digits = h.replace(/\D/g, "");
        return c.heading.startsWith(digits.slice(0, 4)) || c.code.replace(/\D/g, "").startsWith(digits.slice(0, 6));
      }),
    );
    if (preferred.length) ranked = preferred;
    else if (hardHeadingGate) {
      ranked = [];
      warnings.push("No valid tariff lines under the gated heading family — refusing unrelated recommendations.");
    }
  }

  // Second-pass widen ONLY when family confidence is low and stage-1 returned nothing
  if (!ranked.length && familyConfidence < 0.7 && !widenedSearch) {
    widenedSearch = true;
    warnings.push("Stage-1 family retrieval empty — limited widen via global lexical search.");
    const excluded = new Set(profile.excludedChapters.map((c) => c.padStart(2, "0")));
    const globalHits = searchTariff(query, 12).filter((h) => (h.score ?? 0) >= 4);
    const widenChapters: string[] = [];
    for (const hit of globalHits) {
      const ch = parseTariffCode(hit.code).chapter;
      if (!ch || excluded.has(ch.padStart(2, "0"))) continue;
      if (!widenChapters.includes(ch)) widenChapters.push(ch);
    }
    if (widenChapters.length) {
      const widenHeadings = searchHeadingsInChapters(query, widenChapters.slice(0, 3), 8);
      const widenNationals = searchNationalInHeadings(
        query,
        widenHeadings.map((h) => h.heading),
        15,
      );
      const widenCandidates: ScoredCandidate[] = [];
      for (const row of widenNationals) {
        const parsed = parseTariffCode(row.code);
        const domain = scoreDomain(profile, parsed.chapter);
        if (domain.score <= -100) continue;
        widenCandidates.push({
          code: row.code,
          description: row.desc,
          chapter: parsed.chapter,
          heading: parsed.heading,
          duty: row.duty,
          source: ["hierarchical_retrieval", "second_pass_widen"],
          retrievalScore: Math.min(8, row.score),
          domainScore: domain.score,
          materialScore: 0,
          functionScore: 0,
          historyScore: 0,
          validationScore: 0,
          finalScore: Math.min(8, row.score) + domain.score,
          supportingFacts: domain.supporting,
          conflicts: domain.conflicts,
          missingFacts: profile.missingCriticalAttributes,
        });
      }
      ranked = filterCompatibleCandidates(profile, widenCandidates);
    }
  }

  if (!ranked.length && (hardHeadingGate || familyConfidence >= 0.85)) {
    warnings.push("No reliable tariff match — all retrieved candidates failed compatibility with the product family.");
  }

  const top = ranked.slice(0, 3);

  // Lug-nut / ambiguous hardware: keep provisional — explain distinction
  let recommendationStatus: HierarchicalClassificationResult["recommendationStatus"] = "insufficient";
  if (top.length) {
    if (!identityKnown) {
      // Unknown product: never surface Strong/Likely from weak lexical padding
      recommendationStatus =
        top[0].retrievalScore >= 4 && top[0].finalScore >= 35
          ? "provisional"
          : "insufficient";
    } else if (profile.missingCriticalAttributes.length || /lug-nut|lug nut/i.test(profile.canonicalProduct)) {
      recommendationStatus = "provisional";
    } else if (
      hardHeadingGate
      && top[0].heading.startsWith((preferredHeadings[0] || "").replace(/\D/g, "").slice(0, 4))
    ) {
      recommendationStatus = top[0].finalScore >= 40 ? "likely" : "provisional";
      if (top[0].finalScore >= 55 && profile.interpretationConfidence >= 0.95) {
        recommendationStatus = "strong";
      }
    } else if (top[0].finalScore >= 70 && profile.interpretationConfidence >= 0.85) {
      recommendationStatus = "strong";
    } else if (top[0].finalScore >= 40) {
      recommendationStatus = "likely";
    } else {
      recommendationStatus = "provisional";
    }
  } else if (hardHeadingGate || profile.knownAttributes?.commonProductFastPath) {
    warnings.push("Common product identified but no compatible tariff candidates under gated headings.");
  }

  return {
    profile,
    chapters: topChapters,
    candidates: top,
    recommendationStatus,
    criticalQuestion: buildQuestion(profile),
    warnings,
    retrievalTrace: {
      chapterCount: topChapters.length,
      headingCount: topHeadings.length,
      nationalCount: ensured.length,
    },
  };
}

/** Map hierarchical candidates into worker recommendation candidate shape helpers. */
export function candidateDutyRate(duty: string): number {
  return percentDuty(duty);
}

/**
 * Validate that an AI-selected code exists in the retrieved candidate set.
 * Returns null if the AI invented a code.
 */
export function constrainAiSelection(
  selectedCode: string | null | undefined,
  candidates: ScoredCandidate[],
): ScoredCandidate | null {
  if (!selectedCode) return null;
  const want = parseTariffCode(selectedCode).digits;
  return candidates.find((c) => parseTariffCode(c.code).digits === want) || null;
}
