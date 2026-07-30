import type { D1Database } from "@cloudflare/workers-types";
import type {
  AbbreviationDictionaryEntry,
  AttributeDefinition,
  AttributeLearningEntry,
  AttributeValidationRule,
  BrandDictionaryEntry,
  ChapterPredictionRuleEntry,
  IndustryDictionaryEntry,
  LiquidCompositionLearningEntry,
  LiquidCompositionRuleEntry,
  LiquidProductProfile,
  LiquidCompositionComponent,
  ProductAttributeLibraryEntry,
  ProductDictionaryEntry,
  ProductIdentityLearningEntry,
  ProductQuestion,
  QuestionRuleEntry,
  SupplierCatalogueEntry,
} from "@pas/shared-types";
import { buildLiquidIdentityKey, loadSeedDictionaries, type DictionaryBundle } from "@pas/product-intelligence";
import { normalizeKey } from "@pas/product-intelligence";
import { stripIdentifierNoise, splitSkuVariant } from "@pas/product-intelligence";

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function mapAttrLibraryRow(r: Record<string, unknown>): ProductAttributeLibraryEntry {
  return {
    id: Number(r.id),
    productFamily: String(r.product_family),
    industry: String(r.industry),
    typicalChapters: parseJsonArray<string>(r.typical_chapters as string),
    requiredAttributes: parseJsonArray<AttributeDefinition>(r.required_attributes as string),
    optionalAttributes: parseJsonArray<AttributeDefinition>(r.optional_attributes as string),
    questionOrder: parseJsonArray<string>(r.question_order as string),
    validationRules: parseJsonArray<AttributeValidationRule>(r.validation_rules as string),
    status: String(r.status || "active"),
    created_at: r.created_at as string | undefined,
    updated_at: r.updated_at as string | undefined,
  };
}

export async function loadAttributeLearning(
  db: D1Database,
  opts?: { supplier?: string | null; model?: string | null; part?: string | null },
): Promise<AttributeLearningEntry[]> {
  try {
    let sql = `SELECT * FROM attribute_learning WHERE 1=1`;
    const binds: unknown[] = [];
    if (opts?.supplier) {
      sql += ` AND (normalized_supplier = ? OR supplier_name LIKE ?)`;
      const n = String(opts.supplier).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      binds.push(n, `%${opts.supplier}%`);
    }
    if (opts?.model) {
      sql += ` AND (model_number = ? OR model_number IS NULL OR model_number = '')`;
      binds.push(opts.model);
    }
    if (opts?.part) {
      sql += ` AND (part_number = ? OR part_number IS NULL OR part_number = '')`;
      binds.push(opts.part);
    }
    sql += ` ORDER BY usage_count DESC LIMIT 500`;
    const stmt = db.prepare(sql);
    const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return ((rows.results ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      learning_key: String(r.learning_key),
      supplier_name: (r.supplier_name as string) || null,
      normalized_supplier: (r.normalized_supplier as string) || null,
      model_number: (r.model_number as string) || null,
      part_number: (r.part_number as string) || null,
      product_key: (r.product_key as string) || null,
      product_family: (r.product_family as string) || null,
      attribute_key: String(r.attribute_key),
      attribute_value: String(r.attribute_value),
      confidence: Number(r.confidence || 1),
      usage_count: Number(r.usage_count || 1),
      source: String(r.source || "clerk"),
    }));
  } catch {
    return [];
  }
}

export async function loadLiquidLearningExact(
  db: D1Database,
  parts: {
    supplier?: string | null;
    brand?: string | null;
    productName?: string | null;
    model?: string | null;
    part?: string | null;
    manufacturer?: string | null;
  },
): Promise<LiquidCompositionLearningEntry | null> {
  try {
    const key = buildLiquidIdentityKey(parts);
    const row = await db
      .prepare(`SELECT * FROM liquid_product_compositions WHERE identity_key = ? AND approved = 1`)
      .bind(key)
      .first();
    if (!row) return null;
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      identity_key: String(r.identity_key),
      supplier_name: (r.supplier_name as string) || null,
      brand: (r.brand as string) || null,
      product_name: (r.product_name as string) || null,
      model_number: (r.model_number as string) || null,
      part_number: (r.part_number as string) || null,
      manufacturer: (r.manufacturer as string) || null,
      liquid_profile: JSON.parse(String(r.liquid_profile_json || "{}")) as LiquidProductProfile,
      composition: parseJsonArray<LiquidCompositionComponent>(r.composition_json as string),
      essential_character_component: (r.essential_character_component as string) || null,
      essential_character_reason: (r.essential_character_reason as string) || null,
      approved: Boolean(r.approved),
      usage_count: Number(r.usage_count || 1),
    };
  } catch {
    return null;
  }
}

function mapLiquidRuleRow(r: Record<string, unknown>): LiquidCompositionRuleEntry {
  return {
    id: Number(r.id),
    liquid_type: String(r.liquid_type),
    display_name: String(r.display_name),
    typical_chapters: parseJsonArray<string>(r.typical_chapters as string),
    required_fields: parseJsonArray<string>(r.required_fields as string),
    composition_thresholds: parseJsonArray(r.composition_thresholds as string),
    active_ingredient_mappings: parseJsonArray(r.active_ingredient_mappings as string),
    solvent_base_mappings: parseJsonArray(r.solvent_base_mappings as string),
    chemical_synonyms: parseJsonArray(r.chemical_synonyms as string),
    cas_mappings: parseJsonArray(r.cas_mappings as string),
    classification_hints: parseJsonArray(r.classification_hints as string),
    status: String(r.status || "active"),
  };
}

export async function loadDictionariesFromDb(db: D1Database): Promise<DictionaryBundle> {
  const seed = loadSeedDictionaries();

  try {
    const [industries, products, brands, questionRules, chapterRules, attrLib, liquidRules, abbrevs, catalogue, identityLearning] =
      await Promise.all([
        db.prepare(`SELECT * FROM industry_dictionary WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM product_dictionary WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM brand_dictionary WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM question_rules WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM chapter_prediction_rules WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM product_attribute_library WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM liquid_composition_rules WHERE status = 'active'`).all(),
        db.prepare(`SELECT * FROM abbreviation_dictionary WHERE status = 'active'`).all().catch(() => ({ results: [] })),
        db.prepare(`SELECT * FROM supplier_product_catalogue WHERE status = 'active' LIMIT 500`).all().catch(() => ({ results: [] })),
        db.prepare(`SELECT * FROM product_identity_learning WHERE approved = 1 LIMIT 500`).all().catch(() => ({ results: [] })),
      ]);

    const indRows = (industries.results ?? []) as Array<Record<string, unknown>>;
    if (!indRows.length) return seed;

    const attrRows = (attrLib.results ?? []) as Array<Record<string, unknown>>;
    const liqRows = (liquidRules.results ?? []) as Array<Record<string, unknown>>;
    const abbrRows = (abbrevs.results ?? []) as Array<Record<string, unknown>>;
    const catRows = (catalogue.results ?? []) as Array<Record<string, unknown>>;
    const idRows = (identityLearning.results ?? []) as Array<Record<string, unknown>>;

    return {
      industries: indRows.map(
        (r): IndustryDictionaryEntry => ({
          id: Number(r.id),
          code: String(r.code),
          name: String(r.name),
          description: (r.description as string) || null,
          typical_chapters: parseJsonArray<string>(r.typical_chapters as string),
          status: String(r.status),
        }),
      ),
      products: ((products.results ?? []) as Array<Record<string, unknown>>).map(
        (r): ProductDictionaryEntry => ({
          id: Number(r.id),
          canonical_name: String(r.canonical_name),
          normalized_key: String(r.normalized_key),
          synonyms: parseJsonArray<string>(r.synonyms as string),
          product_family: String(r.product_family),
          industry_code: String(r.industry_code),
          typical_chapter: (r.typical_chapter as string) || null,
          common_materials: parseJsonArray<string>(r.common_materials as string),
          typical_uses: parseJsonArray<string>(r.typical_uses as string),
          status: String(r.status),
          usage_count: Number(r.usage_count || 0),
        }),
      ),
      brands: ((brands.results ?? []) as Array<Record<string, unknown>>).map(
        (r): BrandDictionaryEntry => ({
          id: Number(r.id),
          brand: String(r.brand),
          normalized_brand: String(r.normalized_brand),
          industry_hints: parseJsonArray<string>(r.industry_hints as string),
          typical_chapters: parseJsonArray<string>(r.typical_chapters as string),
          confidence_boost: Number(r.confidence_boost || 0),
          status: String(r.status),
          usage_count: Number(r.usage_count || 0),
        }),
      ),
      questionRules: ((questionRules.results ?? []) as Array<Record<string, unknown>>).map(
        (r): QuestionRuleEntry => ({
          id: Number(r.id),
          industry_code: (r.industry_code as string) || null,
          product_family: (r.product_family as string) || null,
          questions: parseJsonArray<ProductQuestion>(r.questions_json as string),
          priority: Number(r.priority || 100),
          status: String(r.status),
        }),
      ),
      chapterRules: ((chapterRules.results ?? []) as Array<Record<string, unknown>>).map(
        (r): ChapterPredictionRuleEntry => ({
          id: Number(r.id),
          industry_code: (r.industry_code as string) || null,
          product_family: (r.product_family as string) || null,
          material: (r.material as string) || null,
          function_key: (r.function_key as string) || null,
          chapter: String(r.chapter),
          weight: Number(r.weight || 1),
          usage_count: Number(r.usage_count || 0),
          status: String(r.status),
        }),
      ),
      attributeLibrary: attrRows.length ? attrRows.map(mapAttrLibraryRow) : seed.attributeLibrary,
      liquidRules: liqRows.length ? liqRows.map(mapLiquidRuleRow) : seed.liquidRules,
      abbreviations: abbrRows.length
        ? abbrRows.map(
            (r): AbbreviationDictionaryEntry => ({
              id: Number(r.id),
              abbreviation: String(r.abbreviation),
              meaning: String(r.meaning),
              scope: (String(r.scope || "global") as AbbreviationDictionaryEntry["scope"]),
              industry_code: (r.industry_code as string) || null,
              supplier_name: (r.supplier_name as string) || null,
              normalized_supplier: (r.normalized_supplier as string) || null,
              confidence: Number(r.confidence || 0.8),
              verified: Boolean(r.verified),
              status: String(r.status || "active"),
              usage_count: Number(r.usage_count || 0),
            }),
          )
        : seed.abbreviations,
      catalogue: catRows.map(
        (r): SupplierCatalogueEntry => ({
          id: Number(r.id),
          supplier_id: (r.supplier_id as string) || null,
          supplier_name: String(r.supplier_name),
          normalized_supplier: String(r.normalized_supplier),
          brand: (r.brand as string) || null,
          supplier_sku: (r.supplier_sku as string) || null,
          normalized_sku: (r.normalized_sku as string) || null,
          base_part_number: (r.base_part_number as string) || null,
          manufacturer_part_number: (r.manufacturer_part_number as string) || null,
          product_name: (r.product_name as string) || null,
          product_type: (r.product_type as string) || null,
          full_description: (r.full_description as string) || null,
          material: (r.material as string) || null,
          composition: (r.composition as string) || null,
          function_use: (r.function_use as string) || null,
          specifications_json: (r.specifications_json as string) || null,
          image_urls_json: (r.image_urls_json as string) || null,
          approved_hs_code: (r.approved_hs_code as string) || null,
          duty_rate: (r.duty_rate as string) || null,
          approval_status: (String(r.approval_status || "pending") as SupplierCatalogueEntry["approval_status"]),
          source_document: (r.source_document as string) || null,
          last_verified_at: (r.last_verified_at as string) || null,
          status: String(r.status || "active"),
          usage_count: Number(r.usage_count || 0),
        }),
      ),
      identityLearning: idRows.map(
        (r): ProductIdentityLearningEntry => ({
          id: Number(r.id),
          identity_key: String(r.identity_key),
          supplier_name: (r.supplier_name as string) || null,
          brand: (r.brand as string) || null,
          base_part_number: (r.base_part_number as string) || null,
          full_sku: (r.full_sku as string) || null,
          product_family: (r.product_family as string) || null,
          product_type: (r.product_type as string) || null,
          material: (r.material as string) || null,
          function_use: (r.function_use as string) || null,
          specifications_json: (r.specifications_json as string) || null,
          approved_hs_code: (r.approved_hs_code as string) || null,
          duty_rate: (r.duty_rate as string) || null,
          approved: Boolean(r.approved),
          usage_count: Number(r.usage_count || 1),
        }),
      ),
    };
  } catch {
    return seed;
  }
}

export { mapAttrLibraryRow, mapLiquidRuleRow, normalizeKey, stripIdentifierNoise, splitSkuVariant };
