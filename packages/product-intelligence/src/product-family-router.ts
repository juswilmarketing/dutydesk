/**
 * Product Family Router — resolves family + retrieval gates from profile/description.
 * Connects product understanding to tariff search scope (Phase 1 architecture).
 */

import {
  findProductFamily,
  type FamilyQuestion,
  type ProductFamilyDefinition,
} from "./product-families";
import { resolveCommonProduct, type CommonProductEntry } from "./common-product-dictionary";
import type { ProductClassificationProfile } from "./classification-profile";

export type FamilyRouteResult = {
  family: ProductFamilyDefinition | null;
  commonFastPath: boolean;
  canonicalProduct: string;
  productNoun: string;
  productFamily: string;
  productDomain: string;
  primaryFunction: string;
  likelyChapters: string[];
  likelyHeadings: string[];
  preferredHeadings: string[];
  excludedChapters: string[];
  excludedHeadings: string[];
  missingCriticalAttributes: string[];
  searchTerms: string[];
  hardHeadingGate: boolean;
  familyConfidence: number;
  productConfidence: number;
  criticalQuestion: FamilyQuestion | null;
  notes: string[];
};

function energyRoutesCooking(
  energy: string | undefined,
  family: ProductFamilyDefinition,
): Pick<
  FamilyRouteResult,
  "likelyChapters" | "likelyHeadings" | "preferredHeadings" | "excludedChapters" | "hardHeadingGate" | "missingCriticalAttributes" | "searchTerms"
> {
  const baseExcluded = [...family.excludedChapters];
  const e = (energy || "").toLowerCase();
  if (/electric|induction/.test(e)) {
    return {
      likelyChapters: ["85"],
      likelyHeadings: ["8516"],
      preferredHeadings: ["8516"],
      excludedChapters: [...baseExcluded, "73", "84"],
      hardHeadingGate: true,
      missingCriticalAttributes: [],
      searchTerms: ["electric", "ovens", "cookers", "electro-thermic"],
    };
  }
  if (/gas|solid|lpg|propane|wood|charcoal/.test(e)) {
    return {
      likelyChapters: ["73"],
      likelyHeadings: ["7321"],
      preferredHeadings: ["7321"],
      excludedChapters: [...baseExcluded, "85", "84"],
      hardHeadingGate: true,
      missingCriticalAttributes: [],
      searchTerms: ["cooking appliances", "stoves", "of iron or steel"],
    };
  }
  if (/dual/.test(e)) {
    return {
      likelyChapters: ["85", "73"],
      likelyHeadings: ["8516", "7321"],
      preferredHeadings: ["8516", "7321"],
      excludedChapters: baseExcluded,
      hardHeadingGate: false,
      missingCriticalAttributes: [],
      searchTerms: family.searchTerms,
    };
  }
  return {
    likelyChapters: [...family.likelyChapters],
    likelyHeadings: [...family.likelyHeadings],
    preferredHeadings: [...family.likelyHeadings],
    excludedChapters: baseExcluded,
    hardHeadingGate: false,
    missingCriticalAttributes: family.requiredAttributes.includes("energy source")
      ? ["energy source"]
      : [],
    searchTerms: family.searchTerms,
  };
}

/**
 * Route a description (and optional clarification) into a family-scoped retrieval plan.
 */
export function routeProductFamily(
  description: string,
  clarification?: { id: string; value: string } | null,
  options?: { extraEntries?: CommonProductEntry[]; profileHints?: Partial<ProductClassificationProfile> },
): FamilyRouteResult {
  const raw = String(description || "").trim();
  const common = resolveCommonProduct(raw, clarification, { extraEntries: options?.extraEntries });

  const family =
    findProductFamily(raw, {
      productFamily: common?.productFamily || options?.profileHints?.productFamily,
      productNoun: common?.productNoun || options?.profileHints?.productNoun,
      canonicalProduct: common?.canonicalProduct || options?.profileHints?.canonicalProduct,
    })
    || (common
      ? findProductFamily(`${common.canonicalProduct} ${common.productFamily}`)
      : null);

  if (!family && !common) {
    return {
      family: null,
      commonFastPath: false,
      canonicalProduct: "",
      productNoun: "",
      productFamily: "",
      productDomain: "",
      primaryFunction: "",
      likelyChapters: [],
      likelyHeadings: [],
      preferredHeadings: [],
      excludedChapters: [],
      excludedHeadings: [],
      missingCriticalAttributes: ["product type"],
      searchTerms: [],
      hardHeadingGate: false,
      familyConfidence: 0,
      productConfidence: 0,
      criticalQuestion: null,
      notes: ["No product family resolved — ask clerk before broad tariff search"],
    };
  }

  const baseFamily = family!;
  const energy =
    clarification?.id === "energy_source" || clarification?.id === "energy source"
      ? clarification.value
      : common?.energySource;

  let routing = {
    likelyChapters: common?.likelyChapters?.length ? [...common.likelyChapters] : [...baseFamily.likelyChapters],
    likelyHeadings: common?.likelyHeadings?.length ? [...common.likelyHeadings] : [...baseFamily.likelyHeadings],
    preferredHeadings: common?.preferredHeadings?.length
      ? [...common.preferredHeadings]
      : [...baseFamily.likelyHeadings],
    excludedChapters: common?.excludedChapters?.length
      ? [...common.excludedChapters]
      : [...baseFamily.excludedChapters],
    hardHeadingGate: common?.hardHeadingGate ?? (baseFamily.likelyHeadings.length === 1),
    missingCriticalAttributes: [
      ...(common?.missingCriticalAttributes || []),
    ],
    searchTerms: common?.searchTerms?.length ? [...common.searchTerms] : [...baseFamily.searchTerms],
  };

  if (baseFamily.id === "cooking_appliances") {
    routing = { ...routing, ...energyRoutesCooking(energy, baseFamily) };
  }

  // Family-required attributes still missing
  for (const attr of baseFamily.requiredAttributes) {
    if (attr === "energy source" && routing.missingCriticalAttributes.includes("energy source")) continue;
    if (attr === "material") {
      const mat = options?.profileHints?.material;
      if (!mat || /^unknown/i.test(mat)) {
        if (!routing.missingCriticalAttributes.includes("material")) {
          routing.missingCriticalAttributes.push("material");
        }
      }
    }
    if (attr === "empty or filled") {
      const filled = options?.profileHints?.technicalSpecifications?.emptyOrFilled
        ?? options?.profileHints?.technicalSpecifications?.suppliedEmpty;
      if (filled == null && !routing.missingCriticalAttributes.includes("empty or filled")) {
        // packaging plugin often resolves this — only ask if truly unknown
      }
    }
    if (attr === "primary function") {
      const fn = options?.profileHints?.primaryFunction || common?.primaryFunction;
      if (!fn || /^unknown/i.test(fn)) {
        if (!routing.missingCriticalAttributes.includes("primary function")) {
          routing.missingCriticalAttributes.push("primary function");
        }
      }
    }
  }

  // Drop answered clarification attrs
  if (clarification?.id === "material" && clarification.value && !/^unknown$/i.test(clarification.value)) {
    routing.missingCriticalAttributes = routing.missingCriticalAttributes.filter((a) => a !== "material");
  }
  if (
    (clarification?.id === "energy_source" || clarification?.id === "energy source")
    && clarification.value
    && !/^unknown$/i.test(clarification.value)
  ) {
    routing.missingCriticalAttributes = routing.missingCriticalAttributes.filter((a) => a !== "energy source");
  }
  if (
    (clarification?.id === "primary_function" || clarification?.id === "primary_use")
    && clarification.value
  ) {
    routing.missingCriticalAttributes = routing.missingCriticalAttributes.filter((a) => a !== "primary function");
  }
  if (clarification?.id === "tuner_present") {
    routing.missingCriticalAttributes = routing.missingCriticalAttributes.filter((a) => a !== "tuner present");
  }

  const nextMissing = routing.missingCriticalAttributes[0];
  const criticalQuestion =
    baseFamily.questionPriority.find((q) =>
      nextMissing === q.attributeKey
      || nextMissing === q.id
      || (nextMissing === "energy source" && q.id === "energy_source")
      || (nextMissing === "material" && q.id === "material")
      || (nextMissing === "primary function" && q.id === "primary_function"),
    ) || null;

  const familyConfidence = common?.productFamilyConfidence ?? baseFamily.confidence;
  const productConfidence = common?.confidence ?? (familyConfidence * 0.9);

  return {
    family: baseFamily,
    commonFastPath: Boolean(common?.fastPath),
    canonicalProduct: common?.canonicalProduct || baseFamily.aliases[0] || "",
    productNoun: common?.productNoun || baseFamily.aliases[0] || "",
    productFamily: baseFamily.label,
    productDomain: baseFamily.productDomain,
    primaryFunction: common?.primaryFunction || "",
    likelyChapters: routing.likelyChapters,
    likelyHeadings: routing.likelyHeadings,
    preferredHeadings: routing.preferredHeadings,
    excludedChapters: routing.excludedChapters,
    excludedHeadings: [...baseFamily.excludedHeadings, ...(common?.prohibitedHeadings || [])],
    missingCriticalAttributes: routing.missingCriticalAttributes,
    searchTerms: routing.searchTerms,
    hardHeadingGate: routing.hardHeadingGate && !routing.missingCriticalAttributes.includes("energy source"),
    familyConfidence,
    productConfidence,
    criticalQuestion,
    notes: [
      `Product family route: ${baseFamily.label}`,
      ...(common ? [`Common product fast path: ${common.canonicalProduct}`] : []),
    ],
  };
}

/** Apply a family route onto an existing profile (mutates copy). */
export function applyFamilyRouteToProfile(
  profile: ProductClassificationProfile,
  route: FamilyRouteResult,
): ProductClassificationProfile {
  if (!route.family && !route.commonFastPath) return profile;
  // Preserve plugin/common identity nouns; family router supplies retrieval gates + labels
  const preserveIdentity = Boolean(
    profile.pluginId
    || profile.knownAttributes?.commonProductFastPath
    || (profile.canonicalProduct && profile.interpretationConfidence >= 0.85),
  );

  return {
    ...profile,
    canonicalProduct: preserveIdentity
      ? profile.canonicalProduct
      : (route.canonicalProduct || profile.canonicalProduct),
    productNoun: preserveIdentity
      ? (profile.productNoun || route.productNoun)
      : (route.productNoun || profile.productNoun),
    productFamily: route.productFamily || profile.productFamily,
    industry: profile.industry || route.productDomain,
    primaryFunction: profile.primaryFunction || route.primaryFunction,
    likelyChapters: route.likelyChapters.length ? route.likelyChapters : profile.likelyChapters,
    excludedChapters: route.excludedChapters.length
      ? [...new Set([...profile.excludedChapters, ...route.excludedChapters])]
      : profile.excludedChapters,
    preferredHeadings: route.preferredHeadings.length
      ? route.preferredHeadings
      : profile.preferredHeadings,
    prohibitedHeadings: [
      ...new Set([
        ...(profile.prohibitedHeadings || []),
        ...route.excludedHeadings,
      ]),
    ],
    missingCriticalAttributes: [
      ...new Set([
        ...profile.missingCriticalAttributes,
        ...route.missingCriticalAttributes,
      ]),
    ],
    interpretationConfidence: Math.max(profile.interpretationConfidence, route.productConfidence),
    knownAttributes: {
      ...profile.knownAttributes,
      commonProductFastPath: profile.knownAttributes?.commonProductFastPath || route.commonFastPath,
      productFamilyConfidence: route.familyConfidence,
      productConfidence: route.productConfidence,
      hardHeadingGate: route.hardHeadingGate || Boolean(profile.knownAttributes?.hardHeadingGate),
      productDomain: route.productDomain,
      likelyHeadings: route.likelyHeadings.join(","),
      familyId: route.family?.id || null,
    },
    technicalSpecifications: {
      ...(profile.technicalSpecifications || {}),
      productDomain: route.productDomain,
      familyId: route.family?.id || null,
      hardHeadingGate: route.hardHeadingGate || Boolean(profile.knownAttributes?.hardHeadingGate),
    },
    cleanDescription: [
      profile.cleanDescription,
      ...route.searchTerms,
    ].filter(Boolean).join(" ").slice(0, 200),
  };
}
