import { HISTORY_CONFIRMATIONS_REQUIRED } from "@pas/product-intelligence";

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

/** True when an admin edit swaps in a different code (spaces, dots and case ignored). */
export function historyCodeChanged(oldCode: string, newCode: string): boolean {
  return key(oldCode) !== key(newCode);
}

/** User-visible text for the history-first suggestion; "approved" only once confirmed. */
export function historyWording(confirmations: number): { reason: string; warning: string } {
  if (confirmations >= HISTORY_CONFIRMATIONS_REQUIRED) {
    return {
      reason: "Approved for this item before.",
      warning: "Suggested from approved history for this item.",
    };
  }
  return {
    reason: "Applied once before for this item — confirm.",
    warning: "Suggested from a code applied once before for this item.",
  };
}