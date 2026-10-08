/**
 * Supplier Product Search — internal cache → catalogue → optional external lookup.
 * Resolves product identity only; tariff codes still come from the DB + clerk approval.
 */

import { Hono } from "hono";
import {
  buildSupplierSearchQueries,
  compactEvidenceForAi,
  evidenceFromInternalMatch,
  extractProductEvidenceFromText,
  getSupplierProfile,
  needsSupplierSearch,
  normalizeSupplierKey,
  type StructuredProductEvidence,
  SUPPLIER_SEARCH_LIMITS,
} from "@pas/product-intelligence";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";

const routes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function normalizeSku(sku: string | null | undefined): string {
  return String(sku || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeDesc(desc: string): string {
  return String(desc || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function lookupCache(
  db: D1Database,
  supplier: string,
  sku: string | null,
  description: string,
): Promise<StructuredProductEvidence | null> {
  const ns = normalizeSupplierKey(supplier).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const nsku = normalizeSku(sku);
  if (nsku) {
    const row = await db
      .prepare(
        `SELECT * FROM supplier_product_evidence_cache
         WHERE normalized_supplier = ? AND normalized_sku = ? AND approved = 1
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(ns, nsku)
      .first<{
        supplier_name: string;
        supplier_sku: string | null;
        canonical_product: string;
        material: string | null;
        primary_function: string | null;
        intended_use: string | null;
        technical_specifications_json: string;
        empty_or_filled: string | null;
        approved_tariff: string | null;
        source_url: string | null;
        source_type: string;
        evidence_confidence: number;
        excerpt: string | null;
      }>();
    if (row) {
      return evidenceFromInternalMatch({
        supplier: row.supplier_name,
        sku: row.supplier_sku,
        canonicalProduct: row.canonical_product,
        material: row.material,
        primaryFunction: row.primary_function,
        intendedUse: row.intended_use,
        approvedTariff: row.approved_tariff,
        sourceType: "supplier_sku_history",
        confidence: row.evidence_confidence,
        technicalSpecifications: {
          ...(JSON.parse(row.technical_specifications_json || "{}") as Record<string, string | number | boolean | null>),
          containerState: row.empty_or_filled || "empty",
        },
      });
    }
  }

  const nd = normalizeDesc(description);
  if (nd) {
    const row = await db
      .prepare(
        `SELECT * FROM supplier_product_evidence_cache
         WHERE normalized_supplier = ? AND normalized_description = ? AND approved = 1
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(ns, nd)
      .first<{
        supplier_name: string;
        supplier_sku: string | null;
        canonical_product: string;
        material: string | null;
        primary_function: string | null;
        intended_use: string | null;
        technical_specifications_json: string;
        empty_or_filled: string | null;
        approved_tariff: string | null;
        evidence_confidence: number;
      }>();
    if (row) {
      return evidenceFromInternalMatch({
        supplier: row.supplier_name,
        sku: row.supplier_sku,
        canonicalProduct: row.canonical_product,
        material: row.material,
        primaryFunction: row.primary_function,
        intendedUse: row.intended_use,
        approvedTariff: row.approved_tariff,
        sourceType: "previous_invoice",
        confidence: row.evidence_confidence,
        technicalSpecifications: JSON.parse(row.technical_specifications_json || "{}"),
      });
    }
  }
  return null;
}

async function lookupSupplierProducts(
  db: D1Database,
  supplier: string,
  sku: string | null,
): Promise<StructuredProductEvidence | null> {
  const ns = normalizeSupplierKey(supplier).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const nsku = normalizeSku(sku);
  if (!nsku) return null;
  const row = await db
    .prepare(
      `SELECT supplier_name, supplier_sku, product_code, canonical_product_name, material,
              primary_function, product_family, approved_tariff, approval_count
       FROM supplier_products
       WHERE normalized_supplier LIKE ? AND (normalized_sku = ? OR normalized_product_code = ?)
         AND approved = 1
       ORDER BY approval_count DESC LIMIT 1`,
    )
    .bind(`%${ns.split(" ").slice(0, 2).join("%")}%`, nsku, nsku)
    .first<{
      supplier_name: string;
      supplier_sku: string | null;
      product_code: string | null;
      canonical_product_name: string;
      material: string | null;
      primary_function: string | null;
      product_family: string | null;
      approved_tariff: string | null;
    }>();
  if (!row) return null;
  return evidenceFromInternalMatch({
    supplier: row.supplier_name,
    sku: row.supplier_sku || row.product_code,
    canonicalProduct: row.canonical_product_name,
    material: row.material,
    primaryFunction: row.primary_function,
    intendedUse: row.product_family || "packaging",
    approvedTariff: row.approved_tariff,
    sourceType: "supplier_sku_history",
    confidence: 0.97,
  });
}

async function lookupCatalogue(
  db: D1Database,
  supplier: string,
  sku: string | null,
  description: string,
): Promise<StructuredProductEvidence | null> {
  const nsku = normalizeSku(sku);
  const ns = normalizeSupplierKey(supplier);
  if (nsku) {
    const row = await db
      .prepare(
        `SELECT supplier_name, supplier_sku, product_name, full_description, material,
                function_use, product_type, approved_hs_code
         FROM supplier_product_catalogue
         WHERE status = 'active'
           AND (normalized_sku = ? OR LOWER(REPLACE(supplier_sku, '-', '')) = ?)
         LIMIT 1`,
      )
      .bind(nsku, nsku)
      .first<{
        supplier_name: string;
        supplier_sku: string | null;
        product_name: string | null;
        full_description: string | null;
        material: string | null;
        function_use: string | null;
        product_type: string | null;
        approved_hs_code: string | null;
      }>();
    if (row && (!ns || normalizeSupplierKey(row.supplier_name).includes(ns.split(" ")[0] || ""))) {
      return evidenceFromInternalMatch({
        supplier: row.supplier_name,
        sku: row.supplier_sku,
        canonicalProduct: row.product_name || row.full_description || description,
        material: row.material,
        primaryFunction: row.function_use || "packaging",
        intendedUse: row.product_type || "packaging",
        approvedTariff: row.approved_hs_code,
        sourceType: "supplier_catalogue",
        confidence: 0.9,
      });
    }
  }
  return null;
}

async function externalLookup(
  env: Env,
  queries: string[],
  supplier: string,
  sku: string | null,
): Promise<StructuredProductEvidence | null> {
  if (!env.PRODUCT_LOOKUP_URL) return null;
  let pages = 0;
  for (const query of queries) {
    if (pages >= SUPPLIER_SEARCH_LIMITS.maxPagesFetched) break;
    pages += 1;
    try {
      const response = await fetch(env.PRODUCT_LOOKUP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.PRODUCT_LOOKUP_TOKEN
            ? { Authorization: `Bearer ${env.PRODUCT_LOOKUP_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({ query, limit: 2, preferOfficial: true }),
      });
      if (!response.ok) continue;
      const payload = await response.json<{
        results?: Array<{
          title?: string;
          source?: string;
          url?: string;
          description?: string;
          material?: string;
          use?: string;
        }>;
      }>();
      for (const result of (payload.results || []).slice(0, 2)) {
        const blob = [result.title, result.description, result.material, result.use]
          .filter(Boolean)
          .join(". ")
          .slice(0, SUPPLIER_SEARCH_LIMITS.maxEvidenceCharsPerSource);
        const evidence = extractProductEvidenceFromText({
          supplier,
          sku,
          text: blob,
          sourceUrl: result.url || result.source || "",
          sourceType: /manufacturer/i.test(String(result.source || ""))
            ? "manufacturer_official"
            : "supplier_official",
        });
        if (evidence) return evidence;
      }
    } catch {
      // ignore provider errors — provisional classification remains
    }
  }
  return null;
}

export type SupplierSearchResponse = {
  status: "exact_internal" | "catalogue" | "external" | "not_found" | "skipped";
  searched: boolean;
  skippedReason?: string;
  queries: string[];
  evidence: StructuredProductEvidence | null;
  aiContext: string;
  supplierProfile: ReturnType<typeof getSupplierProfile>;
  notification?: string;
};

export async function runSupplierProductSearch(
  env: Env,
  input: {
    supplier: string;
    sku?: string | null;
    description: string;
    forceSearch?: boolean;
    profileConfidence?: number;
    productNoun?: string;
    material?: string;
    allowExternal?: boolean;
  },
): Promise<SupplierSearchResponse> {
  const supplier = String(input.supplier || "").trim();
  const sku = input.sku || null;
  const description = String(input.description || "").trim();
  const profile = getSupplierProfile(supplier);
  const queries = buildSupplierSearchQueries({
    supplier,
    sku,
    description,
    domain: profile?.officialDomain,
  });

  const cached = supplier
    ? await lookupCache(env.DB, supplier, sku, description)
    : null;
  if (cached) {
    return {
      status: "exact_internal",
      searched: false,
      skippedReason: "Approved supplier/SKU cache hit",
      queries: [],
      evidence: cached,
      aiContext: compactEvidenceForAi(cached),
      supplierProfile: profile,
      notification: `Supplier information found: this item appears to be ${cached.canonicalProduct}.`,
    };
  }

  const fromProducts = supplier ? await lookupSupplierProducts(env.DB, supplier, sku) : null;
  if (fromProducts) {
    return {
      status: "exact_internal",
      searched: false,
      skippedReason: "Approved supplier product match",
      queries: [],
      evidence: fromProducts,
      aiContext: compactEvidenceForAi(fromProducts),
      supplierProfile: profile,
      notification: `Supplier information found: this item appears to be ${fromProducts.canonicalProduct}.`,
    };
  }

  const catalogue = supplier ? await lookupCatalogue(env.DB, supplier, sku, description) : null;
  if (catalogue) {
    return {
      status: "catalogue",
      searched: false,
      skippedReason: "Supplier catalogue match",
      queries: [],
      evidence: catalogue,
      aiContext: compactEvidenceForAi(catalogue),
      supplierProfile: profile,
      notification: `Supplier catalogue match: ${catalogue.canonicalProduct}.`,
    };
  }

  const should = needsSupplierSearch({
    description,
    sku,
    hasExactSkuMatch: false,
    hasProductMaster: false,
    hasCatalogueMatch: false,
    profileConfidence: input.profileConfidence,
    productNoun: input.productNoun,
    material: input.material,
    forceSearch: input.forceSearch,
  });

  if (!should) {
    return {
      status: "skipped",
      searched: false,
      skippedReason: "Description already clear or resolved internally",
      queries: [],
      evidence: null,
      aiContext: "",
      supplierProfile: profile,
    };
  }

  if (!input.allowExternal && !input.forceSearch) {
    return {
      status: "not_found",
      searched: false,
      skippedReason: "External search deferred (async / clerk-triggered)",
      queries,
      evidence: null,
      aiContext: "",
      supplierProfile: profile,
    };
  }

  const external = await externalLookup(env, queries, supplier, sku);
  if (external) {
    // Cache unapproved external hit for reuse (clerk must approve)
    const ns = normalizeSupplierKey(supplier).replace(/\./g, " ").replace(/\s+/g, " ").trim();
    await env.DB.prepare(
      `INSERT INTO supplier_product_evidence_cache
        (supplier_name, normalized_supplier, supplier_sku, normalized_sku, raw_description,
         normalized_description, canonical_product, material, primary_function, intended_use,
         technical_specifications_json, empty_or_filled, source_url, source_type,
         evidence_confidence, excerpt, approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        supplier,
        ns,
        sku,
        normalizeSku(sku),
        description,
        normalizeDesc(description),
        external.canonicalProduct,
        external.material,
        external.primaryFunction,
        external.intendedUse,
        JSON.stringify(external.technicalSpecifications),
        external.emptyOrFilled || null,
        external.sourceUrl,
        external.sourceType,
        external.evidenceConfidence,
        external.excerpt,
      )
      .run()
      .catch(() => undefined);

    return {
      status: "external",
      searched: true,
      queries,
      evidence: external,
      aiContext: compactEvidenceForAi(external),
      supplierProfile: profile,
      notification: `Supplier information found: this item appears to be ${external.canonicalProduct}.`,
    };
  }

  return {
    status: "not_found",
    searched: true,
    queries,
    evidence: null,
    aiContext: "",
    supplierProfile: profile,
  };
}

routes.post("/search", async (c) => {
  const body = await c.req.json<{
    supplier?: string;
    sku?: string;
    description: string;
    forceSearch?: boolean;
    allowExternal?: boolean;
    profileConfidence?: number;
    productNoun?: string;
    material?: string;
  }>();
  if (!body.description?.trim()) {
    return c.json({ error: "description required" }, 400);
  }
  const result = await runSupplierProductSearch(c.env, {
    supplier: body.supplier || "",
    sku: body.sku,
    description: body.description,
    forceSearch: body.forceSearch,
    allowExternal: body.allowExternal ?? body.forceSearch ?? false,
    profileConfidence: body.profileConfidence,
    productNoun: body.productNoun,
    material: body.material,
  });
  await audit(c, "supplier_product_search");
  return c.json(result);
});

routes.post("/approve", async (c) => {
  const body = await c.req.json<{
    supplier: string;
    sku?: string;
    rawDescription: string;
    canonicalProduct: string;
    material?: string;
    primaryFunction?: string;
    intendedUse?: string;
    technicalSpecifications?: Record<string, string | number | boolean | null>;
    approvedTariff?: string;
    sourceUrl?: string;
    sourceType?: string;
    emptyOrFilled?: string;
    excerpt?: string;
  }>();
  const ns = normalizeSupplierKey(body.supplier).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const nsku = normalizeSku(body.sku);
  const existing = nsku
    ? await c.env.DB.prepare(
        `SELECT id FROM supplier_product_evidence_cache
         WHERE normalized_supplier = ? AND normalized_sku = ? LIMIT 1`,
      )
      .bind(ns, nsku)
      .first<{ id: number }>()
    : null;

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE supplier_product_evidence_cache SET
         raw_description = ?, normalized_description = ?, canonical_product = ?,
         material = ?, primary_function = ?, intended_use = ?,
         technical_specifications_json = ?, empty_or_filled = ?, approved_tariff = ?,
         source_url = ?, source_type = ?, excerpt = ?, clerk_username = ?,
         approved = 1, approved_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(
        body.rawDescription,
        normalizeDesc(body.rawDescription),
        body.canonicalProduct,
        body.material || null,
        body.primaryFunction || null,
        body.intendedUse || null,
        JSON.stringify(body.technicalSpecifications || {}),
        body.emptyOrFilled || null,
        body.approvedTariff || null,
        body.sourceUrl || null,
        body.sourceType || "pas_record",
        (body.excerpt || body.canonicalProduct).slice(0, 800),
        c.var.username,
        existing.id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO supplier_product_evidence_cache
        (supplier_name, normalized_supplier, supplier_sku, normalized_sku, raw_description,
         normalized_description, canonical_product, material, primary_function, intended_use,
         technical_specifications_json, empty_or_filled, approved_tariff, source_url, source_type,
         evidence_confidence, excerpt, clerk_username, approved, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, datetime('now'))`,
    )
      .bind(
        body.supplier,
        ns,
        body.sku || null,
        nsku || null,
        body.rawDescription,
        normalizeDesc(body.rawDescription),
        body.canonicalProduct,
        body.material || null,
        body.primaryFunction || null,
        body.intendedUse || null,
        JSON.stringify(body.technicalSpecifications || {}),
        body.emptyOrFilled || null,
        body.approvedTariff || null,
        body.sourceUrl || null,
        body.sourceType || "pas_record",
        (body.excerpt || body.canonicalProduct).slice(0, 800),
        c.var.username,
      )
      .run();
  }
  await audit(c, "supplier_product_evidence_approve");
  return c.json({ success: true });
});

export default routes;
