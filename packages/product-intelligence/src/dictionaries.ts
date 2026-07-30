import type {
  AbbreviationDictionaryEntry,
  BrandDictionaryEntry,
  ChapterPredictionRuleEntry,
  IndustryDictionaryEntry,
  LiquidCompositionRuleEntry,
  ProductAttributeLibraryEntry,
  ProductDictionaryEntry,
  ProductIdentityLearningEntry,
  ProductQuestion,
  QuestionRuleEntry,
  SupplierCatalogueEntry,
} from "@pas/shared-types";
import industriesSeed from "../seed/industries.json";
import productsSeed from "../seed/products.json";
import brandsSeed from "../seed/brands.json";
import questionRulesSeed from "../seed/question-rules.json";
import chapterRulesSeed from "../seed/chapter-rules.json";
import abbreviationsSeed from "../seed/abbreviations.json";
import { normalizeKey } from "./normalize";
import { loadSeedAttributeLibrary } from "./attribute-engine";
import { loadSeedLiquidRules } from "./liquid-engine";

export interface DictionaryBundle {
  industries: IndustryDictionaryEntry[];
  products: ProductDictionaryEntry[];
  brands: BrandDictionaryEntry[];
  questionRules: QuestionRuleEntry[];
  chapterRules: ChapterPredictionRuleEntry[];
  attributeLibrary: ProductAttributeLibraryEntry[];
  liquidRules: LiquidCompositionRuleEntry[];
  abbreviations: AbbreviationDictionaryEntry[];
  catalogue: SupplierCatalogueEntry[];
  identityLearning: ProductIdentityLearningEntry[];
}

export function loadSeedDictionaries(): DictionaryBundle {
  const industries: IndustryDictionaryEntry[] = industriesSeed.map((i, idx) => ({
    id: idx + 1,
    code: i.code,
    name: i.name,
    description: i.description,
    typical_chapters: i.typical_chapters,
    status: "active",
  }));

  const products: ProductDictionaryEntry[] = productsSeed.map((p, idx) => ({
    id: idx + 1,
    canonical_name: p.canonical_name,
    normalized_key: normalizeKey(p.canonical_name),
    synonyms: p.synonyms,
    product_family: p.product_family,
    industry_code: p.industry_code,
    typical_chapter: p.typical_chapter,
    common_materials: p.common_materials,
    typical_uses: p.typical_uses,
    status: "active",
    usage_count: 0,
  }));

  const brands: BrandDictionaryEntry[] = brandsSeed.map((b, idx) => ({
    id: idx + 1,
    brand: b.brand,
    normalized_brand: normalizeKey(b.brand),
    industry_hints: b.industry_hints,
    typical_chapters: b.typical_chapters,
    confidence_boost: b.confidence_boost,
    status: "active",
    usage_count: 0,
  }));

  const questionRules: QuestionRuleEntry[] = questionRulesSeed.map((q, idx) => ({
    id: idx + 1,
    industry_code: q.industry_code,
    product_family: q.product_family,
    questions: q.questions as ProductQuestion[],
    priority: q.priority,
    status: "active",
  }));

  const chapterRules: ChapterPredictionRuleEntry[] = chapterRulesSeed.map((r, idx) => ({
    id: idx + 1,
    industry_code: r.industry_code,
    product_family: r.product_family,
    material: r.material,
    function_key: r.function_key,
    chapter: r.chapter,
    weight: r.weight,
    usage_count: 0,
    status: "active",
  }));

  const abbreviations: AbbreviationDictionaryEntry[] = abbreviationsSeed.map((a, idx) => ({
    id: idx + 1,
    abbreviation: a.abbreviation,
    meaning: a.meaning,
    scope: (a.scope as AbbreviationDictionaryEntry["scope"]) || "global",
    industry_code: (a as { industry_code?: string }).industry_code ?? null,
    supplier_name: null,
    normalized_supplier: null,
    confidence: a.confidence ?? 0.8,
    verified: Boolean(a.verified),
    status: "active",
    usage_count: 0,
  }));

  return {
    industries,
    products,
    brands,
    questionRules,
    chapterRules,
    attributeLibrary: loadSeedAttributeLibrary(),
    liquidRules: loadSeedLiquidRules(),
    abbreviations,
    catalogue: [],
    identityLearning: [],
  };
}

/** Short keys (e.g. "car") must be whole tokens — never match inside "cartridge". */
function keyMatchesDesc(normalizedDesc: string, key: string): boolean {
  if (!key) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Always require whole-token / whole-phrase boundaries
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalizedDesc);
}

export function matchProduct(
  normalizedDesc: string,
  products: ProductDictionaryEntry[],
): ProductDictionaryEntry | null {
  const exact = products.find(
    (p) => p.status === "active" && (p.normalized_key === normalizedDesc || p.synonyms.some((s) => normalizeKey(s) === normalizedDesc)),
  );
  if (exact) return exact;

  let best: ProductDictionaryEntry | null = null;
  let bestScore = 0;
  for (const p of products) {
    if (p.status !== "active") continue;
    const keys = [p.normalized_key, ...p.synonyms.map(normalizeKey)];
    for (const k of keys) {
      if (!k) continue;
      if (keyMatchesDesc(normalizedDesc, k)) {
        // Prefer longer, more specific keys so "tire rack" beats "tire"
        const coverage = k.length / Math.max(normalizedDesc.length, 1);
        const specificity = Math.min(0.5, k.split(/\s+/).length * 0.15 + k.length / 25);
        const score = coverage + specificity;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
  }
  return bestScore >= 0.35 ? best : null;
}

export function matchBrand(desc: string, brands: BrandDictionaryEntry[]): BrandDictionaryEntry | null {
  const n = normalizeKey(desc);
  for (const b of brands) {
    if (b.status !== "active") continue;
    if (n.includes(b.normalized_brand)) return b;
  }
  return null;
}

export function industryByCode(
  code: string | null | undefined,
  industries: IndustryDictionaryEntry[],
): IndustryDictionaryEntry | null {
  if (!code) return null;
  return industries.find((i) => i.code === code && i.status === "active") ?? null;
}
