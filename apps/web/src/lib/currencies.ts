export const INVOICE_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "CNY", "TTD"] as const;

export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

const SYMBOLS: Record<string, string> = {
  USD: "US$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  CNY: "¥",
  TTD: "TT$",
};

export function normalizeCurrency(code: string | undefined): InvoiceCurrency {
  const c = (code || "USD").trim().toUpperCase();
  return (INVOICE_CURRENCIES as readonly string[]).includes(c) ? (c as InvoiceCurrency) : "USD";
}

export function currencySymbol(code: string): string {
  return SYMBOLS[code.toUpperCase()] || code.toUpperCase();
}

export function fmtForeign(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  const sym = currencySymbol(code);
  const formatted = Number(amount || 0).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (code === "EUR") return `${sym}${formatted}`;
  return `${sym}${formatted}`;
}
