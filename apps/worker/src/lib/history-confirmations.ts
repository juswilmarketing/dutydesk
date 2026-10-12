/** Remembered codes count as approved only after the same code is hand-applied twice. */

function key(code: string): string {
  return code.replace(/[\s.]/g, "").toUpperCase();
}

/** `learned.uses` after a hand-apply: +1 for the same code, reset to 1 for a different or new code. */
export function nextUses(existing: { tariff_code: string; uses: number | null } | null, code: string): number {
  if (!existing || key(existing.tariff_code) !== key(code)) return 1;
  return (existing.uses || 0) + 1;
}

/** `supplier_classification_history.usage_count` after a hand-apply: +1 for the same code, reset to 1 when it changes. */
export function nextSupplierUsageCount(
  existing: { hs_code: string; usage_count: number | null },
  code: string,
): number {
  if (key(existing.hs_code) !== key(code)) return 1;
  return (existing.usage_count || 0) + 1;
}
