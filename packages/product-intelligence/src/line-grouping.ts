/**
 * Multiline invoice product grouping.
 * Merges continuation rows (SKU, origin, specs) into one merchandise item.
 */

import { detectInvoiceLineType, type InvoiceLineType } from "./line-type";

export type RawExtractedRow = {
  description: string;
  qty?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  unit?: string | null;
};

export type GroupedMerchandiseLine = {
  supplierSku: string;
  secondarySku: string;
  rawDescription: string;
  cleanDescription: string;
  countryOfOrigin: string;
  specifications: Record<string, string | number | boolean | null>;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unit: string;
  lineType: InvoiceLineType;
  groupingConfidence: number;
  groupingWarnings: string[];
  sourceRowCount: number;
};

export type GroupedChargeLine = {
  description: string;
  lineType: InvoiceLineType;
  amount: number;
  chargeKind: string | null;
};

export type InvoiceGroupingResult = {
  merchandise: GroupedMerchandiseLine[];
  charges: GroupedChargeLine[];
  droppedInformational: string[];
  needsReview: boolean;
  validationWarnings: string[];
};

const COUNTRY =
  /^(poland|germany|japan|china|usa|united states|canada|mexico|thailand|indonesia|vietnam|korea|south korea|taiwan|italy|spain|france|uk|united kingdom|brazil|india)$/i;

const TYRE_SIZE = /\b(\d{3})\s*\/\s*(\d{2})\s*R\s*(\d{2})\b/i;
const RIM_WIDTH = /rim\s+width\s+range\s+([\d.]+\s+to\s+[\d.]+)/i;
const PART_NUMBER_LABEL = /^part\s*number:?$/i;
const DESCRIPTION_LABEL = /^description:?$/i;
const SKU_LIKE = /^[A-Z0-9][A-Z0-9+/._-]{4,}$/i;
const SHORT_NUMERIC_SKU = /^\d{5,8}$/;

function money(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100) / 100;
  const n = parseFloat(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isContinuation(desc: string): boolean {
  const d = desc.trim();
  if (!d) return true;
  if (PART_NUMBER_LABEL.test(d) || DESCRIPTION_LABEL.test(d)) return true;
  if (COUNTRY.test(d)) return true;
  if (RIM_WIDTH.test(d) || /^rim\s+width/i.test(d)) return true;
  if (SHORT_NUMERIC_SKU.test(d)) return true;
  // Secondary size/rating line like "012058 112V XL"
  if (/^\d{5,8}\b/.test(d) && /\b(XL|RF|\d{2,3}[A-Z])\b/i.test(d) && !TYRE_SIZE.test(d)) return true;
  if (SKU_LIKE.test(d) && !TYRE_SIZE.test(d) && !/\b(switch|wheel|hub|lug|tyre|tire)\b/i.test(d)) {
    if (!/\s/.test(d) && /[A-Z]/i.test(d) && /\d/.test(d)) return true;
  }
  if (/^(xl|rf|runflat|\d{2,3}[A-Z])$/i.test(d)) return true;
  return false;
}

function hasCommercialQty(row: RawExtractedRow): boolean {
  return money(row.qty) > 0 && (money(row.unitPrice) > 0 || money(row.lineTotal) > 0);
}

function extractSpecs(text: string): Record<string, string | number | boolean | null> {
  const specs: Record<string, string | number | boolean | null> = {};
  const size = text.match(TYRE_SIZE);
  if (size) specs.tyreSize = `${size[1]}/${size[2]}R${size[3]}`;
  const load = text.match(/\b(\d{2,3})([HWVRSTYZ])\b/i);
  if (load) specs.loadSpeedRating = `${load[1]}${load[2].toUpperCase()}`;
  if (/\bXL\b/i.test(text)) specs.reinforced = true;
  const rim = text.match(RIM_WIDTH);
  if (rim) specs.rimWidthRange = rim[1];
  return specs;
}

function cleanProductText(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !PART_NUMBER_LABEL.test(p) && !DESCRIPTION_LABEL.test(p))
    .filter((p) => !COUNTRY.test(p))
    .filter((p) => !/^rim\s+width/i.test(p))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group raw OCR/table rows into merchandise items and non-merchandise charges.
 */
export function groupInvoiceRows(rows: RawExtractedRow[]): InvoiceGroupingResult {
  const merchandise: GroupedMerchandiseLine[] = [];
  const charges: GroupedChargeLine[] = [];
  const droppedInformational: string[] = [];
  const validationWarnings: string[] = [];

  let open: {
    skus: string[];
    texts: string[];
    origin: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    unit: string;
    sourceRowCount: number;
  } | null = null;

  const flush = () => {
    if (!open) return;
    const joined = cleanProductText(open.texts);
    const skus = open.skus.filter(Boolean);
    const specs = extractSpecs([...open.texts, joined].join(" "));
    const productish = joined || skus.join(" ");
    const lineType = detectInvoiceLineType(productish);
    if (lineType.excludeFromMerchandise) {
      if (open.lineTotal > 0 || open.unitPrice > 0) {
        charges.push({
          description: productish,
          lineType: lineType.lineType,
          amount: open.lineTotal || open.unitPrice,
          chargeKind: lineType.chargeKind,
        });
      } else {
        droppedInformational.push(productish);
      }
      open = null;
      return;
    }

    const warnings: string[] = [];
    let confidence = 0.85;
    if (!joined || SKU_LIKE.test(joined) && !/\s/.test(joined)) {
      warnings.push("Product line may have been extracted incorrectly (SKU-like description).");
      confidence = 0.35;
    }
    if (!open.qty || !(open.unitPrice > 0 || open.lineTotal > 0)) {
      warnings.push("Merchandise quantity/price incomplete.");
      confidence = Math.min(confidence, 0.4);
    }

    const lineTotal =
      open.lineTotal > 0
        ? open.lineTotal
        : open.qty > 0 && open.unitPrice > 0
          ? Math.round(open.qty * open.unitPrice * 100) / 100
          : 0;
    const unitPrice = open.qty > 0 && lineTotal > 0 ? lineTotal / open.qty : open.unitPrice;

    merchandise.push({
      supplierSku: skus[0] || "",
      secondarySku: skus[1] || "",
      rawDescription: joined || productish,
      cleanDescription: joined.replace(/\b\d{5,8}\b/g, " ").replace(/\s+/g, " ").trim() || joined,
      countryOfOrigin: open.origin,
      specifications: {
        ...specs,
        ...(open.origin ? { countryOfOrigin: open.origin } : {}),
      },
      quantity: open.qty || 1,
      unitPrice,
      lineTotal,
      unit: open.unit || "EA",
      lineType: "merchandise",
      groupingConfidence: confidence,
      groupingWarnings: warnings,
      sourceRowCount: open.sourceRowCount,
    });
    open = null;
  };

  for (const row of rows) {
    const desc = String(row.description || "").trim();
    if (!desc) continue;

    const typed = detectInvoiceLineType(desc);
    if (typed.excludeFromMerchandise && !isContinuation(desc)) {
      flush();
      const amount = money(row.lineTotal) || money(row.unitPrice) * (money(row.qty) || 1);
      if (typed.lineType === "informational") {
        droppedInformational.push(desc);
      } else if (amount > 0 && typed.lineType !== "subtotal" && typed.lineType !== "total" && typed.lineType !== "discount" && typed.lineType !== "payment") {
        charges.push({
          description: desc,
          lineType: typed.lineType,
          amount,
          chargeKind: typed.chargeKind,
        });
      } else {
        droppedInformational.push(desc);
      }
      continue;
    }

    if (isContinuation(desc) && open) {
      if (COUNTRY.test(desc)) open.origin = desc;
      else if (SHORT_NUMERIC_SKU.test(desc) || (SKU_LIKE.test(desc) && !/\s/.test(desc))) {
        if (!open.skus.includes(desc)) open.skus.push(desc);
      } else if (!PART_NUMBER_LABEL.test(desc) && !DESCRIPTION_LABEL.test(desc)) {
        open.texts.push(desc);
      }
      open.sourceRowCount += 1;
      continue;
    }

    if (isContinuation(desc) && !open) {
      // Orphan continuation — hold as seed without commercial qty
      open = {
        skus: SHORT_NUMERIC_SKU.test(desc) || (SKU_LIKE.test(desc) && !/\s/.test(desc)) ? [desc] : [],
        texts: !SHORT_NUMERIC_SKU.test(desc) && !(SKU_LIKE.test(desc) && !/\s/.test(desc)) && !COUNTRY.test(desc)
          ? [desc]
          : [],
        origin: COUNTRY.test(desc) ? desc : "",
        qty: 0,
        unitPrice: 0,
        lineTotal: 0,
        unit: "EA",
        sourceRowCount: 1,
      };
      continue;
    }

    // New merchandise anchor
    if (open && hasCommercialQty(row)) flush();
    else if (open && !hasCommercialQty(row) && !hasCommercialQty({ description: open.texts[0] || "", qty: open.qty, unitPrice: open.unitPrice, lineTotal: open.lineTotal })) {
      // Keep accumulating into open when neither has qty yet
      open.texts.push(desc);
      open.sourceRowCount += 1;
      if (money(row.qty) > 0) open.qty = money(row.qty);
      if (money(row.unitPrice) > 0) open.unitPrice = money(row.unitPrice);
      if (money(row.lineTotal) > 0) open.lineTotal = money(row.lineTotal);
      continue;
    } else if (open) {
      flush();
    }

    const skus: string[] = [];
    const texts: string[] = [];
    for (const token of desc.split(/\s+/)) {
      if (SHORT_NUMERIC_SKU.test(token) || (/^[A-Z0-9]{8,}$/i.test(token) && /[A-Z]/i.test(token) && /\d/.test(token))) {
        skus.push(token);
      }
    }
    texts.push(desc);
    open = {
      skus,
      texts,
      origin: "",
      qty: money(row.qty) || 0,
      unitPrice: money(row.unitPrice),
      lineTotal: money(row.lineTotal),
      unit: row.unit || "EA",
      sourceRowCount: 1,
    };
  }
  flush();

  for (const m of merchandise) {
    if (m.groupingConfidence < 0.55) {
      validationWarnings.push(`Low grouping confidence: ${m.rawDescription.slice(0, 60)}`);
    }
    if (!m.rawDescription.trim()) {
      validationWarnings.push("Merchandise row missing product description.");
    }
  }

  return {
    merchandise,
    charges,
    droppedInformational,
    needsReview: validationWarnings.length > 0 || merchandise.some((m) => m.groupingConfidence < 0.55),
    validationWarnings,
  };
}
