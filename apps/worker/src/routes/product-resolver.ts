import { Hono } from "hono";
import type {
  ProductResolution,
  ProductResolverCandidate,
  ProductResolverSource,
} from "@pas/shared-types";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";

const resolver = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type CanonicalRow = {
  id: number;
  canonical_name: string;
  normalized_name: string;
  industry_code: string | null;
  industry_name: string | null;
  product_family: string | null;
  typical_materials_json: string;
  typical_chapters_json: string;
  common_uses_json: string;
  typical_attributes_json: string;
  approved_tariff: string | null;
  approval_count: number;
  correction_count: number;
  import_count: number;
};

type AliasRow = {
  canonical_product_id: number;
  alias: string;
  normalized_alias: string;
  compact_alias: string;
  phonetic_key: string | null;
  source: string;
  usage_count: number;
};

type SupplierMappingRow = {
  canonical_product_id: number;
  supplier_name: string;
  normalized_supplier: string;
  supplier_sku: string | null;
  normalized_sku: string | null;
  supplier_description: string | null;
  normalized_description: string | null;
  approved_tariff: string | null;
  approval_count: number;
  import_count: number;
};

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(womens|woman|ladies)\b/g, "women")
    .replace(/\b(aluminium)\b/g, "aluminum")
    .replace(/\b(microfibre)\b/g, "microfiber")
    .replace(/\b(twl)\b/g, "towel")
    .replace(/\b(pwr)\b/g, "power")
    .replace(/\b(sup)\b/g, "supply")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function singular(value: string): string {
  return normalize(value)
    .split(" ")
    .map((word) => {
      if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
      if (word.endsWith("ses") && word.length > 4) return word.slice(0, -2);
      if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
      return word;
    })
    .join(" ");
}

function soundex(value: string): string {
  const clean = normalize(value).replace(/[^a-z]/g, "");
  if (!clean) return "";
  const first = clean[0].toUpperCase();
  const codes: Record<string, string> = {
    b: "1", f: "1", p: "1", v: "1",
    c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
    d: "3", t: "3",
    l: "4",
    m: "5", n: "5",
    r: "6",
  };
  let out = first;
  let previous = codes[clean[0]] || "";
  for (const char of clean.slice(1)) {
    const code = codes[char] || "";
    if (code && code !== previous) out += code;
    previous = code;
    if (out.length === 4) break;
  }
  return `${out}000`.slice(0, 4);
}

function levenshtein(a: string, b: string): number {
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return prev[b.length];
}

function tokenScore(query: string, candidate: string): number {
  const q = new Set(normalize(query).split(" ").filter(Boolean));
  const c = new Set(normalize(candidate).split(" ").filter(Boolean));
  if (!q.size || !c.size) return 0;
  const overlap = [...q].filter((t) => c.has(t)).length;
  return overlap / Math.max(q.size, c.size);
}

function parseArray(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function supplierKey(value: string | null | undefined): string {
  return normalize(value || "");
}

function skuKey(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadResolverIndex(db: D1Database) {
  const [products, aliases] = await Promise.all([
    db.prepare(`SELECT * FROM canonical_products WHERE status = 'active' LIMIT 1500`).all<CanonicalRow>(),
    db.prepare(`SELECT canonical_product_id, alias, normalized_alias, compact_alias, phonetic_key, source, usage_count
                FROM product_aliases WHERE approved = 1 LIMIT 5000`).all<AliasRow>(),
  ]);
  return {
    products: products.results || [],
    aliases: aliases.results || [],
  };
}

function candidateFrom(
  row: CanonicalRow,
  confidence: number,
  source: ProductResolverSource,
  reasons: string[],
  matchedAlias: string | null,
  supplierStats?: { supplierCount: number; imports: number; tariff: string | null },
): ProductResolverCandidate {
  const totalDecisions = row.approval_count + row.correction_count;
  return {
    canonicalProductId: row.id,
    canonicalName: row.canonical_name,
    confidence: Math.round(Math.max(0, Math.min(0.99, confidence)) * 1000) / 1000,
    source,
    matchedAlias,
    industry: row.industry_name || row.industry_code,
    productFamily: row.product_family,
    typicalMaterials: parseArray(row.typical_materials_json),
    typicalChapters: parseArray(row.typical_chapters_json),
    commonUses: parseArray(row.common_uses_json),
    typicalAttributes: parseArray(row.typical_attributes_json),
    approvedTariff: supplierStats?.tariff || row.approved_tariff,
    supplierCount: supplierStats?.supplierCount || 0,
    previousImports: supplierStats?.imports || row.import_count || 0,
    approvalRate: totalDecisions ? row.approval_count / totalDecisions : row.approval_count ? 1 : 0,
    reasons,
  };
}

export async function resolveProduct(
  db: D1Database,
  description: string,
  opts?: { supplier?: string | null; sku?: string | null; brand?: string | null; limit?: number },
): Promise<ProductResolution> {
  const query = normalize(description);
  const queryCompact = compact(description);
  const querySingular = singular(description);
  const queryPhonetic = soundex(description);
  const limit = Math.max(1, Math.min(12, opts?.limit || 6));
  const { products, aliases } = await loadResolverIndex(db);
  const byId = new Map(products.map((p) => [p.id, p]));

  const supplier = supplierKey(opts?.supplier);
  const sku = skuKey(opts?.sku);
  let supplierRows: SupplierMappingRow[] = [];
  if (supplier) {
    const result = await db
      .prepare(
        `SELECT * FROM supplier_product_mappings
         WHERE approved = 1 AND normalized_supplier LIKE ?
         ORDER BY import_count DESC LIMIT 500`,
      )
      .bind(`%${supplier.split(" ")[0]}%`)
      .all<SupplierMappingRow>();
    supplierRows = result.results || [];
  }

  const supplierStatsRows = await db
    .prepare(
      `SELECT canonical_product_id, COUNT(DISTINCT normalized_supplier) AS supplier_count,
              SUM(import_count) AS imports,
              MAX(CASE WHEN approved = 1 THEN approved_tariff ELSE NULL END) AS tariff
       FROM supplier_product_mappings GROUP BY canonical_product_id`,
    )
    .all<{ canonical_product_id: number; supplier_count: number; imports: number; tariff: string | null }>();
  const supplierStats = new Map(
    (supplierStatsRows.results || []).map((r) => [
      r.canonical_product_id,
      { supplierCount: Number(r.supplier_count || 0), imports: Number(r.imports || 0), tariff: r.tariff },
    ]),
  );

  const scores = new Map<
    number,
    { score: number; source: ProductResolverSource; reasons: string[]; alias: string | null }
  >();

  const offer = (
    productId: number,
    score: number,
    source: ProductResolverSource,
    reason: string,
    alias: string | null = null,
  ) => {
    if (!byId.has(productId)) return;
    const current = scores.get(productId);
    if (!current || score > current.score) {
      scores.set(productId, { score, source, reasons: [reason], alias });
    } else if (!current.reasons.includes(reason)) {
      current.reasons.push(reason);
    }
  };

  // 1. Supplier SKU/description memory before all general matching.
  for (const mapping of supplierRows) {
    const exactSku = sku && mapping.normalized_sku && sku === skuKey(mapping.normalized_sku);
    const exactDescription =
      mapping.normalized_description &&
      (query === mapping.normalized_description || queryCompact === compact(mapping.normalized_description));
    if (exactSku) {
      offer(mapping.canonical_product_id, 0.99, "supplier_exact", "Exact approved supplier/SKU match");
    } else if (exactDescription) {
      offer(mapping.canonical_product_id, 0.97, "previous_approved", "Previous approved supplier description");
    } else {
      const supplierSimilarity = tokenScore(query, mapping.normalized_description || "");
      if (supplierSimilarity >= 0.65) {
        offer(
          mapping.canonical_product_id,
          0.78 + supplierSimilarity * 0.14,
          "previous_approved",
          "Similar product previously approved for this supplier",
        );
      }
    }
  }

  // 2. Alias index: exact, compact, plural/singular, edit distance, phonetic, tokens.
  for (const alias of aliases) {
    const normalizedAlias = alias.normalized_alias || normalize(alias.alias);
    const aliasCompact = alias.compact_alias || compact(alias.alias);
    if (query === normalizedAlias) {
      offer(alias.canonical_product_id, 0.97, "alias_exact", "Exact alias match", alias.alias);
      continue;
    }
    if (queryCompact === aliasCompact || querySingular === singular(normalizedAlias)) {
      offer(alias.canonical_product_id, 0.95, "alias_exact", "Spacing/plural alias match", alias.alias);
      continue;
    }
    const maxLen = Math.max(queryCompact.length, aliasCompact.length, 1);
    const editSimilarity = 1 - levenshtein(queryCompact, aliasCompact) / maxLen;
    const tokens = tokenScore(query, normalizedAlias);
    const phonetic = queryPhonetic && queryPhonetic === (alias.phonetic_key || soundex(alias.alias));
    let score = Math.max(editSimilarity * 0.88, tokens * 0.86, phonetic ? 0.72 : 0);
    if (normalizedAlias.startsWith(query) || query.startsWith(normalizedAlias)) score = Math.max(score, 0.84);
    if (score >= 0.52) {
      offer(
        alias.canonical_product_id,
        score,
        "alias_fuzzy",
        phonetic ? "Phonetic alias match" : tokens >= editSimilarity ? "Alias token match" : "Typographical alias match",
        alias.alias,
      );
    }
  }

  // 3. Canonical product / dictionary index.
  for (const product of products) {
    const name = product.normalized_name;
    if (query === name || queryCompact === compact(name)) {
      offer(product.id, 0.96, "product_dictionary", "Exact canonical product match");
      continue;
    }
    const token = tokenScore(query, name);
    const edit = 1 - levenshtein(queryCompact, compact(name)) / Math.max(queryCompact.length, compact(name).length, 1);
    let score = Math.max(token * 0.82, edit * 0.82);
    if (name.startsWith(query) || query.startsWith(name)) score = Math.max(score, 0.82);
    if (opts?.brand && query.includes(normalize(opts.brand))) score += 0.03;
    if (score >= 0.45) {
      offer(product.id, score, token >= edit ? "token_match" : "product_dictionary", "Canonical product similarity");
    }
  }

  const suggestions = [...scores.entries()]
    .map(([id, match]) => {
      const row = byId.get(id)!;
      const historyBoost = Math.min(0.06, (supplierStats.get(id)?.imports || 0) * 0.002);
      return candidateFrom(
        row,
        match.score + historyBoost,
        match.source,
        match.reasons,
        match.alias,
        supplierStats.get(id),
      );
    })
    .sort((a, b) => b.confidence - a.confidence || b.previousImports - a.previousImports)
    .slice(0, limit);

  const selected = suggestions[0] || null;
  const confidence = selected?.confidence || 0;
  const status: ProductResolution["status"] =
    confidence >= 0.9 ? "identified" : confidence >= 0.5 ? "needs_confirmation" : "unresolved";
  const missingInformation: string[] = [];
  if (!selected) missingInformation.push("Canonical product identity");
  if (selected && !selected.typicalMaterials.length) missingInformation.push("Material or composition");
  if (selected && !selected.commonUses.length) missingInformation.push("Primary use");

  return {
    originalDescription: description,
    normalizedQuery: query,
    status,
    confidence,
    selected: status === "identified" ? selected : null,
    suggestions,
    missingInformation,
    resolverPath: [
      "parse_description",
      "alias_resolver",
      ...(supplier ? ["supplier_history"] : []),
      "previous_approved_products",
      "product_dictionary",
      "brand_recognition",
      "product_attribute_library",
      ...(status === "identified" ? ["product_profile"] : ["clerk_confirmation"]),
    ],
  };
}

resolver.post("/resolve", async (c) => {
  const body = await c.req.json<{
    description?: string;
    supplier?: string | null;
    sku?: string | null;
    brand?: string | null;
    limit?: number;
  }>();
  if (!body.description?.trim()) return c.json({ error: "Description required" }, 400);
  const result = await resolveProduct(c.env.DB, body.description, body);
  await c.env.DB.prepare(
    `INSERT INTO product_resolver_events
      (event_type, original_description, normalized_query, supplier_name, canonical_product_id,
       selected_name, confidence, source, clerk_username)
     VALUES ('suggestions_generated', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.description,
      result.normalizedQuery,
      body.supplier || null,
      result.selected?.canonicalProductId || result.suggestions[0]?.canonicalProductId || null,
      result.selected?.canonicalName || result.suggestions[0]?.canonicalName || null,
      result.confidence,
      result.selected?.source || result.suggestions[0]?.source || null,
      c.var.username,
    )
    .run();
  return c.json({ success: true, resolution: result });
});

resolver.post("/resolve/batch", async (c) => {
  const body = await c.req.json<{
    supplier?: string | null;
    items?: Array<{ lineId: number; description: string; sku?: string | null; brand?: string | null }>;
  }>();
  const items = (body.items || []).slice(0, 100);
  const results: Array<{ lineId: number; resolution: ProductResolution }> = [];
  // Bounded sequential resolution keeps D1 reads predictable and shares no AI calls.
  for (const item of items) {
    results.push({
      lineId: item.lineId,
      resolution: await resolveProduct(c.env.DB, item.description, {
        supplier: body.supplier,
        sku: item.sku,
        brand: item.brand,
      }),
    });
  }
  return c.json({ success: true, results });
});

resolver.get("/search", async (c) => {
  const query = c.req.query("q") || "";
  if (query.trim().length < 1) return c.json({ success: true, results: [] });
  const result = await resolveProduct(c.env.DB, query, {
    supplier: c.req.query("supplier"),
    brand: c.req.query("brand"),
    limit: Number(c.req.query("limit") || 12),
  });
  return c.json({ success: true, results: result.suggestions });
});

resolver.post("/confirm", async (c) => {
  const body = await c.req.json<{
    canonicalProductId?: number;
    previousProductId?: number | null;
    canonicalName?: string;
    originalDescription?: string;
    supplier?: string | null;
    sku?: string | null;
    brand?: string | null;
    productFamily?: string | null;
    industryCode?: string | null;
    typicalMaterials?: string[];
    typicalChapters?: string[];
    commonUses?: string[];
    typicalAttributes?: string[];
    approvedTariff?: string | null;
    classificationApproval?: boolean;
    answers?: Array<{ field: string; value: string }>;
  }>();
  if (!body.originalDescription?.trim()) return c.json({ error: "Original description required" }, 400);

  let productId = body.canonicalProductId || null;
  if (!productId) {
    if (!body.canonicalName?.trim()) return c.json({ error: "Canonical product required" }, 400);
    const normalizedName = normalize(body.canonicalName);
    await c.env.DB.prepare(
      `INSERT INTO canonical_products
        (canonical_name, normalized_name, industry_code, product_family, typical_materials_json,
         typical_chapters_json, common_uses_json, typical_attributes_json, approved_tariff, approval_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(normalized_name) DO UPDATE SET
         approval_count = approval_count + 1,
         approved_tariff = COALESCE(excluded.approved_tariff, approved_tariff),
         updated_at = datetime('now')`,
    )
      .bind(
        body.canonicalName.trim(),
        normalizedName,
        body.industryCode || null,
        body.productFamily || null,
        JSON.stringify(body.typicalMaterials || []),
        JSON.stringify(body.typicalChapters || []),
        JSON.stringify(body.commonUses || []),
        JSON.stringify(body.typicalAttributes || []),
        body.approvedTariff || null,
      )
      .run();
    productId = (
      await c.env.DB.prepare(`SELECT id FROM canonical_products WHERE normalized_name = ?`)
        .bind(normalizedName)
        .first<{ id: number }>()
    )?.id || null;
  } else {
    if (body.classificationApproval) {
      await c.env.DB.prepare(
        `UPDATE canonical_products SET
           import_count = import_count + 1,
           approved_tariff = COALESCE(?, approved_tariff),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(body.approvedTariff || null, productId)
        .run();
    } else {
      await c.env.DB.prepare(
        `UPDATE canonical_products SET
           approval_count = approval_count + 1,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(productId)
        .run();
    }
  }
  if (!productId) return c.json({ error: "Could not save canonical product" }, 500);

  if (body.previousProductId && body.previousProductId !== productId) {
    await c.env.DB.prepare(
      `UPDATE canonical_products
       SET correction_count = correction_count + 1, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(body.previousProductId)
      .run();
  }

  const alias = body.originalDescription.trim();
  const normalizedAlias = normalize(alias);
  await c.env.DB.prepare(
    `INSERT INTO product_aliases
      (canonical_product_id, alias, normalized_alias, compact_alias, phonetic_key, source, supplier_name, approved, usage_count)
     VALUES (?, ?, ?, ?, ?, 'clerk_approved', ?, 1, 1)
     ON CONFLICT(normalized_alias) DO UPDATE SET
       canonical_product_id = excluded.canonical_product_id,
       usage_count = usage_count + 1,
       source = 'clerk_approved',
       approved = 1,
       updated_at = datetime('now')`,
  )
    .bind(productId, alias, normalizedAlias, compact(alias), soundex(alias), body.supplier || null)
    .run();

  if (body.supplier) {
    const normalizedSupplier = supplierKey(body.supplier);
    const normalizedSku = skuKey(body.sku);
    const existing = await c.env.DB.prepare(
      `SELECT id FROM supplier_product_mappings
       WHERE canonical_product_id = ? AND normalized_supplier = ?
         AND COALESCE(normalized_sku, '') = ? LIMIT 1`,
    )
      .bind(productId, normalizedSupplier, normalizedSku)
      .first<{ id: number }>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE supplier_product_mappings SET
           import_count = import_count + ?,
           approval_count = approval_count + ?,
           supplier_description = ?,
           normalized_description = ?,
           approved_tariff = COALESCE(?, approved_tariff),
           brand = COALESCE(?, brand),
           last_imported_at = datetime('now'),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(
          body.classificationApproval ? 1 : 0,
          body.classificationApproval ? 1 : 0,
          alias,
          normalizedAlias,
          body.approvedTariff || null,
          body.brand || null,
          existing.id,
        )
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO supplier_product_mappings
          (canonical_product_id, supplier_name, normalized_supplier, supplier_sku, normalized_sku,
           supplier_description, normalized_description, brand, approved_tariff, approved,
           approval_count, import_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          productId,
          body.supplier,
          normalizedSupplier,
          body.sku || null,
          normalizedSku || null,
          alias,
          normalizedAlias,
          body.brand || null,
          body.approvedTariff || null,
          body.classificationApproval ? 1 : 0,
          body.classificationApproval ? 1 : 0,
        )
        .run();
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO product_resolver_events
      (event_type, original_description, normalized_query, supplier_name, canonical_product_id,
       selected_name, confidence, source, metadata_json, clerk_username)
     VALUES ('product_confirmed', ?, ?, ?, ?, ?, 1, 'manual', ?, ?)`,
  )
    .bind(
      alias,
      normalizedAlias,
      body.supplier || null,
      productId,
      body.canonicalName || null,
      JSON.stringify({ answers: body.answers || [], approvedTariff: body.approvedTariff || null }),
      c.var.username,
    )
    .run();

  await audit(c, "product_resolver_confirm");
  return c.json({ success: true, canonicalProductId: productId, aliasAdded: alias });
});

resolver.post("/events", async (c) => {
  const body = await c.req.json<{
    eventType?: string;
    originalDescription?: string;
    canonicalProductId?: number | null;
    selectedName?: string | null;
    confidence?: number | null;
    source?: string | null;
    metadata?: Record<string, unknown>;
  }>();
  if (!body.eventType) return c.json({ error: "eventType required" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO product_resolver_events
      (event_type, original_description, normalized_query, canonical_product_id,
       selected_name, confidence, source, metadata_json, clerk_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.eventType,
      body.originalDescription || null,
      normalize(body.originalDescription || ""),
      body.canonicalProductId || null,
      body.selectedName || null,
      body.confidence ?? null,
      body.source || null,
      JSON.stringify(body.metadata || {}),
      c.var.username,
    )
    .run();
  return c.json({ success: true });
});

resolver.get("/analytics", async (c) => {
  const [topProducts, corrected, unknown, aliases, supplierGrowth, learnedToday] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, canonical_name, import_count, approval_count
       FROM canonical_products WHERE status = 'active'
       ORDER BY import_count DESC, approval_count DESC LIMIT 10`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, canonical_name, correction_count
       FROM canonical_products WHERE correction_count > 0
       ORDER BY correction_count DESC LIMIT 10`,
    ).all(),
    c.env.DB.prepare(
      `SELECT normalized_query AS name, COUNT(*) AS count
       FROM product_resolver_events
       WHERE event_type = 'suggestions_generated' AND confidence < 0.5
       GROUP BY normalized_query ORDER BY count DESC LIMIT 10`,
    ).all(),
    c.env.DB.prepare(
      `SELECT alias, usage_count FROM product_aliases ORDER BY usage_count DESC LIMIT 10`,
    ).all(),
    c.env.DB.prepare(
      `SELECT supplier_name, COUNT(DISTINCT canonical_product_id) AS products, SUM(import_count) AS imports
       FROM supplier_product_mappings GROUP BY normalized_supplier
       ORDER BY products DESC LIMIT 10`,
    ).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM canonical_products WHERE date(created_at) = date('now')`,
    ).first<{ count: number }>(),
  ]);
  return c.json({
    success: true,
    topProducts: topProducts.results || [],
    mostCorrected: corrected.results || [],
    unknownProducts: unknown.results || [],
    commonAliases: aliases.results || [],
    supplierCatalogueGrowth: supplierGrowth.results || [],
    productsLearnedToday: learnedToday?.count || 0,
  });
});

export default resolver;
