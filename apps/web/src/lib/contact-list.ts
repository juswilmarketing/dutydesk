/** Shared helpers for comma / line separated contact lists. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function formatEmailList(emails: string[]): string {
  return emails.map((e) => e.trim()).filter(Boolean).join(", ");
}

export function isValidEmail(addr: string): boolean {
  return EMAIL_RE.test(addr.trim());
}

export function emailsAreValid(raw: string): boolean {
  const list = parseEmailList(raw);
  return list.length > 0 && list.every(isValidEmail);
}

export function parsePhoneList(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;/\n|]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\D/g, "") || trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function formatPhoneList(phones: string[]): string {
  return phones.map((p) => p.trim()).filter(Boolean).join(", ");
}
