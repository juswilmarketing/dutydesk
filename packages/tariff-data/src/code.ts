/** Normalize and parse Trinidad & Tobago HS national tariff codes. */

export type ParsedTariffCode = {
  raw: string;
  normalized: string;
  digits: string;
  chapter: string;
  heading: string;
  headingDisplay: string;
  subheading: string;
  national: string;
  validFormat: boolean;
};

/** Digits only, left-padded chapter. */
export function digitsOnly(code: string): string {
  return String(code || "").replace(/\D/g, "");
}

export function normalizeTariffCode(code: string): string {
  const d = digitsOnly(code);
  if (d.length < 4) return d;
  if (d.length === 4) return `${d.slice(0, 2)}.${d.slice(2, 4)}`;
  if (d.length === 6) return `${d.slice(0, 4)}.${d.slice(4, 6)}`;
  // T&T national lines: 0101.21.00 (8 digits)
  if (d.length >= 8) {
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  }
  return code.replace(/\s/g, "").toUpperCase();
}

export function parseTariffCode(code: string): ParsedTariffCode {
  const raw = String(code || "").trim();
  const digits = digitsOnly(raw);
  const validFormat = digits.length === 8;
  const chapter = digits.slice(0, 2).padStart(2, "0");
  const heading = digits.slice(0, 4).padStart(4, "0");
  const headingDisplay = `${heading.slice(0, 2)}.${heading.slice(2, 4)}`;
  const subheading = digits.length >= 6 ? digits.slice(0, 6) : heading;
  const national = validFormat
    ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`
    : normalizeTariffCode(raw);

  return {
    raw,
    normalized: national,
    digits,
    chapter,
    heading,
    headingDisplay,
    subheading,
    national,
    validFormat,
  };
}

export function chapterFromCode(code: string): string {
  return parseTariffCode(code).chapter;
}

export function headingFromCode(code: string): string {
  return parseTariffCode(code).heading;
}

export function nationalFromCode(code: string): string {
  return parseTariffCode(code).national;
}
