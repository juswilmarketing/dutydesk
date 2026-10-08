/** Resolve branded share origin; falls back to the request origin when unset/invalid. */
export function resolveShareBaseOrigin(
  configured: string | undefined | null,
  requestUrl: string,
): string {
  const trimmed = String(configured || "").trim().replace(/\/+$/, "");
  if (trimmed) {
    try {
      return new URL(trimmed).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(requestUrl).origin;
}

export function buildTaxAdviceShareUrl(baseOrigin: string, token: string): string {
  return `${baseOrigin.replace(/\/+$/, "")}/api/tax-advice/share/${token}`;
}
