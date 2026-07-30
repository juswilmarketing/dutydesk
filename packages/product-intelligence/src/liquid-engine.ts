import type {
  LiquidCompositionComponent,
  LiquidCompositionConfidences,
  LiquidCompositionConflict,
  LiquidCompositionLearningEntry,
  LiquidCompositionRuleEntry,
  LiquidPhysicalForm,
  LiquidProductProfile,
  ProductProfile,
  ProductQuestion,
  ProductQuestionAnswer,
} from "@pas/shared-types";
import liquidRulesSeed from "../seed/liquid-composition-rules.json";
import { normalizeKey } from "./normalize";

const LIQUID_HINT =
  /\b(liquid|solution|syrup|oil|gel|paste|emulsion|suspension|concentrate|serum|lotion|cream|sauce|beverage|juice|cleaner|disinfectant|lubricant|fuel|ink|paint|adhesive|extract|reagent|bleach|hypochlorite|alcohol|solvent|shampoo|detergent)\b/i;

export function isLikelyLiquid(description: string, profile?: ProductProfile | null): boolean {
  if (profile?.chemical || profile?.food) {
    if (LIQUID_HINT.test(description)) return true;
  }
  return LIQUID_HINT.test(description);
}

export function loadSeedLiquidRules(): LiquidCompositionRuleEntry[] {
  return liquidRulesSeed.map((r, idx) => ({
    id: idx + 1,
    liquid_type: r.liquid_type,
    display_name: r.display_name,
    typical_chapters: r.typical_chapters ?? [],
    required_fields: r.required_fields ?? [],
    composition_thresholds: r.composition_thresholds ?? [],
    active_ingredient_mappings: r.active_ingredient_mappings ?? [],
    solvent_base_mappings: (r.solvent_base_mappings ?? []) as LiquidCompositionRuleEntry["solvent_base_mappings"],
    chemical_synonyms: r.chemical_synonyms ?? [],
    cas_mappings: r.cas_mappings ?? [],
    classification_hints: r.classification_hints ?? [],
    status: "active",
  })) as LiquidCompositionRuleEntry[];
}

function emptyProfile(): LiquidProductProfile {
  return {
    physicalForm: null,
    liquidType: null,
    primaryFunction: null,
    commercialUse: null,
    composition: [],
    activeIngredients: [],
    baseSubstance: null,
    solvent: null,
    concentration: null,
    waterContentPercent: null,
    alcoholContentPercent: null,
    oilContentPercent: null,
    sugarContentPercent: null,
    acidContentPercent: null,
    purityPercent: null,
    foodGrade: null,
    pharmaceuticalGrade: null,
    cosmeticGrade: null,
    industrialGrade: null,
    hazardous: null,
    casNumbers: [],
    unNumber: null,
    ph: null,
    viscosity: null,
    density: null,
    packagingForm: null,
    intendedUse: null,
    essentialCharacterComponent: null,
    essentialCharacterReason: null,
    competingComponents: [],
    classificationImpact: null,
    finishedRetailPreparation: null,
    concentrated: null,
    documentsAvailable: [],
  };
}

function detectPhysicalForm(text: string): { form: LiquidPhysicalForm; confidence: number } {
  if (/\bemulsion\b/i.test(text)) return { form: "emulsion", confidence: 0.92 };
  if (/\bsuspension\b/i.test(text)) return { form: "suspension", confidence: 0.92 };
  if (/\bgel\b/i.test(text)) return { form: "gel", confidence: 0.9 };
  if (/\bpaste\b/i.test(text)) return { form: "paste", confidence: 0.9 };
  if (/\bsyrup\b/i.test(text)) return { form: "syrup", confidence: 0.92 };
  if (/\bconcentrate\b/i.test(text)) return { form: "concentrate", confidence: 0.88 };
  if (/\boil\b/i.test(text)) return { form: "oil", confidence: 0.85 };
  if (/\bsolution\b/i.test(text)) return { form: "solution", confidence: 0.9 };
  if (/\bcream\b/i.test(text)) return { form: "cream", confidence: 0.85 };
  if (/\baerosol\b/i.test(text)) return { form: "aerosol", confidence: 0.88 };
  if (/\b(semi[-\s]?liquid|viscous)\b/i.test(text)) return { form: "semi-liquid", confidence: 0.8 };
  return { form: "liquid", confidence: 0.7 };
}

function detectLiquidType(text: string, rules: LiquidCompositionRuleEntry[]): { type: string; confidence: number } {
  const checks: Array<{ type: string; re: RegExp; conf: number }> = [
    { type: "disinfectant", re: /\bdisinfect/i, conf: 0.9 },
    { type: "cleaning_preparation", re: /\b(clean(?:er|ing)|detergent|soap)\b/i, conf: 0.88 },
    { type: "alcoholic_solution", re: /\b(isopropyl|isopropanol|\bipa\b|ethanol|alcohol solution)\b/i, conf: 0.9 },
    { type: "essential_oil", re: /\bessential oil\b/i, conf: 0.95 },
    { type: "fixed_vegetable_oil", re: /\b(vegetable oil|coconut oil|olive oil|mct oil|palm oil)\b/i, conf: 0.9 },
    { type: "lubricant", re: /\b(lubricant|lube|petroleum[-\s]?based)\b/i, conf: 0.88 },
    { type: "fuel", re: /\b(fuel|diesel|gasoline|petrol)\b/i, conf: 0.9 },
    { type: "beverage", re: /\b(beverage|drink|juice|soft drink)\b/i, conf: 0.88 },
    { type: "syrup", re: /\bsyrup\b/i, conf: 0.9 },
    { type: "sauce", re: /\bsauce\b/i, conf: 0.88 },
    { type: "food_preparation", re: /\b(food prep|condiment|dressing)\b/i, conf: 0.8 },
    { type: "cosmetic_preparation", re: /\b(cosmetic|lotion|shampoo|serum|skincare)\b/i, conf: 0.88 },
    { type: "pharmaceutical_preparation", re: /\b(pharmaceutical|medicinal|oral solution)\b/i, conf: 0.88 },
    { type: "pesticide", re: /\b(pesticide|insecticide|herbicide)\b/i, conf: 0.9 },
    { type: "fertilizer_preparation", re: /\bfertiliz/i, conf: 0.88 },
    { type: "paint", re: /\bpaint\b/i, conf: 0.9 },
    { type: "ink", re: /\bink\b/i, conf: 0.9 },
    { type: "adhesive", re: /\b(adhesive|glue)\b/i, conf: 0.88 },
    { type: "aqueous_solution", re: /\b(aqueous|water[-\s]?based)\b/i, conf: 0.85 },
    { type: "oil_based_solution", re: /\boil[-\s]?based\b/i, conf: 0.85 },
    { type: "emulsion", re: /\bemulsion\b/i, conf: 0.9 },
    { type: "suspension", re: /\bsuspension\b/i, conf: 0.9 },
    { type: "concentrate", re: /\bconcentrate\b/i, conf: 0.85 },
    { type: "extract", re: /\bextract\b/i, conf: 0.85 },
    { type: "mineral_oil_preparation", re: /\bmineral oil\b/i, conf: 0.88 },
    { type: "chemical_reagent", re: /\breagent\b/i, conf: 0.88 },
    { type: "industrial_chemical_mixture", re: /\bindustrial chemical\b/i, conf: 0.8 },
  ];
  for (const c of checks) {
    if (c.re.test(text) && rules.some((r) => r.liquid_type === c.type && r.status === "active")) {
      return { type: c.type, confidence: c.conf };
    }
  }
  if (/\b100%\b|\bpure\b/i.test(text)) return { type: "pure_substance", confidence: 0.75 };
  return { type: "industrial_chemical_mixture", confidence: 0.45 };
}

function canonicalize(name: string, rules: LiquidCompositionRuleEntry[]): string {
  const n = name.toLowerCase().trim();
  for (const rule of rules) {
    for (const syn of rule.chemical_synonyms) {
      if (n === syn.synonym.toLowerCase() || n.includes(syn.synonym.toLowerCase())) {
        return syn.canonical;
      }
    }
  }
  return name.trim();
}

function casFor(name: string, rules: LiquidCompositionRuleEntry[]): string | null {
  const n = name.toLowerCase();
  for (const rule of rules) {
    for (const m of rule.cas_mappings) {
      if (n.includes(m.name.toLowerCase())) return m.cas;
    }
  }
  return null;
}

/** Extract composition patterns from free text (invoice / SDS snippet / label). */
export function extractCompositionFromText(
  text: string,
  rules: LiquidCompositionRuleEntry[],
  source: LiquidCompositionComponent["source"] = "pattern",
): LiquidCompositionComponent[] {
  const comps: LiquidCompositionComponent[] = [];
  const seen = new Set<string>();

  const push = (rawName: string, pct: number | null, opts?: Partial<LiquidCompositionComponent>) => {
    const name = canonicalize(rawName, rules);
    const key = normalizeKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    comps.push({
      name,
      normalizedName: key,
      percentage: pct,
      percentageMin: opts?.percentageMin ?? null,
      percentageMax: opts?.percentageMax ?? null,
      concentrationUnit: opts?.concentrationUnit ?? "%",
      isBalance: opts?.isBalance,
      isTrace: opts?.isTrace,
      casNumber: opts?.casNumber ?? casFor(name, rules),
      role: opts?.role ?? "other",
      confidence: opts?.confidence ?? 0.85,
      source,
    });
  };

  // 70% isopropyl alcohol / isopropyl alcohol 70%
  const pctName = /(\d+(?:\.\d+)?)\s*%\s+([A-Za-z][A-Za-z0-9\s\-/.]{1,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = pctName.exec(text))) {
    push(m[2].replace(/\b(and|with|contains)\b/gi, "").trim(), Number(m[1]));
  }
  const namePct = /([A-Za-z][A-Za-z0-9\s\-/.]{1,40}?)\s+(\d+(?:\.\d+)?)\s*%/gi;
  while ((m = namePct.exec(text))) {
    push(m[1].replace(/\b(contains|approx)\b/gi, "").trim(), Number(m[2]));
  }

  // sodium hypochlorite 5–10%
  const range = /([A-Za-z][A-Za-z0-9\s\-/.]{1,40}?)\s+(\d+(?:\.\d+)?)\s*[–\-to]+\s*(\d+(?:\.\d+)?)\s*%/gi;
  while ((m = range.exec(text))) {
    const min = Number(m[2]);
    const max = Number(m[3]);
    push(m[1].trim(), (min + max) / 2, {
      percentageMin: min,
      percentageMax: max,
      confidence: 0.8,
    });
  }

  // balance water / remainder water
  if (/\b(balance|remainder)\s+(water|solvent)\b/i.test(text)) {
    const bal = text.match(/\b(balance|remainder)\s+(water|solvent)\b/i);
    if (bal) push(bal[2], null, { isBalance: true, role: "solvent", confidence: 0.9 });
  }

  // contains ethanol / contains X
  const contains = /\bcontains\s+([A-Za-z][A-Za-z0-9\s\-/.]{1,40}?)(?:[,.;]|$)/gi;
  while ((m = contains.exec(text))) {
    push(m[1].trim(), null, { confidence: 0.7 });
  }

  // trace
  if (/\btrace\b/i.test(text)) {
    push("trace components", null, { isTrace: true, confidence: 0.6 });
  }

  // Role enrichment from rules
  for (const c of comps) {
    for (const rule of rules) {
      for (const map of rule.active_ingredient_mappings) {
        try {
          if (new RegExp(map.pattern, "i").test(c.name)) {
            c.role = (map.role as LiquidCompositionComponent["role"]) || "active";
            c.confidence = Math.max(c.confidence, 0.9);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return comps;
}

function applyAnswers(profile: LiquidProductProfile, answers?: ProductQuestionAnswer[]): LiquidProductProfile {
  if (!answers?.length) return profile;
  const next = { ...profile, composition: [...profile.composition] };
  for (const a of answers) {
    const v = a.value.trim();
    if (!v || /^unknown$/i.test(v)) continue;
    switch (a.field) {
      case "liquidType":
        next.liquidType = v;
        break;
      case "intendedUse":
      case "primaryFunction":
        next.intendedUse = v;
        next.primaryFunction = next.primaryFunction || v;
        break;
      case "solvent":
        next.solvent = v;
        break;
      case "baseSubstance":
        next.baseSubstance = v;
        break;
      case "activeIngredient":
        if (!next.activeIngredients.includes(v)) next.activeIngredients.push(v);
        break;
      case "composition_text": {
        const extra = extractCompositionFromText(v, loadSeedLiquidRules(), "clerk");
        next.composition = mergeComposition(next.composition, extra);
        break;
      }
      case "foodGrade":
        next.foodGrade = /^yes$/i.test(v);
        break;
      case "cosmeticGrade":
        next.cosmeticGrade = /^yes$/i.test(v);
        break;
      case "pharmaceuticalGrade":
        next.pharmaceuticalGrade = /^yes$/i.test(v);
        break;
      case "industrialGrade":
        next.industrialGrade = /^yes$/i.test(v);
        break;
      case "concentrated":
        next.concentrated = /^yes|concentrated$/i.test(v);
        break;
      case "finishedRetail":
        next.finishedRetailPreparation = /^yes|retail|finished$/i.test(v);
        break;
      case "pureOrMixture":
        next.liquidType =
          /pure/i.test(v) ? "pure_substance" : next.liquidType || "industrial_chemical_mixture";
        break;
      case "baseType":
        if (/water/i.test(v)) next.solvent = next.solvent || "water";
        if (/oil/i.test(v)) next.solvent = next.solvent || "oil";
        if (/alcohol/i.test(v)) next.solvent = next.solvent || "alcohol";
        break;
      case "essentialCharacter":
        next.essentialCharacterComponent = v;
        break;
      case "documentsAvailable":
        next.documentsAvailable = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      default:
        break;
    }
  }
  return next;
}

function mergeComposition(
  a: LiquidCompositionComponent[],
  b: LiquidCompositionComponent[],
): LiquidCompositionComponent[] {
  const map = new Map<string, LiquidCompositionComponent>();
  for (const c of [...a, ...b]) {
    const existing = map.get(c.normalizedName);
    if (!existing || c.confidence >= existing.confidence) map.set(c.normalizedName, c);
  }
  return Array.from(map.values());
}

function inferEssentialCharacter(profile: LiquidProductProfile): {
  component: string | null;
  reason: string | null;
  competing: string[];
  impact: string | null;
} {
  const active = profile.composition.filter((c) => c.role === "active");
  const named = profile.activeIngredients;
  if (named.length) {
    return {
      component: named[0],
      reason: "Active ingredient drives commercial identity and classification.",
      competing: named.slice(1),
      impact: "Heading selection should prioritize the active ingredient function.",
    };
  }
  if (active.length) {
    const sorted = [...active].sort((x, y) => (y.percentage ?? 0) - (x.percentage ?? 0));
    return {
      component: sorted[0].name,
      reason: "Active-role component determines essential character even if not majority %.",
      competing: sorted.slice(1, 3).map((c) => c.name),
      impact: "Do not classify solely by highest percentage solvent/carrier.",
    };
  }
  const withPct = profile.composition
    .filter((c) => c.percentage != null && !c.isBalance)
    .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0));
  if (withPct.length) {
    const top = withPct[0];
    const isSolvent = top.role === "solvent" || /water/i.test(top.name);
    if (isSolvent && withPct[1]) {
      return {
        component: withPct[1].name,
        reason: "Highest % is solvent/carrier; essential character taken from next functional component.",
        competing: [top.name],
        impact: "Solvent majority does not determine HS essential character.",
      };
    }
    return {
      component: top.name,
      reason: "Highest non-trace component by stated percentage.",
      competing: withPct.slice(1, 3).map((c) => c.name),
      impact: null,
    };
  }
  if (profile.baseSubstance) {
    return {
      component: profile.baseSubstance,
      reason: "Base substance used as provisional essential character.",
      competing: [],
      impact: null,
    };
  }
  return { component: null, reason: null, competing: [], impact: null };
}

function computeConfidences(
  profile: LiquidProductProfile,
  formConf: number,
  typeConf: number,
): LiquidCompositionConfidences {
  const hasComp = profile.composition.length > 0;
  const hasPct = profile.composition.some((c) => c.percentage != null || c.isBalance);
  const completeness = !hasComp ? 0.15 : hasPct ? Math.min(0.95, 0.45 + profile.composition.length * 0.12) : 0.4;
  const activeConf = profile.activeIngredients.length || profile.composition.some((c) => c.role === "active") ? 0.85 : 0.35;
  const useConf = profile.intendedUse || profile.primaryFunction ? 0.85 : 0.3;
  const essConf = profile.essentialCharacterComponent ? 0.8 : 0.25;
  const chapter = Math.min(0.9, (typeConf + useConf + completeness) / 3);
  const heading = Math.min(0.88, (completeness + activeConf + essConf) / 3);
  const final =
    completeness < 0.5 || useConf < 0.5 ? Math.min(0.55, chapter) : Math.min(0.92, (chapter + heading + essConf) / 3);

  return {
    productIdentity: Math.min(0.95, (formConf + typeConf) / 2),
    physicalForm: formConf,
    compositionCompleteness: completeness,
    activeIngredient: activeConf,
    primaryUse: useConf,
    essentialCharacter: essConf,
    chapterPrediction: chapter,
    headingPrediction: heading,
    finalClassification: final,
  };
}

function selectLiquidQuestions(
  profile: LiquidProductProfile,
  confidences: LiquidCompositionConfidences,
  rule: LiquidCompositionRuleEntry | undefined,
): ProductQuestion[] {
  const out: ProductQuestion[] = [];
  const ask = (id: string, field: string, prompt: string, options?: string[]) => {
    if (out.length >= 5) return;
    if (out.some((q) => q.field === field)) return;
    out.push({ id: `liq_${id}`, field, prompt, options, required: true });
  };

  if (!profile.liquidType || confidences.productIdentity < 0.7) {
    ask("type", "liquidType", "What type of liquid / preparation is this?", [
      "Pure substance",
      "Aqueous solution",
      "Alcoholic solution",
      "Cleaning preparation",
      "Disinfectant",
      "Vegetable oil",
      "Essential oil",
      "Lubricant",
      "Cosmetic preparation",
      "Pharmaceutical preparation",
      "Syrup",
      "Beverage",
      "Food preparation",
      "Industrial chemical mixture",
      "Other",
    ]);
  }
  if (confidences.compositionCompleteness < 0.6) {
    ask(
      "composition",
      "composition_text",
      "What is the full ingredient or chemical composition (with percentages if known)?",
    );
  }
  if (confidences.activeIngredient < 0.6 && !profile.activeIngredients.length) {
    ask("active", "activeIngredient", "What is the active ingredient?");
  }
  if (!profile.solvent && !profile.baseSubstance) {
    ask("base", "baseType", "Is the product water-based, oil-based, or alcohol-based?", [
      "Water-based",
      "Oil-based",
      "Alcohol-based",
      "Other/Unknown",
    ]);
  }
  if (confidences.primaryUse < 0.6) {
    ask("use", "intendedUse", "What is the product used for?");
  }
  if (
    profile.foodGrade == null &&
    profile.cosmeticGrade == null &&
    profile.pharmaceuticalGrade == null &&
    profile.industrialGrade == null
  ) {
    ask("grade", "industrialGrade", "Is it food-grade, cosmetic-grade, medical-grade, or industrial-grade?", [
      "Food-grade",
      "Cosmetic-grade",
      "Medical/pharmaceutical-grade",
      "Industrial-grade",
      "Unknown",
    ]);
  }
  if (profile.finishedRetailPreparation == null) {
    ask("retail", "finishedRetail", "Is it a finished retail preparation or a raw material?", [
      "Finished retail preparation",
      "Raw material",
      "Unknown",
    ]);
  }
  if (profile.concentrated == null && /concentrate|dilut/i.test(profile.liquidType || "")) {
    ask("conc", "concentrated", "Is it concentrated or ready to use?", [
      "Concentrated",
      "Ready to use",
      "Unknown",
    ]);
  }
  if (!profile.documentsAvailable.length && confidences.compositionCompleteness < 0.7) {
    ask("docs", "documentsAvailable", "Is an SDS, COA, ingredient list, or product specification available?", [
      "SDS",
      "COA",
      "Ingredient list",
      "Product specification",
      "None available",
    ]);
  }
  if (confidences.essentialCharacter < 0.5 && profile.composition.length > 1) {
    ask("ess", "essentialCharacter", "Which component gives the product its essential character?");
  }

  // Rule-required fields still blank
  if (rule) {
    for (const field of rule.required_fields) {
      const val = (profile as unknown as Record<string, unknown>)[field];
      const empty =
        val == null ||
        val === "" ||
        (Array.isArray(val) && val.length === 0);
      if (empty && field === "composition") {
        ask("comp_req", "composition_text", "Composition is required for this liquid type — list ingredients and %.");
      }
    }
  }

  return out;
}

export function buildLiquidIdentityKey(parts: {
  supplier?: string | null;
  brand?: string | null;
  productName?: string | null;
  model?: string | null;
  part?: string | null;
  manufacturer?: string | null;
}): string {
  return [
    normalizeKey(parts.supplier || ""),
    normalizeKey(parts.brand || ""),
    normalizeKey(parts.productName || ""),
    (parts.model || "").toLowerCase().trim(),
    (parts.part || "").toLowerCase().trim(),
    normalizeKey(parts.manufacturer || ""),
  ].join("|");
}

export interface LiquidEngineInput {
  description: string;
  productProfile?: ProductProfile | null;
  answers?: ProductQuestionAnswer[];
  documentSnippets?: Array<{ source: LiquidCompositionComponent["source"]; text: string }>;
  rules?: LiquidCompositionRuleEntry[];
  learned?: LiquidCompositionLearningEntry | null;
}

export interface LiquidEngineResult {
  applicable: boolean;
  profile: LiquidProductProfile;
  confidences: LiquidCompositionConfidences;
  pendingQuestions: ProductQuestion[];
  conflicts: LiquidCompositionConflict[];
  requiresReview: boolean;
  chapterHints: string[];
  knowledgeSources: string[];
}

export function runLiquidCompositionEngine(input: LiquidEngineInput): LiquidEngineResult {
  const rules = (input.rules ?? loadSeedLiquidRules()).filter((r) => r.status === "active");
  const applicable = isLikelyLiquid(input.description, input.productProfile);
  if (!applicable) {
    return {
      applicable: false,
      profile: emptyProfile(),
      confidences: {
        productIdentity: 0,
        physicalForm: 0,
        compositionCompleteness: 0,
        activeIngredient: 0,
        primaryUse: 0,
        essentialCharacter: 0,
        chapterPrediction: 0,
        headingPrediction: 0,
        finalClassification: 0,
      },
      pendingQuestions: [],
      conflicts: [],
      requiresReview: false,
      chapterHints: [],
      knowledgeSources: [],
    };
  }

  const knowledgeSources: string[] = ["Liquid Composition Engine"];
  let profile = emptyProfile();

  // Strict identity reuse — only exact learned product
  if (input.learned?.approved && input.learned.liquid_profile) {
    profile = {
      ...emptyProfile(),
      ...input.learned.liquid_profile,
      composition: input.learned.composition?.length
        ? input.learned.composition
        : input.learned.liquid_profile.composition,
    };
    knowledgeSources.push("Approved Liquid Composition Profile");
  }

  const form = detectPhysicalForm(input.description);
  profile.physicalForm = profile.physicalForm || form.form;
  const typeHit = detectLiquidType(input.description, rules);
  profile.liquidType = profile.liquidType || typeHit.type;

  const fromInvoice = extractCompositionFromText(input.description, rules, "invoice");
  profile.composition = mergeComposition(profile.composition, fromInvoice);
  if (fromInvoice.length) knowledgeSources.push("Invoice Composition Patterns");

  for (const doc of input.documentSnippets ?? []) {
    const extracted = extractCompositionFromText(doc.text, rules, doc.source);
    profile.composition = mergeComposition(profile.composition, extracted);
    if (extracted.length) knowledgeSources.push(doc.source);
  }

  // Solvent / base from mappings
  const rule = rules.find((r) => r.liquid_type === profile.liquidType);
  const blob = [input.description, ...(input.documentSnippets ?? []).map((d) => d.text)].join(" ");
  if (rule) {
    for (const map of rule.solvent_base_mappings) {
      try {
        if (new RegExp(map.pattern, "i").test(blob)) {
          if (map.kind === "solvent") profile.solvent = profile.solvent || map.value;
          else profile.baseSubstance = profile.baseSubstance || map.value;
        }
      } catch {
        /* ignore */
      }
    }
    for (const map of rule.active_ingredient_mappings) {
      try {
        if (new RegExp(map.pattern, "i").test(blob)) {
          if (!profile.activeIngredients.includes(map.ingredient)) {
            profile.activeIngredients.push(map.ingredient);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Content percentages
  const water = profile.composition.find((c) => /water/i.test(c.name) && c.percentage != null);
  if (water?.percentage != null) profile.waterContentPercent = water.percentage;
  const alcohol = profile.composition.find((c) => /alcohol|ethanol|isopropanol|ipa/i.test(c.name));
  if (alcohol?.percentage != null) profile.alcoholContentPercent = alcohol.percentage;
  const oil = profile.composition.find((c) => /\boil\b/i.test(c.name));
  if (oil?.percentage != null) profile.oilContentPercent = oil.percentage;

  if (/\bfood[-\s]?grade\b/i.test(blob)) profile.foodGrade = true;
  if (/\b(pharma|USP|BP)\b/i.test(blob)) profile.pharmaceuticalGrade = true;
  if (/\bcosmetic\b/i.test(blob)) profile.cosmeticGrade = true;
  if (/\bindustrial\b/i.test(blob)) profile.industrialGrade = true;
  if (/\bhazard|flammable|corrosive|dangerous goods\b/i.test(blob)) profile.hazardous = true;
  if (/\bconcentrate\b/i.test(blob)) profile.concentrated = true;
  if (/\bready[-\s]?to[-\s]?use\b/i.test(blob)) profile.concentrated = false;

  const un = blob.match(/\bun[:\s#]*([0-9]{4})\b/i);
  if (un) profile.unNumber = un[1];
  profile.casNumbers = Array.from(
    new Set(profile.composition.map((c) => c.casNumber).filter(Boolean) as string[]),
  );

  profile = applyAnswers(profile, input.answers);

  // Grade answer special-case
  const gradeAns = input.answers?.find((a) => a.field === "industrialGrade");
  if (gradeAns) {
    const v = gradeAns.value.toLowerCase();
    profile.foodGrade = /food/.test(v);
    profile.cosmeticGrade = /cosmetic/.test(v);
    profile.pharmaceuticalGrade = /medical|pharma/.test(v);
    profile.industrialGrade = /industrial/.test(v);
  }

  const ess = inferEssentialCharacter(profile);
  profile.essentialCharacterComponent = profile.essentialCharacterComponent || ess.component;
  profile.essentialCharacterReason = profile.essentialCharacterReason || ess.reason;
  profile.competingComponents = ess.competing;
  profile.classificationImpact = ess.impact;
  if (profile.activeIngredients.length === 0) {
    profile.activeIngredients = profile.composition.filter((c) => c.role === "active").map((c) => c.name);
  }
  if (!profile.primaryFunction) profile.primaryFunction = profile.intendedUse;
  if (!profile.concentration && profile.alcoholContentPercent != null) {
    profile.concentration = `${profile.alcoholContentPercent}%`;
  }

  const confidences = computeConfidences(profile, form.form ? form.confidence : 0.5, typeHit.confidence);
  const pendingQuestions = selectLiquidQuestions(profile, confidences, rule);

  const conflicts: LiquidCompositionConflict[] = [];
  if (profile.composition.some((c) => c.role === "active" && c.percentage == null && !c.isTrace)) {
    conflicts.push({
      conflict_type: "missing_active_percentage",
      description: "Active ingredient is present but quantity/percentage is unknown.",
    });
  }
  if (confidences.compositionCompleteness < 0.5) {
    conflicts.push({
      conflict_type: "incomplete_composition",
      description: "Composition is incomplete — classification may depend on missing percentages.",
    });
  }
  if (!profile.documentsAvailable.length && confidences.compositionCompleteness < 0.6) {
    conflicts.push({
      conflict_type: "missing_sds_coa",
      description: "SDS/COA not indicated — warn before high-confidence liquid classification.",
    });
  }

  const chapterHints = rule?.typical_chapters ?? [];
  const requiresReview =
    confidences.finalClassification < 0.7 ||
    confidences.compositionCompleteness < 0.55 ||
    pendingQuestions.some((q) => q.required) ||
    conflicts.some((c) => c.conflict_type === "incomplete_composition");

  return {
    applicable: true,
    profile,
    confidences,
    pendingQuestions,
    conflicts,
    requiresReview,
    chapterHints,
    knowledgeSources,
  };
}

/** Compact payload for AI — never full SDS/COA text. */
export function compactLiquidForAi(profile: LiquidProductProfile, confidences: LiquidCompositionConfidences) {
  return {
    physicalForm: profile.physicalForm,
    liquidType: profile.liquidType,
    intendedUse: profile.intendedUse,
    primaryFunction: profile.primaryFunction,
    solvent: profile.solvent,
    baseSubstance: profile.baseSubstance,
    activeIngredients: profile.activeIngredients,
    essentialCharacterComponent: profile.essentialCharacterComponent,
    essentialCharacterReason: profile.essentialCharacterReason,
    composition: profile.composition.map((c) => ({
      name: c.name,
      percentage: c.percentage,
      percentageMin: c.percentageMin,
      percentageMax: c.percentageMax,
      unit: c.concentrationUnit,
      role: c.role,
      cas: c.casNumber,
      balance: c.isBalance || false,
    })),
    alcoholContentPercent: profile.alcoholContentPercent,
    waterContentPercent: profile.waterContentPercent,
    hazardous: profile.hazardous,
    grades: {
      food: profile.foodGrade,
      pharma: profile.pharmaceuticalGrade,
      cosmetic: profile.cosmeticGrade,
      industrial: profile.industrialGrade,
    },
    confidences: {
      composition: confidences.compositionCompleteness,
      essentialCharacter: confidences.essentialCharacter,
      use: confidences.primaryUse,
    },
  };
}
