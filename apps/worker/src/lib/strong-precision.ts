import type { ConfidenceLabel } from "@pas/shared-types";
import { classifyHierarchically, type ClassificationGolden } from "@pas/product-intelligence";
import { getNationalLine } from "@pas/tariff-data";
import { calibrateCandidate, familyResolvedFor, isProvisionalResult } from "./candidate-evidence";

export const SIMULATED_AI_CONFIDENCE = 0.9;
export const STRONG_PRECISION_TARGET = 0.98;

export interface TestCaseRow {
  id: number;
  raw_description: string;
  supplier: string | null;
  expected_chapter: string | null;
  expected_heading: string | null;
  expected_tariff: string | null;
  acceptable_alternatives_json: string;
  prohibited_chapters_json: string;
  source: string;
}

export interface PrecisionCase {
  id: string;
  description: string;
  clarification?: { id: string; value: string } | null;
  consignee?: string | null;
  supplier?: string | null;
  /** Digit prefixes (chapter, heading or full code) that count as correct. */
  acceptable: string[];
  prohibitedChapters: string[];
}

export interface SimulatedPick {
  code: string | null;
  label: ConfidenceLabel | null;
}

export interface PrecisionReport {
  total: number;
  strong: number;
  correct: number;
  precision: number;
  misses: Array<{ id: string; description: string; code: string; acceptable: string[] }>;
  /** Cases whose simulated pick returned no code; excluded from precision. */
  noCandidate: number;
  noCandidateIds: string[];
}

const digits = (s: string | null | undefined): string => String(s ?? "").replace(/\D/g, "");

function list(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function caseFromRow(r: TestCaseRow): PrecisionCase {
  const alternatives = list(r.acceptable_alternatives_json).map(digits).filter(Boolean);
  const primary = digits(r.expected_tariff) || digits(r.expected_heading);
  const acceptable = primary ? [primary, ...alternatives] : alternatives;
  if (!acceptable.length && digits(r.expected_chapter)) acceptable.push(digits(r.expected_chapter));
  return {
    id: `db-${r.id}`,
    description: r.raw_description,
    supplier: r.supplier,
    acceptable,
    prohibitedChapters: list(r.prohibited_chapters_json),
  };
}

export function caseFromGolden(g: ClassificationGolden): PrecisionCase {
  return {
    id: `golden-${g.id}`,
    description: g.description,
    clarification: g.clarification ?? null,
    consignee: g.consignee ?? null,
    acceptable: g.expectedHeadingPrefix ? [g.expectedHeadingPrefix] : [...g.expectedChapters],
    prohibitedChapters: g.prohibitedChapters,
  };
}

export function isAcceptable(code: string, c: PrecisionCase): boolean {
  const d = digits(code);
  if (c.prohibitedChapters.includes(d.slice(0, 2))) return false;
  return c.acceptable.some((prefix) => d.startsWith(prefix));
}

/** Worst case: the AI agrees with the database top pick, TTBizLink verifies it, and there is no history. */
export function simulateTopPick(c: PrecisionCase): SimulatedPick {
  const result = classifyHierarchically(c.description, c.clarification ?? null, {
    consignee: c.consignee ?? null,
    supplier: c.supplier ?? null,
  });
  const scored = result.candidates.filter((x) => Boolean(getNationalLine(x.code)));
  const top = scored[0];
  if (!top) return { code: null, label: null };
  const calibrated = calibrateCandidate(
    {
      code: top.code,
      description: top.description,
      chapter: top.chapter,
      dutyRate: 0,
      vatRate: 12.5,
      reason: "",
      source: "ai",
      officialVerification: { source: "ttbizlink", status: "verified", lookedUpAt: "", url: "" },
    },
    {
      familyResolved: familyResolvedFor(result.profile),
      descriptionCoverage: Number(result.profile.interpretationConfidence ?? 0.5),
      scored: scored.map((s) => ({ code: s.code, conflicts: s.conflicts ?? [] })),
      aiUsed: true,
      aiSelectedCode: top.code,
      aiConfidence: SIMULATED_AI_CONFIDENCE,
      history: null,
    },
    isProvisionalResult(result),
  );
  return { code: top.code, label: calibrated.confidenceLabel ?? null };
}

export function strongPrecision(
  cases: PrecisionCase[],
  pick: (c: PrecisionCase) => SimulatedPick = simulateTopPick,
): PrecisionReport {
  let strong = 0;
  let correct = 0;
  const misses: PrecisionReport["misses"] = [];
  const noCandidateIds: string[] = [];
  for (const c of cases) {
    const p = pick(c);
    if (!p.code) noCandidateIds.push(c.id);
    if (p.label !== "Strong Match" || !p.code) continue;
    strong += 1;
    if (isAcceptable(p.code, c)) correct += 1;
    else misses.push({ id: c.id, description: c.description, code: p.code, acceptable: c.acceptable });
  }
  return {
    total: cases.length,
    strong,
    correct,
    precision: strong ? correct / strong : 1,
    misses,
    noCandidate: noCandidateIds.length,
    noCandidateIds,
  };
}

export function formatReport(r: PrecisionReport): string {
  const head = `Strong precision ${(r.precision * 100).toFixed(1)}% (${r.correct}/${r.strong} Strong of ${r.total} cases)`;
  const skipped = r.noCandidate > 0
    ? [`  No candidate (excluded from precision): ${r.noCandidate} — ${r.noCandidateIds.join(", ")}`]
    : [];
  return [
    head,
    ...r.misses.map((m) => `  WRONG ${m.code} for "${m.description}" (expected ${m.acceptable.join(" | ")})`),
    ...skipped,
  ].join("\n");
}
