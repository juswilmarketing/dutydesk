import type { D1Database } from "@cloudflare/workers-types";
import { normalizeDesc, normalizeSupplierName } from "@pas/tariff-data";

export type HistoryDb = Pick<D1Database, "prepare">;

export interface HistoryHit {
  code: string;
  source: "supplier_history" | "learned";
}

/** Clerk-approved code for this exact supplier + description, then for the description alone. */
export async function findHistoryCode(
  db: HistoryDb,
  supplier: string,
  description: string,
): Promise<HistoryHit | null> {
  const desc = normalizeDesc(description);
  if (!desc) return null;

  const supplierKey = supplier.trim() ? normalizeSupplierName(supplier) : "";
  if (supplierKey) {
    const row = await db
      .prepare(
        `SELECT hs_code FROM supplier_classification_history
         WHERE normalized_supplier_name = ? AND normalized_description = ?
           AND approved_by_clerk = 1 AND disabled = 0
         ORDER BY usage_count DESC, updated_at DESC LIMIT 1`,
      )
      .bind(supplierKey, desc)
      .first<{ hs_code: string }>();
    if (row?.hs_code) return { code: row.hs_code, source: "supplier_history" };
  }

  const learned = await db
    .prepare("SELECT tariff_code FROM learned WHERE normalized_desc = ? LIMIT 1")
    .bind(desc)
    .first<{ tariff_code: string }>();
  if (learned?.tariff_code) return { code: learned.tariff_code, source: "learned" };
  return null;
}
