import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { buildLearningKey, buildLiquidIdentityKey, buildProductIdentityKey, normalizeKey, runProductIntelligence, splitSkuVariant, stripIdentifierNoise } from "@pas/product-intelligence";
import {
  loadAttributeLearning,
  loadDictionariesFromDb,
  loadLiquidLearningExact,
  mapAttrLibraryRow,
  mapLiquidRuleRow,
} from "../lib/product-intelligence-db";
import { audit } from "../lib/utils";
import { adminMiddleware } from "../middleware/auth";
import type {
  AttributeDefinition,
  AttributeValidationRule,
  LiquidCompositionComponent,
  LiquidProductProfile,
  ProductQuestionAnswer,
  SupplierClassificationEntry,
} from "@pas/shared-types";

const pie = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();
admin.use("*", adminMiddleware);

async function recordAttrEvents(
  db: Env["DB"],
  events: Array<{
    event_type: string;
    product_family?: string | null;
    attribute_key?: string | null;
    question_prompt?: string | null;
    confidence?: number | null;
  }>,
) {
  for (const e of events.slice(0, 40)) {
    try {
      await db
        .prepare(
          `INSERT INTO attribute_analytics_events (event_type, product_family, attribute_key, question_prompt, confidence)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          e.event_type,
          e.product_family ?? null,
          e.attribute_key ?? null,
          e.question_prompt ?? null,
          e.confidence ?? null,
        )
        .run();
    } catch {
      /* table may not exist yet on older deploys */
    }
  }
}

pie.post("/analyze", async (c) => {
  const body = await c.req.json<{
    supplier_name?: string;
    supplier_history?: SupplierClassificationEntry[];
    items?: Array<{
      line_id: number;
      description: string;
      part_number?: string;
      model_number?: string;
      answers?: ProductQuestionAnswer[];
    }>;
  }>();

  const items = body.items?.filter((i) => i.description?.trim()) ?? [];
  if (!items.length) return c.json({ error: "No items" }, 400);

  const dictionaries = await loadDictionariesFromDb(c.env.DB);
  const learning = await loadAttributeLearning(c.env.DB, { supplier: body.supplier_name });

  // Cap batch size to stay under Cloudflare/Worker wall-clock limits
  const batch = items.slice(0, 40);
  const allDescs = batch.map((i) => i.description);

  // Prefetch liquid learning in parallel (bounded) instead of serial per line
  const liquidByLine = new Map<number, Awaited<ReturnType<typeof loadLiquidLearningExact>>>();
  await Promise.all(
    batch.map(async (item) => {
      try {
        const hit = await loadLiquidLearningExact(c.env.DB, {
          supplier: body.supplier_name,
          productName: item.description,
          model: item.model_number,
          part: item.part_number,
        });
        liquidByLine.set(item.line_id, hit);
      } catch {
        liquidByLine.set(item.line_id, null);
      }
    }),
  );

  const results = [];
  for (let idx = 0; idx < batch.length; idx++) {
    const item = batch[idx];
    const adjacent = allDescs.filter((_, i) => i !== idx).slice(0, 6);
    results.push(
      runProductIntelligence({
        line_id: item.line_id,
        description: item.description,
        supplier: body.supplier_name,
        part_number: item.part_number,
        model_number: item.model_number,
        answers: item.answers,
        supplierHistory: body.supplier_history,
        dictionaries,
        attributeLearning: learning,
        liquidLearning: liquidByLine.get(item.line_id) ?? null,
        adjacentDescriptions: adjacent,
      }),
    );
  }

  const events: Array<{
    event_type: string;
    product_family?: string | null;
    attribute_key?: string | null;
    question_prompt?: string | null;
    confidence?: number | null;
  }> = [];
  for (const r of results) {
    for (const q of r.pending_questions) {
      events.push({
        event_type: "asked",
        product_family: r.profile.productFamily,
        attribute_key: q.field,
        question_prompt: q.prompt,
      });
      events.push({
        event_type: "missing",
        product_family: r.profile.productFamily,
        attribute_key: q.field,
      });
    }
    for (const inf of r.inferred_attributes ?? []) {
      if (inf.source !== "clerk" && inf.source !== "default") {
        events.push({
          event_type: "inferred",
          product_family: r.profile.productFamily,
          attribute_key: inf.key,
          confidence: inf.confidence,
        });
      }
    }
  }
  await recordAttrEvents(c.env.DB, events);

  return c.json({ results });
});

pie.post("/reanalyze", async (c) => {
  const body = await c.req.json<{
    supplier_name?: string;
    supplier_history?: SupplierClassificationEntry[];
    line_id: number;
    description: string;
    part_number?: string;
    model_number?: string;
    answers?: ProductQuestionAnswer[];
  }>();

  if (!body.description?.trim()) return c.json({ error: "description required" }, 400);
  const dictionaries = await loadDictionariesFromDb(c.env.DB);
  const learning = await loadAttributeLearning(c.env.DB, {
    supplier: body.supplier_name,
    model: body.model_number,
    part: body.part_number,
  });
  const liquidLearning = await loadLiquidLearningExact(c.env.DB, {
    supplier: body.supplier_name,
    productName: body.description,
    model: body.model_number,
    part: body.part_number,
  });
  const result = runProductIntelligence({
    line_id: body.line_id,
    description: body.description,
    supplier: body.supplier_name,
    part_number: body.part_number,
    model_number: body.model_number,
    answers: body.answers,
    supplierHistory: body.supplier_history,
    dictionaries,
    attributeLearning: learning,
    liquidLearning,
  });

  if (body.answers?.length) {
    await recordAttrEvents(
      c.env.DB,
      body.answers.map((a) => ({
        event_type: "answered",
        product_family: result.profile.productFamily,
        attribute_key: a.field,
      })),
    );
  }

  return c.json({ result });
});

pie.post("/learn", async (c) => {
  const body = await c.req.json<{
    original_description: string;
    profile: unknown;
    predictions?: unknown;
    questions?: unknown;
    answers?: unknown;
    explainability?: unknown;
    selected_hs_code: string;
    duty_rate?: string;
    supplier_name?: string;
    brand?: string;
    invoice_id?: string;
  }>();

  if (!body.original_description || !body.selected_hs_code) {
    return c.json({ error: "original_description and selected_hs_code required" }, 400);
  }

  const profile = body.profile as {
    normalizedName?: string;
    industryCode?: string;
    productFamily?: string;
    brand?: string | null;
  };

  const inserted = await c.env.DB.prepare(
    `INSERT INTO product_profiles
      (line_key, invoice_id, supplier_name, original_description, profile_json, predictions_json, questions_json, answers_json, explainability_json, selected_hs_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      String(Date.now()),
      body.invoice_id ?? null,
      body.supplier_name ?? null,
      body.original_description,
      JSON.stringify(body.profile ?? {}),
      JSON.stringify(body.predictions ?? null),
      JSON.stringify(body.questions ?? null),
      JSON.stringify(body.answers ?? null),
      JSON.stringify(body.explainability ?? null),
      body.selected_hs_code,
    )
    .run();

  const profileId = Number(inserted.meta.last_row_id);

  await c.env.DB.prepare(
    `INSERT INTO product_learning_events
      (profile_id, original_description, normalized_name, industry_code, product_family, predicted_chapter, predicted_heading, selected_hs_code, duty_rate, questions_json, answers_json, predictions_json, explainability_json, clerk_username, supplier_name, brand)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      profileId,
      body.original_description,
      profile.normalizedName ?? null,
      profile.industryCode ?? null,
      profile.productFamily ?? null,
      (body.predictions as { chapter?: string } | undefined)?.chapter ?? null,
      (body.predictions as { headings?: Array<{ heading: string }> } | undefined)?.headings?.[0]?.heading ?? null,
      body.selected_hs_code,
      body.duty_rate ?? null,
      JSON.stringify(body.questions ?? null),
      JSON.stringify(body.answers ?? null),
      JSON.stringify(body.predictions ?? null),
      JSON.stringify(body.explainability ?? null),
      c.var.username,
      body.supplier_name ?? null,
      body.brand ?? profile.brand ?? null,
    )
    .run();

  // Grow product dictionary from approved classification
  if (profile.normalizedName) {
    const key = normalizeKey(profile.normalizedName);
    const chapter = body.selected_hs_code.replace(/\D/g, "").slice(0, 2);
    await c.env.DB.prepare(
      `INSERT INTO product_dictionary (canonical_name, normalized_key, synonyms, product_family, industry_code, typical_chapter, common_materials, typical_uses, status, usage_count)
       VALUES (?, ?, '[]', ?, ?, ?, '[]', '[]', 'active', 1)
       ON CONFLICT(normalized_key) DO UPDATE SET
         usage_count = usage_count + 1,
         typical_chapter = COALESCE(excluded.typical_chapter, typical_chapter),
         industry_code = COALESCE(excluded.industry_code, industry_code),
         updated_at = datetime('now')`,
    )
      .bind(
        profile.normalizedName,
        key,
        profile.productFamily || "General",
        profile.industryCode || "consumer",
        chapter || null,
      )
      .run();
  }

  if (body.brand || profile.brand) {
    const brand = String(body.brand || profile.brand);
    const nb = normalizeKey(brand);
    await c.env.DB.prepare(
      `INSERT INTO brand_dictionary (brand, normalized_brand, industry_hints, typical_chapters, confidence_boost, status, usage_count)
       VALUES (?, ?, ?, ?, 0.05, 'active', 1)
       ON CONFLICT(normalized_brand) DO UPDATE SET usage_count = usage_count + 1, updated_at = datetime('now')`,
    )
      .bind(
        brand,
        nb,
        JSON.stringify(profile.industryCode ? [profile.industryCode] : []),
        JSON.stringify([body.selected_hs_code.replace(/\D/g, "").slice(0, 2)].filter(Boolean)),
      )
      .run();
  }

  // Persist clerk attribute answers into Attribute Learning cache
  const answers = (body.answers as ProductQuestionAnswer[] | undefined) ?? [];
  const fullProfile = body.profile as {
    normalizedName?: string;
    productFamily?: string;
    brand?: string | null;
    model?: string | null;
    partNumber?: string | null;
    attributes?: Record<string, string | number | boolean | null>;
  };
  const productKey = normalizeKey(fullProfile.normalizedName || body.original_description);
  const attrEntries: Array<{ key: string; value: string }> = answers
    .filter((a) => a.value?.trim())
    .map((a) => ({ key: a.field, value: a.value.trim() }));

  if (fullProfile.attributes) {
    for (const [k, v] of Object.entries(fullProfile.attributes)) {
      if (v == null || String(v).trim() === "") continue;
      if (!attrEntries.some((e) => e.key === k)) {
        attrEntries.push({ key: k, value: String(v) });
      }
    }
  }

  for (const entry of attrEntries.slice(0, 40)) {
    const learningKey = buildLearningKey({
      supplier: body.supplier_name,
      model: fullProfile.model,
      part: fullProfile.partNumber,
      productKey,
      attributeKey: entry.key,
    });
    try {
      await c.env.DB.prepare(
        `INSERT INTO attribute_learning
          (learning_key, supplier_name, normalized_supplier, model_number, part_number, product_key, product_family, attribute_key, attribute_value, confidence, usage_count, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, 1, 'clerk')
         ON CONFLICT(learning_key) DO UPDATE SET
           attribute_value = excluded.attribute_value,
           usage_count = usage_count + 1,
           confidence = MIN(0.99, confidence + 0.01),
           updated_at = datetime('now')`,
      )
        .bind(
          learningKey,
          body.supplier_name ?? null,
          body.supplier_name ? normalizeKey(body.supplier_name) : null,
          fullProfile.model ?? null,
          fullProfile.partNumber ?? null,
          productKey,
          fullProfile.productFamily ?? null,
          entry.key,
          entry.value,
        )
        .run();
    } catch {
      /* ignore if migration not applied */
    }
  }

  // Persist approved liquid composition against exact product identity only
  const liquidProfile = (body as { liquid_profile?: LiquidProductProfile }).liquid_profile;
  if (liquidProfile?.liquidType || liquidProfile?.composition?.length) {
    const identityKey = buildLiquidIdentityKey({
      supplier: body.supplier_name,
      brand: fullProfile.brand || body.brand,
      productName: fullProfile.normalizedName || body.original_description,
      model: fullProfile.model,
      part: fullProfile.partNumber,
    });
    try {
      await c.env.DB.prepare(
        `INSERT INTO liquid_product_compositions
          (identity_key, supplier_name, brand, product_name, model_number, part_number, liquid_profile_json, composition_json, essential_character_component, essential_character_reason, approved, approved_by, usage_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
         ON CONFLICT(identity_key) DO UPDATE SET
           liquid_profile_json = excluded.liquid_profile_json,
           composition_json = excluded.composition_json,
           essential_character_component = excluded.essential_character_component,
           essential_character_reason = excluded.essential_character_reason,
           approved = 1,
           approved_by = excluded.approved_by,
           usage_count = usage_count + 1,
           updated_at = datetime('now')`,
      )
        .bind(
          identityKey,
          body.supplier_name ?? null,
          fullProfile.brand || body.brand || null,
          fullProfile.normalizedName || body.original_description,
          fullProfile.model ?? null,
          fullProfile.partNumber ?? null,
          JSON.stringify(liquidProfile),
          JSON.stringify(liquidProfile.composition ?? []),
          liquidProfile.essentialCharacterComponent ?? null,
          liquidProfile.essentialCharacterReason ?? null,
          c.var.username,
        )
        .run();
    } catch {
      /* ignore */
    }
  }

  // Persist resolved product identity for future SKU/part resolution
  try {
    const attrs = (fullProfile as { attributes?: Record<string, string | number | boolean | null> }).attributes || {};
    const parsed = (body.explainability as { parsedDescription?: {
      sku?: string | null;
      basePartNumber?: string | null;
      brandOrProductFamily?: string | null;
      productType?: string | null;
      material?: string | null;
      function?: string | null;
    } } | undefined)?.parsedDescription;
    const sku = String(parsed?.sku || fullProfile.model || attrs.sku || "").trim() || null;
    const basePart = String(parsed?.basePartNumber || fullProfile.partNumber || attrs.basePartNumber || "").trim() || null;
    const brand = String(parsed?.brandOrProductFamily || fullProfile.brand || body.brand || "").trim() || null;
    const productType = String(parsed?.productType || fullProfile.productFamily || "").trim() || null;
    const material = String(parsed?.material || attrs.material || "").trim() || null;
    const functionUse = String(parsed?.function || attrs.function || "").trim() || null;
    if (sku || basePart) {
      const identityKey = buildProductIdentityKey({
        supplier: body.supplier_name,
        brand,
        basePart,
        sku,
      });
      await c.env.DB.prepare(
        `INSERT INTO product_identity_learning
          (identity_key, supplier_name, brand, base_part_number, full_sku, product_family, product_type, material, function_use, approved_hs_code, duty_rate, approved, usage_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON CONFLICT(identity_key) DO UPDATE SET
           product_type = COALESCE(excluded.product_type, product_type),
           material = COALESCE(excluded.material, material),
           function_use = COALESCE(excluded.function_use, function_use),
           approved_hs_code = excluded.approved_hs_code,
           duty_rate = COALESCE(excluded.duty_rate, duty_rate),
           approved = 1,
           usage_count = usage_count + 1,
           updated_at = datetime('now')`,
      )
        .bind(
          identityKey,
          body.supplier_name ?? null,
          brand,
          basePart || splitSkuVariant(sku || "").basePartNumber,
          sku,
          fullProfile.productFamily ?? null,
          productType,
          material,
          functionUse,
          body.selected_hs_code,
          body.duty_rate ?? null,
        )
        .run();
    }
  } catch {
    /* migration may not be applied yet */
  }

  await audit(c, "product_intelligence_learn");
  return c.json({ ok: true, profile_id: profileId });
});

// ---- Admin CRUD helpers ----

admin.get("/product-dictionary", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM product_dictionary ORDER BY usage_count DESC, canonical_name LIMIT 2000`).all();
  return c.json({
    entries: (rows.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      synonyms: JSON.parse(String(r.synonyms || "[]")),
      common_materials: JSON.parse(String(r.common_materials || "[]")),
      typical_uses: JSON.parse(String(r.typical_uses || "[]")),
    })),
  });
});

admin.post("/product-dictionary", async (c) => {
  const body = await c.req.json<{
    canonical_name: string;
    synonyms?: string[];
    product_family: string;
    industry_code: string;
    typical_chapter?: string;
    common_materials?: string[];
    typical_uses?: string[];
  }>();
  const key = normalizeKey(body.canonical_name);
  await c.env.DB.prepare(
    `INSERT INTO product_dictionary (canonical_name, normalized_key, synonyms, product_family, industry_code, typical_chapter, common_materials, typical_uses)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.canonical_name,
      key,
      JSON.stringify(body.synonyms ?? []),
      body.product_family,
      body.industry_code,
      body.typical_chapter ?? null,
      JSON.stringify(body.common_materials ?? []),
      JSON.stringify(body.typical_uses ?? []),
    )
    .run();
  await audit(c, "product_dictionary_create");
  return c.json({ ok: true });
});

admin.delete("/product-dictionary/:id", async (c) => {
  await c.env.DB.prepare(`UPDATE product_dictionary SET status = 'disabled' WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

admin.get("/industry-dictionary", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM industry_dictionary ORDER BY name`).all();
  return c.json({
    entries: (rows.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      typical_chapters: JSON.parse(String(r.typical_chapters || "[]")),
    })),
  });
});

admin.post("/industry-dictionary", async (c) => {
  const body = await c.req.json<{ code: string; name: string; description?: string; typical_chapters?: string[] }>();
  await c.env.DB.prepare(
    `INSERT INTO industry_dictionary (code, name, description, typical_chapters) VALUES (?, ?, ?, ?)`,
  )
    .bind(body.code, body.name, body.description ?? null, JSON.stringify(body.typical_chapters ?? []))
    .run();
  return c.json({ ok: true });
});

admin.get("/brand-dictionary", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM brand_dictionary ORDER BY brand`).all();
  return c.json({
    entries: (rows.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      industry_hints: JSON.parse(String(r.industry_hints || "[]")),
      typical_chapters: JSON.parse(String(r.typical_chapters || "[]")),
    })),
  });
});

admin.post("/brand-dictionary", async (c) => {
  const body = await c.req.json<{
    brand: string;
    industry_hints?: string[];
    typical_chapters?: string[];
    confidence_boost?: number;
  }>();
  await c.env.DB.prepare(
    `INSERT INTO brand_dictionary (brand, normalized_brand, industry_hints, typical_chapters, confidence_boost)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      body.brand,
      normalizeKey(body.brand),
      JSON.stringify(body.industry_hints ?? []),
      JSON.stringify(body.typical_chapters ?? []),
      body.confidence_boost ?? 0.05,
    )
    .run();
  return c.json({ ok: true });
});

admin.get("/question-rules", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM question_rules ORDER BY priority`).all();
  return c.json({
    entries: (rows.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      questions: JSON.parse(String(r.questions_json || "[]")),
    })),
  });
});

admin.post("/question-rules", async (c) => {
  const body = await c.req.json<{
    industry_code?: string;
    product_family?: string;
    questions: unknown[];
    priority?: number;
  }>();
  await c.env.DB.prepare(
    `INSERT INTO question_rules (industry_code, product_family, questions_json, priority) VALUES (?, ?, ?, ?)`,
  )
    .bind(body.industry_code ?? null, body.product_family ?? null, JSON.stringify(body.questions ?? []), body.priority ?? 100)
    .run();
  return c.json({ ok: true });
});

admin.get("/chapter-prediction-rules", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM chapter_prediction_rules ORDER BY weight DESC`).all();
  return c.json({ entries: rows.results ?? [] });
});

admin.post("/chapter-prediction-rules", async (c) => {
  const body = await c.req.json<{
    industry_code?: string;
    product_family?: string;
    material?: string;
    function_key?: string;
    chapter: string;
    weight?: number;
  }>();
  await c.env.DB.prepare(
    `INSERT INTO chapter_prediction_rules (industry_code, product_family, material, function_key, chapter, weight)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.industry_code ?? null,
      body.product_family ?? null,
      body.material ?? null,
      body.function_key ?? null,
      body.chapter,
      body.weight ?? 1,
    )
    .run();
  return c.json({ ok: true });
});

admin.get("/product-profiles", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, supplier_name, original_description, selected_hs_code, created_at FROM product_profiles ORDER BY id DESC LIMIT 500`,
  ).all();
  return c.json({ entries: rows.results ?? [] });
});

admin.get("/product-profiles/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM product_profiles WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .first();
  return c.json({ entry: row });
});

admin.get("/supplier-intelligence", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT supplier_name,
            COUNT(*) AS profile_count,
            COUNT(DISTINCT selected_hs_code) AS distinct_hs,
            MAX(created_at) AS last_seen
     FROM product_profiles
     WHERE supplier_name IS NOT NULL AND supplier_name != ''
     GROUP BY supplier_name
     ORDER BY profile_count DESC
     LIMIT 200`,
  ).all();
  return c.json({ entries: rows.results ?? [] });
});

admin.get("/learning-stats", async (c) => {
  const byIndustry = await c.env.DB.prepare(
    `SELECT industry_code AS key, COUNT(*) AS count FROM product_learning_events GROUP BY industry_code ORDER BY count DESC LIMIT 50`,
  ).all();
  const byChapter = await c.env.DB.prepare(
    `SELECT predicted_chapter AS key, COUNT(*) AS count FROM product_learning_events GROUP BY predicted_chapter ORDER BY count DESC LIMIT 50`,
  ).all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM product_learning_events`).first<{ n: number }>();
  return c.json({
    total: total?.n ?? 0,
    by_industry: byIndustry.results ?? [],
    by_chapter: byChapter.results ?? [],
  });
});

// ---- Product Attribute Library ----

admin.get("/attribute-library", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM product_attribute_library ORDER BY product_family`,
    ).all();
    return c.json({
      entries: ((rows.results ?? []) as Array<Record<string, unknown>>).map(mapAttrLibraryRow),
    });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.get("/attribute-library/export/all", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM product_attribute_library ORDER BY product_family`).all();
  const profiles = ((rows.results ?? []) as Array<Record<string, unknown>>).map(mapAttrLibraryRow);
  return c.json({
    exported_at: new Date().toISOString(),
    profiles: profiles.map((p) => ({
      productFamily: p.productFamily,
      industry: p.industry,
      typicalChapters: p.typicalChapters,
      requiredAttributes: p.requiredAttributes,
      optionalAttributes: p.optionalAttributes,
      questionOrder: p.questionOrder,
      validationRules: p.validationRules,
    })),
  });
});

admin.get("/attribute-library/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM product_attribute_library WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ entry: mapAttrLibraryRow(row as Record<string, unknown>) });
});

admin.post("/attribute-library", async (c) => {
  const body = await c.req.json<{
    productFamily: string;
    industry: string;
    typicalChapters?: string[];
    requiredAttributes?: AttributeDefinition[];
    optionalAttributes?: AttributeDefinition[];
    questionOrder?: string[];
    validationRules?: AttributeValidationRule[];
  }>();
  if (!body.productFamily?.trim() || !body.industry?.trim()) {
    return c.json({ error: "productFamily and industry required" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO product_attribute_library
      (product_family, industry, typical_chapters, required_attributes, optional_attributes, question_order, validation_rules)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_family) DO UPDATE SET
       industry = excluded.industry,
       typical_chapters = excluded.typical_chapters,
       required_attributes = excluded.required_attributes,
       optional_attributes = excluded.optional_attributes,
       question_order = excluded.question_order,
       validation_rules = excluded.validation_rules,
       updated_at = datetime('now'),
       status = 'active'`,
  )
    .bind(
      body.productFamily.trim(),
      body.industry.trim(),
      JSON.stringify(body.typicalChapters ?? []),
      JSON.stringify(body.requiredAttributes ?? []),
      JSON.stringify(body.optionalAttributes ?? []),
      JSON.stringify(body.questionOrder ?? []),
      JSON.stringify(body.validationRules ?? []),
    )
    .run();
  await audit(c, "attribute_library_upsert");
  return c.json({ ok: true });
});

admin.put("/attribute-library/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    productFamily?: string;
    industry?: string;
    typicalChapters?: string[];
    requiredAttributes?: AttributeDefinition[];
    optionalAttributes?: AttributeDefinition[];
    questionOrder?: string[];
    validationRules?: AttributeValidationRule[];
    status?: string;
  }>();
  const existing = await c.env.DB.prepare(`SELECT * FROM product_attribute_library WHERE id = ?`).bind(id).first();
  if (!existing) return c.json({ error: "Not found" }, 404);
  const row = existing as Record<string, unknown>;
  await c.env.DB.prepare(
    `UPDATE product_attribute_library SET
      product_family = ?, industry = ?, typical_chapters = ?, required_attributes = ?,
      optional_attributes = ?, question_order = ?, validation_rules = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.productFamily ?? row.product_family,
      body.industry ?? row.industry,
      JSON.stringify(body.typicalChapters ?? JSON.parse(String(row.typical_chapters || "[]"))),
      JSON.stringify(body.requiredAttributes ?? JSON.parse(String(row.required_attributes || "[]"))),
      JSON.stringify(body.optionalAttributes ?? JSON.parse(String(row.optional_attributes || "[]"))),
      JSON.stringify(body.questionOrder ?? JSON.parse(String(row.question_order || "[]"))),
      JSON.stringify(body.validationRules ?? JSON.parse(String(row.validation_rules || "[]"))),
      body.status ?? row.status ?? "active",
      id,
    )
    .run();
  return c.json({ ok: true });
});

admin.delete("/attribute-library/:id", async (c) => {
  await c.env.DB.prepare(`UPDATE product_attribute_library SET status = 'disabled', updated_at = datetime('now') WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

admin.post("/attribute-library/import", async (c) => {
  const body = await c.req.json<{
    profiles?: Array<{
      productFamily: string;
      industry: string;
      typicalChapters?: string[];
      requiredAttributes?: AttributeDefinition[];
      optionalAttributes?: AttributeDefinition[];
      questionOrder?: string[];
      validationRules?: AttributeValidationRule[];
    }>;
  }>();
  const profiles = body.profiles ?? [];
  let imported = 0;
  for (const p of profiles) {
    if (!p.productFamily || !p.industry) continue;
    await c.env.DB.prepare(
      `INSERT INTO product_attribute_library
        (product_family, industry, typical_chapters, required_attributes, optional_attributes, question_order, validation_rules)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_family) DO UPDATE SET
         industry = excluded.industry,
         typical_chapters = excluded.typical_chapters,
         required_attributes = excluded.required_attributes,
         optional_attributes = excluded.optional_attributes,
         question_order = excluded.question_order,
         validation_rules = excluded.validation_rules,
         updated_at = datetime('now'),
         status = 'active'`,
    )
      .bind(
        p.productFamily,
        p.industry,
        JSON.stringify(p.typicalChapters ?? []),
        JSON.stringify(p.requiredAttributes ?? []),
        JSON.stringify(p.optionalAttributes ?? []),
        JSON.stringify(p.questionOrder ?? []),
        JSON.stringify(p.validationRules ?? []),
      )
      .run();
    imported++;
  }
  await audit(c, "attribute_library_import");
  return c.json({ ok: true, imported });
});

admin.get("/attribute-analytics", async (c) => {
  try {
    const mostAsked = await c.env.DB.prepare(
      `SELECT attribute_key, COUNT(*) AS count FROM attribute_analytics_events
       WHERE event_type = 'asked' AND attribute_key IS NOT NULL
       GROUP BY attribute_key ORDER BY count DESC LIMIT 20`,
    ).all();
    const missing = await c.env.DB.prepare(
      `SELECT attribute_key, COUNT(*) AS count FROM attribute_analytics_events
       WHERE event_type = 'missing' AND attribute_key IS NOT NULL
       GROUP BY attribute_key ORDER BY count DESC LIMIT 20`,
    ).all();
    const inferred = await c.env.DB.prepare(
      `SELECT attribute_key, COUNT(*) AS count FROM attribute_analytics_events
       WHERE event_type = 'inferred' AND attribute_key IS NOT NULL
       GROUP BY attribute_key ORDER BY count DESC LIMIT 20`,
    ).all();
    const totals = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'asked' THEN 1 ELSE 0 END) AS asked,
         SUM(CASE WHEN event_type = 'inferred' THEN 1 ELSE 0 END) AS inferred,
         SUM(CASE WHEN event_type = 'answered' THEN 1 ELSE 0 END) AS answered,
         COUNT(DISTINCT date(created_at) || COALESCE(product_family,'')) AS classifications
       FROM attribute_analytics_events`,
    ).first<{ asked: number; inferred: number; answered: number; classifications: number }>();

    const asked = Number(totals?.asked || 0);
    const inferredN = Number(totals?.inferred || 0);
    const classifications = Math.max(1, Number(totals?.classifications || 1));
    const avgQ = asked / classifications;
    const denom = asked + inferredN;
    const reduction = denom > 0 ? Math.round((inferredN / denom) * 100) : 0;

    return c.json({
      most_asked: mostAsked.results ?? [],
      missing_attributes: missing.results ?? [],
      auto_inferred: inferred.results ?? [],
      average_questions_per_classification: Math.round(avgQ * 100) / 100,
      question_reduction_pct: reduction,
      confidence_improvements: inferredN,
      classification_accuracy_improvements: Number(totals?.answered || 0),
      total_asked: asked,
      total_inferred: inferredN,
      total_answered: Number(totals?.answered || 0),
      total_classifications: Number(totals?.classifications || 0),
    });
  } catch {
    return c.json({
      most_asked: [],
      missing_attributes: [],
      auto_inferred: [],
      average_questions_per_classification: 0,
      question_reduction_pct: 0,
      confidence_improvements: 0,
      classification_accuracy_improvements: 0,
      total_asked: 0,
      total_inferred: 0,
      total_answered: 0,
      total_classifications: 0,
    });
  }
});

// ---- Liquid Composition Rules & Profiles ----

admin.get("/liquid-composition-rules", async (c) => {
  try {
    const rows = await c.env.DB.prepare(`SELECT * FROM liquid_composition_rules ORDER BY display_name`).all();
    return c.json({
      entries: ((rows.results ?? []) as Array<Record<string, unknown>>).map(mapLiquidRuleRow),
    });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.post("/liquid-composition-rules", async (c) => {
  const body = await c.req.json<{
    liquid_type: string;
    display_name: string;
    typical_chapters?: string[];
    required_fields?: string[];
    composition_thresholds?: unknown[];
    active_ingredient_mappings?: unknown[];
    solvent_base_mappings?: unknown[];
    chemical_synonyms?: unknown[];
    cas_mappings?: unknown[];
    classification_hints?: unknown[];
  }>();
  if (!body.liquid_type?.trim() || !body.display_name?.trim()) {
    return c.json({ error: "liquid_type and display_name required" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO liquid_composition_rules
      (liquid_type, display_name, typical_chapters, required_fields, composition_thresholds, active_ingredient_mappings, solvent_base_mappings, chemical_synonyms, cas_mappings, classification_hints)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(liquid_type) DO UPDATE SET
       display_name = excluded.display_name,
       typical_chapters = excluded.typical_chapters,
       required_fields = excluded.required_fields,
       composition_thresholds = excluded.composition_thresholds,
       active_ingredient_mappings = excluded.active_ingredient_mappings,
       solvent_base_mappings = excluded.solvent_base_mappings,
       chemical_synonyms = excluded.chemical_synonyms,
       cas_mappings = excluded.cas_mappings,
       classification_hints = excluded.classification_hints,
       updated_at = datetime('now'),
       status = 'active'`,
  )
    .bind(
      body.liquid_type.trim(),
      body.display_name.trim(),
      JSON.stringify(body.typical_chapters ?? []),
      JSON.stringify(body.required_fields ?? []),
      JSON.stringify(body.composition_thresholds ?? []),
      JSON.stringify(body.active_ingredient_mappings ?? []),
      JSON.stringify(body.solvent_base_mappings ?? []),
      JSON.stringify(body.chemical_synonyms ?? []),
      JSON.stringify(body.cas_mappings ?? []),
      JSON.stringify(body.classification_hints ?? []),
    )
    .run();
  return c.json({ ok: true });
});

admin.put("/liquid-composition-rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();
  const existing = await c.env.DB.prepare(`SELECT * FROM liquid_composition_rules WHERE id = ?`).bind(id).first();
  if (!existing) return c.json({ error: "Not found" }, 404);
  const row = existing as Record<string, unknown>;
  await c.env.DB.prepare(
    `UPDATE liquid_composition_rules SET
      display_name = ?, typical_chapters = ?, required_fields = ?, composition_thresholds = ?,
      active_ingredient_mappings = ?, solvent_base_mappings = ?, chemical_synonyms = ?, cas_mappings = ?,
      classification_hints = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.display_name ?? row.display_name,
      JSON.stringify(body.typical_chapters ?? JSON.parse(String(row.typical_chapters || "[]"))),
      JSON.stringify(body.required_fields ?? JSON.parse(String(row.required_fields || "[]"))),
      JSON.stringify(body.composition_thresholds ?? JSON.parse(String(row.composition_thresholds || "[]"))),
      JSON.stringify(body.active_ingredient_mappings ?? JSON.parse(String(row.active_ingredient_mappings || "[]"))),
      JSON.stringify(body.solvent_base_mappings ?? JSON.parse(String(row.solvent_base_mappings || "[]"))),
      JSON.stringify(body.chemical_synonyms ?? JSON.parse(String(row.chemical_synonyms || "[]"))),
      JSON.stringify(body.cas_mappings ?? JSON.parse(String(row.cas_mappings || "[]"))),
      JSON.stringify(body.classification_hints ?? JSON.parse(String(row.classification_hints || "[]"))),
      body.status ?? row.status ?? "active",
      id,
    )
    .run();
  return c.json({ ok: true });
});

admin.get("/liquid-compositions", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, identity_key, supplier_name, brand, product_name, model_number, part_number, essential_character_component, approved, usage_count, updated_at
       FROM liquid_product_compositions ORDER BY updated_at DESC LIMIT 500`,
    ).all();
    return c.json({ entries: rows.results ?? [] });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.post("/liquid-compositions/:id/approve", async (c) => {
  await c.env.DB.prepare(
    `UPDATE liquid_product_compositions SET approved = 1, approved_by = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(c.var.username, Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

admin.get("/liquid-conflicts", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM liquid_composition_conflicts WHERE status = 'open' ORDER BY id DESC LIMIT 200`,
    ).all();
    return c.json({ entries: rows.results ?? [] });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.post("/liquid-extract", async (c) => {
  const body = await c.req.json<{
    text?: string;
    source?: LiquidCompositionComponent["source"];
  }>();
  if (!body.text?.trim()) return c.json({ error: "text required" }, 400);
  const { extractCompositionFromText, loadSeedLiquidRules } = await import("@pas/product-intelligence");
  const composition = extractCompositionFromText(
    body.text,
    await loadDictionariesFromDb(c.env.DB).then((d) => d.liquidRules).catch(() => loadSeedLiquidRules()),
    body.source || "SDS",
  );
  return c.json({ composition });
});

admin.get("/abbreviations", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM abbreviation_dictionary WHERE status = 'active' ORDER BY abbreviation LIMIT 2000`,
    ).all();
    return c.json({ entries: rows.results ?? [] });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.post("/abbreviations", async (c) => {
  const body = await c.req.json<{
    abbreviation: string;
    meaning: string;
    scope?: string;
    industry_code?: string;
    supplier_name?: string;
    confidence?: number;
    verified?: boolean;
  }>();
  if (!body.abbreviation?.trim() || !body.meaning?.trim()) {
    return c.json({ error: "abbreviation and meaning required" }, 400);
  }
  const supplier = body.supplier_name?.trim() || null;
  await c.env.DB.prepare(
    `INSERT INTO abbreviation_dictionary
      (abbreviation, meaning, scope, industry_code, supplier_name, normalized_supplier, confidence, verified, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  )
    .bind(
      body.abbreviation.trim().toUpperCase(),
      body.meaning.trim(),
      body.scope || "global",
      body.industry_code || null,
      supplier,
      supplier ? normalizeKey(supplier) : null,
      body.confidence ?? 0.8,
      body.verified ? 1 : 0,
    )
    .run();
  await audit(c, "abbreviation_create");
  return c.json({ ok: true });
});

admin.post("/abbreviations/:id/disable", async (c) => {
  await c.env.DB.prepare(`UPDATE abbreviation_dictionary SET status = 'disabled', updated_at = datetime('now') WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

admin.get("/supplier-catalogue", async (c) => {
  const supplier = c.req.query("supplier");
  try {
    let sql = `SELECT * FROM supplier_product_catalogue WHERE status = 'active'`;
    const binds: unknown[] = [];
    if (supplier) {
      sql += ` AND (normalized_supplier LIKE ? OR supplier_name LIKE ?)`;
      const n = normalizeKey(supplier);
      binds.push(`%${n}%`, `%${supplier}%`);
    }
    sql += ` ORDER BY usage_count DESC, id DESC LIMIT 2000`;
    const stmt = c.env.DB.prepare(sql);
    const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return c.json({ entries: rows.results ?? [] });
  } catch {
    return c.json({ entries: [] });
  }
});

admin.post("/supplier-catalogue", async (c) => {
  const body = await c.req.json<{
    supplier_name: string;
    brand?: string;
    supplier_sku?: string;
    manufacturer_part_number?: string;
    product_name?: string;
    product_type?: string;
    full_description?: string;
    material?: string;
    function_use?: string;
    approved_hs_code?: string;
    duty_rate?: string;
    approval_status?: string;
    source_document?: string;
  }>();
  if (!body.supplier_name?.trim()) return c.json({ error: "supplier_name required" }, 400);
  const sku = body.supplier_sku?.trim() || null;
  const parts = splitSkuVariant(sku || body.manufacturer_part_number || "");
  await c.env.DB.prepare(
    `INSERT INTO supplier_product_catalogue
      (supplier_name, normalized_supplier, brand, supplier_sku, normalized_sku, base_part_number, manufacturer_part_number,
       product_name, product_type, full_description, material, function_use, approved_hs_code, duty_rate, approval_status, source_document, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  )
    .bind(
      body.supplier_name.trim(),
      normalizeKey(body.supplier_name),
      body.brand || null,
      sku,
      parts.normalizedSku || (sku ? stripIdentifierNoise(sku) : null),
      parts.basePartNumber,
      body.manufacturer_part_number || null,
      body.product_name || null,
      body.product_type || null,
      body.full_description || null,
      body.material || null,
      body.function_use || null,
      body.approved_hs_code || null,
      body.duty_rate || null,
      body.approval_status || "pending",
      body.source_document || null,
    )
    .run();
  await audit(c, "supplier_catalogue_create");
  return c.json({ ok: true });
});

admin.post("/supplier-catalogue/:id/verify", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ approved_hs_code?: string; duty_rate?: string }>().catch(() => ({} as { approved_hs_code?: string; duty_rate?: string }));
  await c.env.DB.prepare(
    `UPDATE supplier_product_catalogue SET
      approval_status = 'verified',
      approved_hs_code = COALESCE(?, approved_hs_code),
      duty_rate = COALESCE(?, duty_rate),
      last_verified_at = datetime('now'),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(body.approved_hs_code ?? null, body.duty_rate ?? null, id)
    .run();
  return c.json({ ok: true });
});

admin.post("/supplier-catalogue/:id/disable", async (c) => {
  await c.env.DB.prepare(`UPDATE supplier_product_catalogue SET status = 'disabled', updated_at = datetime('now') WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

pie.route("/", admin);

export default pie;
