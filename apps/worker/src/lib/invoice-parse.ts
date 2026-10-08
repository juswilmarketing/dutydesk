import {
  detectInvoiceLineType,
  chargeKindFromLineType,
  isNonMerchandiseLine,
} from "@pas/product-intelligence";

export type ParsedInvoiceItem = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  /** Printed line extension total (qty × unit price on invoice). Prefer this for sums. */
  line_total: number;
};

export type ParsedInvoice = {
  invoice_number: string | null;
  invoice_date: string | null;
  supplier: string | null;
  ship_from: string | null;
  ship_to: string | null;
  goods_subtotal: number | null;
  invoice_total: number | null;
  charges: Array<{ kind: string; label: string; amount: number }>;
  items: ParsedInvoiceItem[];
};

type RawItem = {
  description?: string;
  qty?: number | string;
  unit?: string;
  unit_price?: number | string;
  line_total?: number | string;
  extension?: number | string;
  amount?: number | string;
  total?: number | string;
};

type RawCharge = {
  kind?: string;
  label?: string;
  amount?: number | string;
};

type RawInvoice = {
  invoice_number?: string | null;
  invoice_date?: string | null;
  supplier?: string | null;
  ship_from?: string | null;
  ship_to?: string | null;
  goods_subtotal?: number | string | null;
  invoice_total?: number | string | null;
  charges?: RawCharge[];
  items?: RawItem[];
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseMoney(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  const n = parseMoney(v);
  return n > 0 ? roundMoney(n) : null;
}

function rawLineTotal(raw: RawItem): number {
  return parseMoney(raw.line_total ?? raw.extension ?? raw.amount ?? raw.total);
}

function normalizeCharges(raw: RawCharge[] | undefined) {
  return (raw || [])
    .map((c) => ({
      kind: String(c.kind || "other").trim().toLowerCase(),
      label: String(c.label || "Charge").trim(),
      amount: roundMoney(parseMoney(c.amount)),
    }))
    .filter((c) => c.amount > 0);
}

/**
 * Detect non-product invoice rows (freight, import surcharge, tax, totals, etc.).
 * These must never be classified as goods / HS codes.
 */
export function detectChargeFromDescription(
  description: string,
): { kind: string; label: string } | null {
  return chargeKindFromLineType(description);
}

/** True when a description should not be classified as a product line. */
export function isNonProductInvoiceLine(description: string): boolean {
  return isNonMerchandiseLine(description);
}

export { detectInvoiceLineType, isNonMerchandiseLine };

export function normalizeParsedItem(raw: RawItem): ParsedInvoiceItem | null {
  const description = raw.description?.trim();
  if (!description) return null;

  const qty = parseMoney(raw.qty) || 1;
  const unit = raw.unit?.trim() || "EA";
  const unitPriceRaw = parseMoney(raw.unit_price);
  let lineTotal = roundMoney(rawLineTotal(raw));

  if (lineTotal <= 0 && unitPriceRaw > 0 && qty > 0) {
    lineTotal = roundMoney(qty * unitPriceRaw);
  }

  // Keep merchandise rows even when amounts failed to OCR — clerk can correct totals.
  // Prefer the printed line extension — unit prices on scans are often rounded wrong.
  const unit_price = lineTotal > 0 && qty > 0
    ? lineTotal / qty
    : unitPriceRaw;

  return {
    description,
    qty,
    unit,
    unit_price,
    line_total: lineTotal,
  };
}

/** Nudge the last line by penny rounding drift so lines match the printed goods subtotal. */
export function reconcileInvoiceItems(
  items: ParsedInvoiceItem[],
  goodsSubtotal: number | null,
): { items: ParsedInvoiceItem[]; goodsSubtotal: number | null } {
  if (!items.length) return { items, goodsSubtotal };

  const withTotals = items.map((it) => ({
    ...it,
    line_total: it.line_total > 0 ? roundMoney(it.line_total) : roundMoney(it.qty * it.unit_price),
    unit_price: it.qty > 0 ? (it.line_total > 0 ? it.line_total : roundMoney(it.qty * it.unit_price)) / it.qty : it.unit_price,
  }));

  const lineSum = roundMoney(withTotals.reduce((s, it) => s + it.line_total, 0));
  const target = goodsSubtotal && goodsSubtotal > 0 ? roundMoney(goodsSubtotal) : lineSum;
  const diff = roundMoney(target - lineSum);
  const pennyTolerance = Math.max(0.05, withTotals.length * 0.02);

  if (goodsSubtotal && goodsSubtotal > 0 && diff !== 0 && Math.abs(diff) <= pennyTolerance) {
    const last = withTotals[withTotals.length - 1];
    const adjustedLine = roundMoney(last.line_total + diff);
    withTotals[withTotals.length - 1] = {
      ...last,
      line_total: adjustedLine,
      unit_price: last.qty > 0 ? adjustedLine / last.qty : last.unit_price,
    };
  }

  const finalSum = roundMoney(withTotals.reduce((s, it) => s + it.line_total, 0));
  const resolvedGoods =
    goodsSubtotal && goodsSubtotal > 0 ? roundMoney(goodsSubtotal) : finalSum > 0 ? finalSum : null;

  return { items: withTotals, goodsSubtotal: resolvedGoods };
}

function normalizeInvoice(raw: RawInvoice): ParsedInvoice | null {
  const parsedItems = (raw.items || [])
    .map((it) => normalizeParsedItem(it))
    .filter((it): it is ParsedInvoiceItem => it !== null);

  const productItems: ParsedInvoiceItem[] = [];
  const movedCharges: Array<{ kind: string; label: string; amount: number }> = [];
  let harvestedGoodsSubtotal: number | null = null;
  let harvestedInvoiceTotal: number | null = null;

  for (const it of parsedItems) {
    const typed = detectInvoiceLineType(it.description);
    const amount = roundMoney(it.line_total);

    if (typed.lineType === "subtotal" && amount > 0) {
      harvestedGoodsSubtotal = amount;
      continue;
    }
    if (typed.lineType === "total" && amount > 0) {
      harvestedInvoiceTotal = amount;
      continue;
    }
    if (
      typed.lineType === "discount"
      || typed.lineType === "payment"
      || typed.lineType === "informational"
      || typed.lineType === "unknown" && typed.excludeFromMerchandise
    ) {
      continue;
    }

    if (typed.excludeFromMerchandise && typed.chargeKind) {
      movedCharges.push({
        kind: typed.chargeKind,
        label: typed.label || it.description,
        amount,
      });
      continue;
    }

    // Legacy charge detector for anything the enum missed
    const charge = detectChargeFromDescription(it.description);
    if (charge) {
      movedCharges.push({
        kind: charge.kind,
        label: charge.label,
        amount,
      });
      continue;
    }

    if (typed.excludeFromMerchandise) continue;
    productItems.push(it);
  }

  if (!productItems.length) return null;

  const goodsFromDoc = numOrNull(raw.goods_subtotal) || harvestedGoodsSubtotal;
  const { items: reconciled, goodsSubtotal } = reconcileInvoiceItems(productItems, goodsFromDoc);

  const charges = [...normalizeCharges(raw.charges), ...normalizeCharges(movedCharges)];
  const seen = new Set<string>();
  const dedupedCharges = charges.filter((c) => {
    const key = `${c.kind}|${c.label.toLowerCase()}|${c.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const chargeSum = roundMoney(dedupedCharges.reduce((s, c) => s + c.amount, 0));
  let invoiceTotal = numOrNull(raw.invoice_total) || harvestedInvoiceTotal;
  // Derive grand total when the model omitted it but goods + charges are known
  if (!invoiceTotal && goodsSubtotal && goodsSubtotal > 0) {
    invoiceTotal = roundMoney(goodsSubtotal + chargeSum);
  }

  return {
    invoice_number: raw.invoice_number?.trim() || null,
    invoice_date: raw.invoice_date?.trim() || null,
    supplier: raw.supplier?.trim() || null,
    ship_from: raw.ship_from?.trim() || null,
    ship_to: raw.ship_to?.trim() || null,
    goods_subtotal: goodsSubtotal,
    invoice_total: invoiceTotal,
    charges: dedupedCharges,
    items: reconciled,
  };
}

function extractJsonPayload(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("Could not parse invoice response");
  }
}

export function parseInvoicesFromModelText(
  text: string,
  options?: { allowEmpty?: boolean },
): ParsedInvoice[] {
  const data = extractJsonPayload(text);
  let rawList: RawInvoice[] = [];

  if (Array.isArray(data)) {
    rawList = data as RawInvoice[];
  } else if (data && typeof data === "object") {
    const obj = data as { invoices?: RawInvoice[] } & RawInvoice;
    if (Array.isArray(obj.invoices)) {
      rawList = obj.invoices;
    } else if (Array.isArray(obj.items)) {
      rawList = [obj];
    }
  }

  const invoices = rawList
    .map((raw) => normalizeInvoice(raw))
    .filter((inv): inv is ParsedInvoice => inv !== null);

  // Multi-page OCR batches often include cover/terms pages with no merchandise.
  // Callers that process page ranges should pass allowEmpty: true.
  if (!invoices.length && !options?.allowEmpty) {
    throw new Error("No line items found in this file.");
  }
  return invoices;
}

export const INVOICE_PROMPT = `This document may contain ONE or MORE separate commercial invoices (e.g. a PDF with multiple pages, each with its own invoice number, supplier header, and line-item table). It may be a scan or photo — read printed numbers carefully.

Your job:
- Detect every distinct invoice in the document.
- Treat separate invoice numbers, dates, or clearly separate invoice layouts as separate invoices.
- Do NOT merge line items from different invoices into one.
- Extract ALL product/goods line items from EVERY invoice with EXACT printed numbers.
- Extract invoice totals and charges separately from product lines.

CRITICAL — totals fields (required whenever visible on the document):
- Always set goods_subtotal to the printed goods/merchandise subtotal (before freight, tax, and fees).
- Always set invoice_total to the printed grand total / amount due / total payment.
- Never leave goods_subtotal or invoice_total null/0 when those amounts are printed.
- Do NOT put subtotal, invoice total, amount due, or payment rows in the items array — put their amounts in goods_subtotal / invoice_total instead.
- goods_subtotal MUST equal the sum of all merchandise item line_total values (before freight/tax).
- Verify your line_total values add up to goods_subtotal before responding.

CRITICAL — line item amounts (especially on scanned invoices):
- Each item MUST include line_total: the printed line extension / amount / total for that row (the rightmost money column for the product line).
- Also include qty and unit_price when visible, but line_total is the authoritative amount for that row.
- Copy numbers EXACTLY as printed (do not round unit_price and then multiply — use the printed line total).
- If only line_total and qty are visible, set unit_price = line_total / qty.

Product line items ONLY — exclude freight, insurance, sales tax, VAT/GST, import surcharge, fuel surcharge (including code "DF"), handling fees, discounts, subtotal rows, payment rows (Visa/MasterCard/Total Payment), and grand total / amount due rows from the items array.
NEVER put "Import Surcharge", "Fuel Surcharge", "DF", freight, insurance, tax, payment, or fee rows in the items array — they are not products and must not be tariff-classified.
Put freight, insurance, sales tax/VAT/GST, import surcharge, fuel surcharge, handling, and similar amounts in the charges array (not as product line items).

CRITICAL — multiline product descriptions:
- Merge continuation rows into ONE merchandise item when they share one quantity/price/extension.
- Do NOT create separate items for: part numbers, secondary SKUs, country of origin, rim width range, load/speed ratings, or specification fragments.
- Example: part number + "275/50R19 BS ALNZ SPT AS" + "112V XL" + "Poland" + "Rim Width Range..." = ONE tyre line.
- Prefer description text that includes the product identity (e.g. tyre size + model), not orphaned SKUs alone.
- Keep supplier SKU in the description when helpful, but the product noun/spec must be present.

Use short but complete product descriptions (include size/model for tyres/wheels/switches).

Charge kinds (use exactly one per charge): freight | insurance | sales_tax | other
Use kind "freight" for fuel surcharge / DF. Use kind "other" for import surcharge and miscellaneous fees.

Return ONLY valid JSON (no markdown):
{"invoices":[{"invoice_number":"string or null","invoice_date":"string or null","supplier":"string or null","ship_from":"string or null","ship_to":"string or null","goods_subtotal":0,"invoice_total":0,"charges":[{"kind":"freight","label":"Freight","amount":0}],"items":[{"description":"concise product name","qty":1,"unit":"EA","unit_price":0,"line_total":0}]}]}

goods_subtotal = printed sum of goods lines (before freight/tax). invoice_total = printed grand total. Use null if not visible.

CRITICAL — this upload may be a PAGE RANGE of a larger multi-page invoice PDF (not necessarily the full document).
- Extract every product line visible on these pages.
- Do not invent lines from missing pages.
- If an invoice continues from a previous page, still extract the rows you can see.
- Prefer including partial invoices over dropping goods lines.

If the document has only one invoice, still return the invoices array with one element.`;
