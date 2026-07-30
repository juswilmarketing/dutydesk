import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { normalizeDesc } from "@pas/tariff-data";
import { normalizeSupplierName } from "@pas/tariff-data";
import { audit } from "../lib/utils";

const supplierHistory = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type Row = {
  id: number;
  supplier_name: string;
  normalized_supplier_name: string;
  item_description: string;
  normalized_description: string;
  part_number: string | null;
  model_number: string | null;
  brand: string | null;
  hs_code: string;
  tariff_description: string | null;
  duty_rate: string;
  vat_rate: string;
  confidence: number;
  match_type: string;
  approved_by_clerk: number;
  source_job_id: string | null;
  usage_count: number;
  disabled: number;
  last_used_at: string;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row) {
  return {
    id: r.id,
    supplier_name: r.supplier_name,
    normalized_supplier_name: r.normalized_supplier_name,
    item_description: r.item_description,
    normalized_description: r.normalized_description,
    part_number: r.part_number || undefined,
    model_number: r.model_number || undefined,
    brand: r.brand || undefined,
    hs_code: r.hs_code,
    tariff_description: r.tariff_description || undefined,
    duty_rate: r.duty_rate,
    vat_rate: r.vat_rate,
    confidence: r.confidence,
    match_type: r.match_type,
    approved_by_clerk: r.approved_by_clerk === 1,
    source_job_id: r.source_job_id || undefined,
    usage_count: r.usage_count,
    disabled: r.disabled === 1,
    last_used_at: r.last_used_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** List supplier classification history (optional ?q= search, ?supplier= filter). */
supplierHistory.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const supplier = (c.req.query("supplier") ?? "").trim();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "500", 10) || 500, 2000);

  let sql = "SELECT * FROM supplier_classification_history WHERE disabled = 0";
  const binds: string[] = [];

  if (supplier) {
    sql += " AND normalized_supplier_name = ?";
    binds.push(normalizeSupplierName(supplier));
  }
  if (q) {
    sql += " AND (normalized_supplier_name LIKE ? OR normalized_description LIKE ? OR hs_code LIKE ?)";
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  sql += " ORDER BY usage_count DESC, last_used_at DESC LIMIT ?";
  binds.push(String(limit));

  const stmt = c.env.DB.prepare(sql);
  const rows = await (binds.length ? stmt.bind(...binds) : stmt).all<Row>();
  return c.json({ entries: (rows.results ?? []).map(mapRow) });
});

/** Save or update a supplier classification (learning loop). */
supplierHistory.post("/", async (c) => {
  const body = await c.req.json<{
    supplier_name: string;
    item_description: string;
    hs_code: string;
    duty_rate: string;
    tariff_description?: string;
    part_number?: string;
    model_number?: string;
    brand?: string;
    vat_rate?: string;
    match_type?: string;
    source_job_id?: string;
    approved_by_clerk?: boolean;
    confidence?: number;
  }>();

  const supplierName = body.supplier_name?.trim();
  const itemDesc = body.item_description?.trim();
  const hsCode = body.hs_code?.trim();
  if (!supplierName || !itemDesc || !hsCode) {
    return c.json({ error: "supplier_name, item_description, and hs_code are required" }, 400);
  }

  const now = new Date().toISOString();
  const normSupplier = normalizeSupplierName(supplierName);
  const normDesc = normalizeDesc(itemDesc);
  const partNum = body.part_number?.trim() || "";
  const modelNum = body.model_number?.trim() || "";
  const clerk = c.get("username") || "clerk";

  const existing = await c.env.DB.prepare(
    `SELECT id, usage_count FROM supplier_classification_history
     WHERE normalized_supplier_name = ? AND normalized_description = ?
       AND COALESCE(part_number, '') = ? AND COALESCE(model_number, '') = ?`,
  )
    .bind(normSupplier, normDesc, partNum, modelNum)
    .first<{ id: number; usage_count: number }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE supplier_classification_history SET
        supplier_name = ?, item_description = ?, hs_code = ?, duty_rate = ?,
        tariff_description = ?, brand = ?, vat_rate = ?, confidence = ?,
        match_type = ?, approved_by_clerk = 1, source_job_id = ?,
        usage_count = ?, last_used_at = ?, updated_at = ?, disabled = 0
       WHERE id = ?`,
    )
      .bind(
        supplierName,
        itemDesc,
        hsCode,
        body.duty_rate || "Free",
        body.tariff_description || null,
        body.brand || null,
        body.vat_rate || "12.5%",
        body.confidence ?? 1,
        body.match_type || "supplier_exact",
        body.source_job_id || null,
        existing.usage_count + 1,
        now,
        now,
        existing.id,
      )
      .run();
    await audit(c, "supplier_history_update");
    return c.json({ ok: true, id: existing.id, updated: true });
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO supplier_classification_history (
      supplier_name, normalized_supplier_name, item_description, normalized_description,
      part_number, model_number, brand, hs_code, tariff_description, duty_rate, vat_rate,
      confidence, match_type, approved_by_clerk, source_job_id, usage_count,
      disabled, last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?, ?)`,
  )
    .bind(
      supplierName,
      normSupplier,
      itemDesc,
      normDesc,
      partNum || null,
      modelNum || null,
      body.brand || null,
      hsCode,
      body.tariff_description || null,
      body.duty_rate || "Free",
      body.vat_rate || "12.5%",
      body.confidence ?? 1,
      body.match_type || "supplier_exact",
      body.source_job_id || null,
      now,
      now,
      now,
    )
    .run();

  await audit(c, "supplier_history_create");
  return c.json({ ok: true, id: result.meta.last_row_id, created: true });
});

/** Update HS code or disable an entry. */
supplierHistory.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);
  const body = await c.req.json<{ hs_code?: string; duty_rate?: string; disabled?: boolean }>();
  const now = new Date().toISOString();

  const sets: string[] = ["updated_at = ?"];
  const binds: (string | number)[] = [now];

  if (body.hs_code) {
    sets.push("hs_code = ?");
    binds.push(body.hs_code.trim());
  }
  if (body.duty_rate) {
    sets.push("duty_rate = ?");
    binds.push(body.duty_rate);
  }
  if (typeof body.disabled === "boolean") {
    sets.push("disabled = ?");
    binds.push(body.disabled ? 1 : 0);
  }
  binds.push(id);

  await c.env.DB.prepare(`UPDATE supplier_classification_history SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  await audit(c, "supplier_history_edit");
  return c.json({ ok: true });
});

/** Merge duplicate suppliers: reassign all rows from `from` to `to`. */
supplierHistory.post("/merge", async (c) => {
  const body = await c.req.json<{ from_supplier: string; to_supplier: string }>();
  const fromNorm = normalizeSupplierName(body.from_supplier || "");
  const toNorm = normalizeSupplierName(body.to_supplier || "");
  const toName = body.to_supplier?.trim();
  if (!fromNorm || !toNorm || fromNorm === toNorm) {
    return c.json({ error: "Valid from_supplier and to_supplier required" }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE supplier_classification_history SET
      supplier_name = ?, normalized_supplier_name = ?, updated_at = ?
     WHERE normalized_supplier_name = ?`,
  )
    .bind(toName, toNorm, now, fromNorm)
    .run();
  await audit(c, "supplier_merge");
  return c.json({ ok: true });
});

/** Export all supplier history as JSON. */
supplierHistory.get("/export", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM supplier_classification_history WHERE disabled = 0 ORDER BY normalized_supplier_name, usage_count DESC",
  ).all<Row>();
  return c.json({ entries: (rows.results ?? []).map(mapRow), exported_at: new Date().toISOString() });
});

export default supplierHistory;
