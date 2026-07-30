import type { TaxInputs, ItemExemptions } from "@pas/shared-types";

export interface TaxItemInput {
  id: number;
  desc: string;
  tariff_code: string | null;
  duty_rate: string | null;
  vat_rate?: string | null;
  levy_rate?: string | null;
  qty: number;
  price: number;
}

export interface TaxRow extends TaxItemInput {
  itemVal: number;
  itemCIF: number;
  duty: number;
  vat: number;
  levy: number;
  dutyPct: number;
  isDutyExempt: boolean;
  isVatExempt: boolean;
  subtotal: number;
}

export interface TaxSummary {
  invoiceTotal: number;
  cifUSD: number;
  cifTTD: number;
  totalDuty: number;
  totalVAT: number;
  totalLevy: number;
  containerFee: number;
  userFee: number;
  grandTotal: number;
  rows: TaxRow[];
}

export function parseDutyPct(dutyRate: string | null): number {
  if (!dutyRate || dutyRate === "Free") return 0;
  return parseFloat(dutyRate.replace("%", "")) / 100 || 0;
}

function parseTaxPct(rate: string | null | undefined, fallback: number): number {
  if (rate == null || rate === "") return fallback;
  if (rate === "Free" || rate === "Exempt") return 0;
  return parseFloat(rate.replace("%", "")) / 100 || 0;
}

export function xrAgeWarning(updatedAt: string | null | undefined, maxDays = 14): boolean {
  if (!updatedAt) return true;
  return (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24) > maxDays;
}

export const EXCHANGE_RATE_DECIMALS = 5;

export function fmtExchangeRate(n: number): string {
  return n.toFixed(EXCHANGE_RATE_DECIMALS);
}

export function parseExchangeRate(value: string): number | null {
  const n = parseFloat(value.replace(/,/g, "").trim());
  if (!(n > 0)) return null;
  const factor = 10 ** EXCHANGE_RATE_DECIMALS;
  return Math.round(n * factor) / factor;
}

export function cesUnitFee(size: TaxInputs["containerSize"]): number {
  return size === "20ft" ? 750 : size === "40ft" ? 1050 : 0;
}

export function normalizeContainerCount(count: number | undefined): number {
  if (!Number.isFinite(count) || (count ?? 0) < 1) return 1;
  return Math.min(99, Math.floor(count!));
}

export function cesFeeFromContainer(
  size: TaxInputs["containerSize"],
  count: number | undefined = 1,
): number {
  if (size === "none") return 0;
  return cesUnitFee(size) * normalizeContainerCount(count);
}

export function formatContainerCesLabel(
  size: TaxInputs["containerSize"],
  count: number | undefined = 1,
): string {
  if (size === "none") return "";
  const qty = normalizeContainerCount(count);
  return qty > 1 ? `${qty} × ${size}` : size;
}

export function calculateTaxes(
  items: TaxItemInput[],
  taxInputs: TaxInputs,
  exchangeRate: number,
  itemExemptions: Record<number, ItemExemptions> = {},
): TaxSummary {
  const invoiceTotal = items.reduce((s, i) => s + i.qty * (i.price || 0), 0);
  const freight = parseFloat(taxInputs.freight) || 0;
  const insurance = parseFloat(taxInputs.insurance) || 0;
  const otherCharges = parseFloat(taxInputs.otherCharges) || 0;
  const cifUSD = invoiceTotal + freight + insurance + otherCharges;
  const cifTTD = cifUSD * exchangeRate;
  const totalInvoice = invoiceTotal || 1;

  const rows: TaxRow[] = items.map((it) => {
    const itemVal = it.qty * (it.price || 0);
    const itemProportion = itemVal / totalInvoice;
    const itemCIF = cifTTD * itemProportion;
    const dutyPct = parseDutyPct(it.duty_rate);
    const vatPct = parseTaxPct(it.vat_rate, 0.125);
    const levyPct = parseTaxPct(it.levy_rate, 0);
    const isDutyExempt = itemExemptions[it.id]?.dutyExempt || it.duty_rate === "Free";
    const isVatExempt = itemExemptions[it.id]?.vatExempt || taxInputs.vatExempt;
    const duty = isDutyExempt ? 0 : itemCIF * dutyPct;
    const levy = itemCIF * levyPct;
    const vat = isVatExempt ? 0 : (itemCIF + duty + levy) * vatPct;
    return {
      ...it,
      itemVal,
      itemCIF,
      duty,
      vat,
      levy,
      dutyPct,
      isDutyExempt,
      isVatExempt,
      subtotal: duty + levy + vat,
    };
  });

  const totalDuty = rows.reduce((s, r) => s + r.duty, 0);
  const totalVAT = rows.reduce((s, r) => s + r.vat, 0);
  const totalLevy = rows.reduce((s, r) => s + r.levy, 0);
  const containerFee = cesFeeFromContainer(taxInputs.containerSize, taxInputs.containerCount);
  const userFee = taxInputs.userFee ? 80 : 0;
  const grandTotal = totalDuty + totalLevy + totalVAT + containerFee + userFee;

  return {
    invoiceTotal,
    cifUSD,
    cifTTD,
    totalDuty,
    totalVAT,
    totalLevy,
    containerFee,
    userFee,
    grandTotal,
    rows,
  };
}

export function fmtTTD(n: number): string {
  return `TT$${n.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtUSD(n: number): string {
  return `US$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
