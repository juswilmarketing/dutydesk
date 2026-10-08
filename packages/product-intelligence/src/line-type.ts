/**
 * Universal invoice line-type detection.
 * Only merchandise lines may enter tariff classification.
 */

export type InvoiceLineType =
  | "merchandise"
  | "freight"
  | "surcharge"
  | "tax"
  | "discount"
  | "payment"
  | "subtotal"
  | "total"
  | "informational"
  | "unknown";

export type LineTypeResult = {
  lineType: InvoiceLineType;
  label: string;
  /** When true, never create a worksheet merchandise line or tariff recommendation. */
  excludeFromMerchandise: boolean;
  /** Charge kind for CIF / totals when the row is monetary. */
  chargeKind: "freight" | "insurance" | "sales_tax" | "other" | null;
  confidence: number;
  reason: string;
};

const RULES: Array<{
  type: InvoiceLineType;
  chargeKind: LineTypeResult["chargeKind"];
  pattern: RegExp;
  reason: string;
  confidence?: number;
}> = [
  {
    type: "total",
    chargeKind: null,
    pattern:
      /^(invoice\s+total|grand\s+total|total\s+amount\s+due|amount\s+due|balance\s+due|total\s+due|total\s+amount|total\s+payment|amount\s+payable|total)[:.\s]*$/i,
    reason: "Invoice total row",
  },
  {
    type: "subtotal",
    chargeKind: null,
    pattern:
      /^(sub\s*-?\s*total|goods\s+subtotal|goods\s+total|merchandise\s+total|merchandise\s+subtotal|subtotal)[:.\s]*$/i,
    reason: "Subtotal row",
  },
  {
    type: "discount",
    chargeKind: null,
    pattern: /^(discount|less\s+discount|promo(tion)?)$/i,
    reason: "Discount row",
  },
  {
    type: "payment",
    chargeKind: null,
    pattern:
      /\b(visa|master\s*card|mastercard|amex|american\s+express|paypal|credit\s+card|debit\s+card)\b.*\bpayment\b|\b(visa|mastercard|master\s*card)\s+payment\b|^payment\b|\btotal\s+payment\b/i,
    reason: "Payment row",
  },
  {
    type: "freight",
    chargeKind: "freight",
    pattern:
      /\b(freight(\s+charge)?|shipping(\s+charge)?|carriage|delivery\s+(charge|fee)s?|freight\s+charge)\b/i,
    reason: "Freight / shipping charge",
  },
  {
    type: "surcharge",
    chargeKind: "freight",
    pattern: /\b(fuel\s*surcharge|^surcharge\b|\bdf\b)\b/i,
    reason: "Fuel / general surcharge",
  },
  {
    type: "surcharge",
    chargeKind: "other",
    pattern: /\bimport\s+surcharge\b/i,
    reason: "Import surcharge",
  },
  {
    type: "surcharge",
    chargeKind: "other",
    pattern:
      /\b(handling(\s*(fee|charge))?|admin(istrative)?\s*(fee|charge)|processing\s*fee|service\s*charge|misc(ellaneous)?\s*(fee|charge)?)\b/i,
    reason: "Handling / service surcharge",
  },
  {
    type: "surcharge",
    chargeKind: "other",
    pattern: /^(documents?|document\s*(fee|charge)|documentation(\s*(fee|charge))?)$/i,
    reason: "Documents / documentation charge",
  },
  {
    type: "tax",
    chargeKind: "sales_tax",
    pattern: /\b(sales\s*tax|vat|gst|hst|pst|tax)\b/i,
    reason: "Tax row",
  },
  {
    type: "informational",
    chargeKind: null,
    pattern:
      /^(country\s+of\s+origin|origin|rim\s+width(\s+range)?|part\s+number|description|poland|germany|japan|china|usa|united\s+states)$/i,
    reason: "Informational / continuation metadata",
  },
];

/** Standalone fuel-surcharge code used on Tire Rack–style invoices. */
function isFuelSurchargeCode(description: string): boolean {
  const d = description.trim();
  return /^(df|fuel\s*surcharge|fuel\s*sc)$/i.test(d);
}

/**
 * Classify an extracted invoice row before merchandise grouping / tariff ranking.
 */
export function detectInvoiceLineType(description: string): LineTypeResult {
  const raw = String(description || "").trim();
  if (!raw) {
    return {
      lineType: "unknown",
      label: raw,
      excludeFromMerchandise: true,
      chargeKind: null,
      confidence: 1,
      reason: "Empty description",
    };
  }

  if (isFuelSurchargeCode(raw)) {
    return {
      lineType: "surcharge",
      label: raw,
      excludeFromMerchandise: true,
      chargeKind: "freight",
      confidence: 0.98,
      reason: "Fuel surcharge code / label",
    };
  }

  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  const tokenCount = normalized.split(/\s+/).length;
  const shortRow = tokenCount <= 10 && !/\d{3}\/\d{2}R\d{2}/i.test(raw);

  for (const rule of RULES) {
    if (!rule.pattern.test(normalized) && !rule.pattern.test(raw)) continue;
    // Avoid treating long merchandise descriptions that merely mention "tax" as tax rows
    if ((rule.type === "tax" || rule.type === "freight" || rule.type === "surcharge") && !shortRow) {
      if (
        !/^(fuel\s*surcharge|freight\s+charge|import\s+surcharge|shipping|handling|delivery\s*charges?|documents?)$/i
          .test(normalized)
      ) {
        continue;
      }
    }
    return {
      lineType: rule.type,
      label: raw,
      excludeFromMerchandise: true,
      chargeKind: rule.chargeKind,
      confidence: rule.confidence ?? 0.92,
      reason: rule.reason,
    };
  }

  // Pure country / rim-width continuation without qty semantics
  if (/^rim\s+width\s+range\b/i.test(normalized)) {
    return {
      lineType: "informational",
      label: raw,
      excludeFromMerchandise: true,
      chargeKind: null,
      confidence: 0.9,
      reason: "Rim width specification continuation",
    };
  }

  return {
    lineType: "merchandise",
    label: raw,
    excludeFromMerchandise: false,
    chargeKind: null,
    confidence: 0.7,
    reason: "Treated as merchandise pending grouping validation",
  };
}

export function isNonMerchandiseLine(description: string): boolean {
  return detectInvoiceLineType(description).excludeFromMerchandise;
}

/** Map line type to legacy charge detection used by invoice totals. */
export function chargeKindFromLineType(description: string): {
  kind: string;
  label: string;
} | null {
  const result = detectInvoiceLineType(description);
  if (!result.excludeFromMerchandise) return null;
  if (result.lineType === "subtotal" || result.lineType === "total" || result.lineType === "discount") {
    return null;
  }
  if (result.lineType === "payment" || result.lineType === "informational" || result.lineType === "unknown") {
    return null;
  }
  return {
    kind: result.chargeKind || "other",
    label: result.label,
  };
}
