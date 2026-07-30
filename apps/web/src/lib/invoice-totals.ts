import type { Invoice } from "@pas/shared-types";
import { fmtForeign, normalizeCurrency } from "@/lib/currencies";
import { parseChargeAmount, sumCharges, sumLineItems } from "@/lib/invoice-charges";

const TOLERANCE_RATIO = 0.005;
const TOLERANCE_MIN = 1;

function tolerance(expected: number): number {
  return Math.max(TOLERANCE_MIN, Math.abs(expected) * TOLERANCE_RATIO);
}

export interface InvoiceTotalsCheck {
  mismatch: boolean;
  lineSum: number;
  documentGoodsTotal: number;
  documentGrandTotal: number;
  chargesInCif: number;
  expectedGoodsTotal: number;
  difference: number;
  message: string;
}

export function checkInvoiceTotals(inv: Invoice): InvoiceTotalsCheck {
  const lineSum = sumLineItems(inv);
  const documentGoodsTotal = parseChargeAmount(inv.meta.documentGoodsTotal);
  const documentGrandTotal = parseChargeAmount(inv.meta.documentGrandTotal);
  const chargesInCif = sumCharges(inv.meta.charges || []);
  const cur = normalizeCurrency(inv.meta.currency);

  let expectedGoodsTotal = 0;
  if (documentGoodsTotal > 0) {
    expectedGoodsTotal = documentGoodsTotal;
  } else if (documentGrandTotal > 0) {
    expectedGoodsTotal = Math.max(0, documentGrandTotal - chargesInCif);
  }

  const difference = expectedGoodsTotal > 0 ? lineSum - expectedGoodsTotal : 0;
  const mismatch = expectedGoodsTotal > 0 && Math.abs(difference) > tolerance(expectedGoodsTotal);

  const fmt = (n: number) => fmtForeign(n, cur);
  const message = mismatch
    ? `Line items total ${fmt(lineSum)} does not match the invoice document (${fmt(expectedGoodsTotal)} expected). Please review quantities, prices, or missing lines before sending tax advice.`
    : "";

  return {
    mismatch,
    lineSum,
    documentGoodsTotal,
    documentGrandTotal,
    chargesInCif,
    expectedGoodsTotal,
    difference,
    message,
  };
}

export function invoicesNeedingTotalsReview(invoices: Invoice[]): Invoice[] {
  return invoices.filter((inv) => {
    const check = checkInvoiceTotals(inv);
    return check.mismatch && !inv.meta.totalsReviewed;
  });
}
