import type { TariffEntry } from "@pas/shared-types";
import { getTariffCount, getTariffRows, TT_TARIFF, type TariffRow } from "./rows";

export type { TariffRow };
export { getTariffCount, getTariffRows, TT_TARIFF };

/** Controlled synonyms expanded during retrieval (bidirectional). */
const SYNONYM_GROUPS: string[][] = [
  ["tire", "tyre", "tires", "tyres"],
  ["rack", "racks", "racking", "shelving", "shelf", "shelves"],
  ["aluminum", "aluminium"],
  ["color", "colour"],
  ["catalog", "catalogue"],
];

const SYNONYM_MAP = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_MAP.set(term, group);
  }
}

export function catFromCode(code: string): string {
  const ch = parseInt(code.slice(0, 2), 10);
  if (ch <= 5) return "Live Animals";
  if (ch <= 14) return "Vegetable Prod.";
  if (ch <= 24) return "Food & Beverages";
  if (ch <= 27) return "Minerals/Fuels";
  if (ch <= 38) return "Chemicals";
  if (ch <= 40) return "Plastics/Rubber";
  if (ch <= 43) return "Hides/Leather";
  if (ch <= 49) return "Wood/Paper";
  if (ch <= 67) return "Textiles";
  if (ch <= 70) return "Stone/Glass";
  if (ch <= 83) return "Metals";
  if (ch <= 85) return "Machinery/Electrical";
  if (ch <= 89) return "Transport";
  if (ch <= 97) return "Miscellaneous";
  return "General";
}

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function expandTerm(term: string): string[] {
  const group = SYNONYM_MAP.get(term);
  const base = group ? [...group] : [term];
  const out = new Set(base);
  for (const t of base) {
    if (t.length <= 3) continue;
    if (t.endsWith("s")) out.add(t.slice(0, -1));
    else out.add(`${t}s`);
  }
  return [...out];
}

/** Whole-token match — never match "rack" inside "track" / "racket" or "tyre" inside "styrene". */
export function hasTokenMatch(haystack: string, term: string): boolean {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

function termHitScore(descLower: string, term: string): number {
  for (const variant of expandTerm(term)) {
    if (!hasTokenMatch(descLower, variant)) continue;
    if (descLower.startsWith(variant)) return 3;
    return 2;
  }
  return 0;
}

/**
 * Score a tariff description against query terms using token boundaries + synonyms.
 * Returns 0 when no meaningful lexical hit exists.
 */
export function scoreTariffDescription(
  desc: string,
  terms: string[],
  options?: { phrase?: string; headNoun?: string | null },
): number {
  if (!terms.length) return 0;
  const dl = desc.toLowerCase();
  let score = 0;
  let hits = 0;

  if (options?.phrase) {
    const phrase = options.phrase.toLowerCase().trim();
    if (phrase.length >= 4 && hasTokenMatch(dl, phrase)) {
      score += 10;
      hits += 1;
    } else {
      // Multi-word phrase as contiguous tokens
      const phraseTokens = tokenizeQuery(phrase);
      if (phraseTokens.length >= 2) {
        const joined = phraseTokens.join(" ");
        if (dl.includes(joined)) {
          score += 8;
          hits += 1;
        }
      }
    }
  }

  for (const t of terms) {
    const hit = termHitScore(dl, t);
    if (hit > 0) {
      score += hit;
      hits += 1;
    }
  }

  if (hits === 0) return 0;

  // Penalize when the query head noun never appears (and neither do its synonyms)
  const head = options?.headNoun?.toLowerCase();
  if (head && termHitScore(dl, head) === 0) {
    score *= 0.35;
  }

  return score;
}

function inferHeadNoun(terms: string[]): string | null {
  if (!terms.length) return null;
  // Prefer storage/furniture head nouns when present
  for (const candidate of ["rack", "racks", "shelving", "shelf", "shelves", "racking"]) {
    if (terms.includes(candidate)) return candidate === "racks" ? "rack" : candidate;
  }
  return terms[terms.length - 1] || null;
}

export function searchTariff(q: string, limit = 8): TariffEntry[] {
  if (!q || q.length < 2) return [];
  const terms = tokenizeQuery(q);
  if (!terms.length) return [];
  const headNoun = inferHeadNoun(terms);
  const res: TariffEntry[] = [];
  for (const { code, desc, duty } of TT_TARIFF) {
    const score = scoreTariffDescription(desc, terms, { phrase: q, headNoun });
    if (score > 0) res.push({ code, desc, duty, score });
  }
  return res.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}

export function similarCodes(
  desc: string,
  aiCode: string | null,
  limit = 6,
  options?: {
    preferredChapters?: string[];
    excludedChapters?: string[];
    /** When true, never return chapters 01–24 unless preferred explicitly includes them */
    excludeFoodChapters?: boolean;
  },
): TariffEntry[] {
  const stopWords = new Set([
    "the", "and", "or", "of", "for", "with", "in", "a", "an", "is", "are", "not", "to", "from", "other", "type", "grade", "based",
    "preparation", "preparations", "paste", "cream", "creams", "solution", "treated", "preserved",
  ]);
  const words = tokenizeQuery(desc).filter((w) => !stopWords.has(w));
  const preferred = new Set((options?.preferredChapters || []).map((c) => c.padStart(2, "0")));
  const excluded = new Set((options?.excludedChapters || []).map((c) => c.padStart(2, "0")));
  const headNoun = inferHeadNoun(words);
  const results: TariffEntry[] = [];
  const seen = new Set<string>();

  for (const { code, desc: d, duty } of TT_TARIFF) {
    const ch = code.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
    if (excluded.has(ch)) continue;
    if (options?.excludeFoodChapters && parseInt(ch, 10) <= 24 && !preferred.has(ch)) continue;

    // Lexical eligibility first — preferred chapter alone must not create candidates
    let score = scoreTariffDescription(d, words, { phrase: desc, headNoun });
    if (score <= 0) continue;

    if (preferred.size && preferred.has(ch)) score += 2; // tie-breaker only
    if (aiCode && code.slice(0, 4) === aiCode.slice(0, 4)) score += 5;
    else if (aiCode && code.slice(0, 2) === aiCode.slice(0, 2)) score += 2;

    if (!seen.has(code)) {
      seen.add(code);
      results.push({ code, desc: d, duty, score });
    }
  }

  if (aiCode) {
    const found = TT_TARIFF.find((row) => row.code === aiCode);
    if (found && !seen.has(aiCode)) {
      results.push({ code: found.code, desc: found.desc, duty: found.duty, score: 999 });
    }
  }
  return results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}

export function normalizeDesc(desc: string): string {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export interface LearnedLookup {
  [key: string]: {
    tariff_code: string;
    duty_rate: string;
    category: string;
    uses?: number;
  };
}

export function learnedMatch(desc: string, db: LearnedLookup) {
  const norm = normalizeDesc(desc);
  if (db[norm]) return db[norm];
  const words = norm.split(" ").filter((w) => w.length > 3);
  let best: (typeof db)[string] | null = null;
  let bestScore = 0;
  for (const [key, val] of Object.entries(db)) {
    const keyWords = key.split(" ").filter((w) => w.length > 3);
    const overlap = words.filter((w) => keyWords.includes(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = val;
    }
  }
  return bestScore >= 2 ? best : null;
}

export function bestMatch(desc: string, learned?: LearnedLookup | null): TariffEntry | null {
  if (learned) {
    const hit = learnedMatch(desc, learned);
    if (hit) {
      const row = TT_TARIFF.find((r) => r.code === hit.tariff_code);
      if (row) return { ...row, score: 100 };
    }
  }
  const results = searchTariff(desc, 1);
  return results[0] || null;
}
