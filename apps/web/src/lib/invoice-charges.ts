import type { Invoice, InvoiceCharge, InvoiceChargeKind, LineItem } from "@pas/shared-types";
import {
  detectInvoiceLineType,
  isNonMerchandiseLine,
  chargeKindFromLineType,
} from "@pas/product-intelligence";

export function createChargeId(): string {
  return `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyInvoiceMetaExtras() {
  return {
    documentGoodsTotal: "",
    documentGrandTotal: "",
    charges: [] as InvoiceCharge[],
    totalsMismatch: false,
    totalsReviewed: false,
  };
}

export function normalizeChargeKind(raw: string): InvoiceChargeKind {
  const k = raw.toLowerCase().replace(/\s+/g, "_");
  if (k === "freight" || k.includes("shipping") || k.includes("carriage") || k === "surcharge") return "freight";
  if (k === "insurance") return "insurance";
  if (k === "sales_tax" || k.includes("sales") || k === "vat" || k === "gst" || k === "hst" || k === "tax") return "sales_tax";
  return "other";
}

/** Descriptions that are invoice charges/fees — never classify as products. */
export function isNonProductInvoiceLine(description: string): boolean {
  return isNonMerchandiseLine(description);
}

export function chargeKindFromDescription(description: string): InvoiceChargeKind {
  const typed = detectInvoiceLineType(description);
  if (typed.chargeKind) return typed.chargeKind;
  const legacy = chargeKindFromLineType(description);
  if (legacy?.kind === "freight") return "freight";
  if (legacy?.kind === "insurance") return "insurance";
  if (legacy?.kind === "sales_tax") return "sales_tax";
  return "other";
}

export function chargeKindLabel(kind: InvoiceChargeKind): string {
  switch (kind) {
    case "freight":
      return "Freight";
    case "insurance":
      return "Insurance";
    case "sales_tax":
      return "Sales tax";
    default:
      return "Other charge";
  }
}

export function lineItemValue(it: Pick<LineItem, "qty" | "price" | "line_total">): number {
  if (it.line_total != null && it.line_total > 0) return it.line_total;
  return it.qty * (it.price || 0);
}

export function sumLineItems(inv: Invoice): number {
  return inv.items.reduce((s, it) => s + lineItemValue(it), 0);
}

export function parseChargeAmount(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : parseFloat(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function sumCharges(charges: InvoiceCharge[], kinds?: InvoiceChargeKind[]): number {
  return charges
    .filter((c) => !kinds || kinds.includes(c.kind))
    .filter((c) => c.includeInCif !== false)
    .reduce((s, c) => s + parseChargeAmount(c.amount), 0);
}

export function chargeAmountForKind(charges: InvoiceCharge[], kind: InvoiceChargeKind): number {
  const hit = charges.find((c) => c.kind === kind);
  return hit ? parseChargeAmount(hit.amount) : 0;
}

export function otherChargesTotal(charges: InvoiceCharge[]): number {
  return sumCharges(charges, ["sales_tax", "other"]);
}

export function chargesToTaxStrings(charges: InvoiceCharge[]) {
  return {
    freight: String(chargeAmountForKind(charges, "freight") || ""),
    insurance: String(chargeAmountForKind(charges, "insurance") || ""),
    otherCharges: String(otherChargesTotal(charges) || ""),
  };
}

export function upsertChargeKind(
  charges: InvoiceCharge[],
  kind: InvoiceChargeKind,
  amount: number,
  label?: string,
): InvoiceCharge[] {
  const next = charges.filter((c) => c.kind !== kind);
  if (amount > 0) {
    next.push({
      id: createChargeId(),
      kind,
      label: label || chargeKindLabel(kind),
      amount: String(amount),
      includeInCif: true,
    });
  }
  return next;
}

export function mergeChargesFromParsed(
  parsedCharges: Array<{ kind?: string; label?: string; amount?: number }> | undefined,
): InvoiceCharge[] {
  if (!parsedCharges?.length) return [];
  return parsedCharges
    .filter((c) => parseChargeAmount(c.amount) > 0)
    .map((c) => ({
      id: createChargeId(),
      kind: normalizeChargeKind(c.kind || c.label || "other"),
      label: (c.label || chargeKindLabel(normalizeChargeKind(c.kind || "other"))).trim(),
      amount: String(parseChargeAmount(c.amount)),
      includeInCif: true,
    }));
}
