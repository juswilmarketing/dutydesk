export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "and", "or", "for", "with", "to", "in", "on", "pcs", "pc", "ea", "each", "qty",
]);

export function tokenize(text: string): string[] {
  return normalizeKey(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Built-in phrase normalizations applied before dictionary lookup. */
const PHRASE_MAP: Array<[RegExp, string]> = [
  [/\blad(ies|y)?\s+shoes?\b/g, "shoes"],
  [/\b(men'?s?|womens?|women'?s?)\s+shoes?\b/g, "shoes"],
  [/\b(women'?s?|lad(ies|y)?)\s+sandals?\b/g, "sandals"],
  [/\bled\s+drivers?\b/g, "led power supply"],
  [/\bpvc\s+elbows?\b/g, "pvc pipe fitting"],
  [/\bpvc\s+tees?\b/g, "pvc pipe fitting"],
  [/\bpvc\s+couplings?\b/g, "pvc pipe fitting"],
  [/\bstainless\s+steel\s+tanks?\b/g, "stainless tank"],
  [/\bplastic\s+bottles?\b/g, "plastic bottle"],
];

export function applyPhraseNormalization(desc: string): string {
  let s = normalizeKey(desc);
  for (const [re, repl] of PHRASE_MAP) {
    s = s.replace(re, repl);
  }
  return s.replace(/\s+/g, " ").trim();
}
