# Phase 2: Strict Strong Match, Calibrated Confidence, History First — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Strong Match" mean "safe to apply without looking": confidence comes from independent evidence instead of raw AI confidence, a clerk-approved history code is suggested first, and batch apply only applies lines that pass one strict rule.

**Architecture:** A pure `calibrateConfidence(evidence)` function in `packages/product-intelligence` turns a per-candidate evidence record into a score, label and plain-English signals. The worker recommendation route builds that evidence for every candidate (family/compatibility from the hierarchical classifier, AI-vs-database agreement, TTBizLink verification, description coverage, history agreement), looks up approved supplier history and learned codes first, and replaces `toConfidenceLabel`. The web gets one `isAutoApplyable(item, candidate)` rule used by batch apply, and the Classification workflow stage stops reporting "Needs review" after lines are applied.

**Tech Stack:** TypeScript, Cloudflare Workers + Hono + D1, React 18 + zustand, vitest (product-intelligence v2, worker v3, web hoisted).

**Spec:** `docs/superpowers/specs/2026-10-08-simplified-workflow-design.md` — section 2 "Single strong-match rule" and "Workflow status fix", section 3 items 1–2, section 5 unit tests. Rollout phase 2.

## Global Constraints

- Strong rule: `candidate.confidenceLabel === "Strong Match"` **and** `candidate.confidence >= 0.85`; not provisional; no pending clarification; status not `clarification_needed` / `unable_to_classify`; product family resolved and candidate passed compatibility (no contradictions) — or the code comes from approved history; no conflict with supplier history / learned code.
- The `recommendation_source === "ai_recommendation"` shortcut is removed from batch apply.
- `confidenceLabel` is derived from the calibrated score, never from raw model confidence.
- History first: exact approved supplier+description (or learned pair) short-circuits to that code as Strong.
- Classification stage is Complete when every line has an applied `tariff_code` and `classification_status` in `Applied | AI Applied | Clerk Edited` — independent of `source`. Lines without a `classification_status` that have a `tariff_code` and `source !== "ai"` (manual entry, learned) also count as classified.
- Never invent tariff codes: every suggested code must exist in the tariff database (`getNationalLine` or `tariffByCode`).
- "Recent clerk correction" penalty (spec 3.1) is covered by `historyConflict`: a clerk correction is saved as a learned pair, so any other code for that description is penalised and the corrected code is suggested first.
- Recommendations cached on lines before this phase have no `evidence`; they must never be auto-applyable (fail closed).
- Out of scope (later phases): concurrent generation, confirm modal, exceptions queue, More detail toggle, navigation, dedup, learning from corrections, golden ≥98% gate.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared-types/src/index.ts` (modify) | `CandidateEvidence` type; `evidence?` and `confidenceSignals?` on `ClassificationRecommendationCandidate`. |
| `packages/product-intelligence/src/confidence-calibration.ts` (create) | Pure `calibrateConfidence(evidence, { provisional })` → `{ score, label, signals }`; `STRONG_MATCH_THRESHOLD`. |
| `packages/product-intelligence/src/confidence-calibration.test.ts` (create) | Calibration signal/penalty tests. |
| `packages/product-intelligence/src/index.ts` (modify) | Export the above. |
| `apps/worker/src/lib/classification-history.ts` (create) | `findHistoryCode(db, supplier, description)` — approved supplier history, then learned; uses the same normalisers that write those tables. |
| `apps/worker/src/lib/classification-history.test.ts` (create) | Lookup order and normalisation tests with a fake D1. |
| `apps/worker/src/lib/candidate-evidence.ts` (create) | Pure `buildCandidateEvidence(candidate, ctx)` and `calibrateCandidate(candidate, ctx, provisional)`. |
| `apps/worker/src/lib/candidate-evidence.test.ts` (create) | Evidence derivation tests. |
| `apps/worker/src/routes/classification-lines.ts` (modify) | History-first short-circuit; calibrate every candidate; remove `toConfidenceLabel`. |
| `apps/web/src/features/review/classification-helpers.ts` (modify) | `isAutoApplyable(item, candidate)`. |
| `apps/web/src/features/review/classification-helpers.test.ts` (create) | Strong rule tests. |
| `apps/web/src/features/review/ClassificationWorkspace.tsx` (modify) | `batchApply` and `selectedCanBatchApply` use `isAutoApplyable`. |
| `apps/web/src/lib/workflow-pipeline.ts` (modify) | `isLineClassified(item)`; stage and queue status use it. |
| `apps/web/src/lib/workflow-pipeline.test.ts` (create) | Stage rule tests. |

Test commands:
- product-intelligence: `npx vitest run src/confidence-calibration.test.ts` from `packages/product-intelligence`
- worker: `npx vitest run src/lib/<file>.test.ts` from `apps/worker`
- web: `npx vitest run src/<path>.test.ts` from `apps/web` (`@/` resolves via `vite.config.ts`)
- full: `npm run typecheck` and `npm test` from repo root. Revert `apps/web/tsconfig.tsbuildinfo` if typecheck modifies it.

---

### Task 1: Evidence type and confidence calibration

**Files:**
- Modify: `packages/shared-types/src/index.ts:270-290`
- Create: `packages/product-intelligence/src/confidence-calibration.ts`
- Create: `packages/product-intelligence/src/confidence-calibration.test.ts`
- Modify: `packages/product-intelligence/src/index.ts` (append export)

**Interfaces:**
- Produces:
  - `type CandidateEvidence` (shared-types), fields exactly as below.
  - `ClassificationRecommendationCandidate.evidence?: CandidateEvidence`, `.confidenceSignals?: string[]`.
  - `calibrateConfidence(evidence: CandidateEvidence, opts?: { provisional?: boolean }): { score: number; label: ConfidenceLabel; signals: string[] }` (product-intelligence).
  - `STRONG_MATCH_THRESHOLD = 0.85` (product-intelligence).

- [ ] **Step 1: Add the shared type**

In `packages/shared-types/src/index.ts`, directly above `export interface ClassificationRecommendationCandidate`, add:

```ts
/** Independent evidence behind one suggested tariff code; drives calibrated confidence. */
export interface CandidateEvidence {
  /** Code comes from clerk-approved memory for this supplier/description. */
  historyMatch: "supplier_history" | "learned" | "supplier_evidence" | null;
  /** Product family identified with confidence (hard heading gate, family confidence >= 0.85, or fast path). */
  familyResolved: boolean;
  /** Candidate survived the compatibility filter with no conflicts. */
  compatibilityPassed: boolean;
  /** Conflicts reported by the classifier for this code. */
  contradictions: string[];
  /** 0-based position in database retrieval ranking; null when not retrieved. */
  retrievalRank: number | null;
  /** The AI reranker picked this code. */
  aiSelected: boolean;
  /** AI confidence for this code (only when aiSelected). */
  aiConfidence: number | null;
  /** AI pick equals the database's top candidate; null when AI was not used. */
  dbTopAgrees: boolean | null;
  /** TTBizLink returned a fresh "verified" result. */
  officialVerified: boolean;
  /** How well the description was understood, 0–1 (profile interpretationConfidence). */
  descriptionCoverage: number;
  /** An approved history/learned code exists for this line and it differs from this code. */
  historyConflict: boolean;
}
```

Inside `ClassificationRecommendationCandidate`, after `provisional?: boolean;`, add:

```ts
  evidence?: CandidateEvidence;
  /** Plain-English reasons for the confidence, e.g. "Matches approved supplier history". */
  confidenceSignals?: string[];
```

- [ ] **Step 2: Write the failing tests**

Create `packages/product-intelligence/src/confidence-calibration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CandidateEvidence } from "@pas/shared-types";
import { calibrateConfidence, STRONG_MATCH_THRESHOLD } from "./confidence-calibration";

const base: CandidateEvidence = {
  historyMatch: null,
  familyResolved: false,
  compatibilityPassed: false,
  contradictions: [],
  retrievalRank: null,
  aiSelected: false,
  aiConfidence: null,
  dbTopAgrees: null,
  officialVerified: false,
  descriptionCoverage: 0.8,
  historyConflict: false,
};

const fullyCorroborated: CandidateEvidence = {
  ...base,
  familyResolved: true,
  compatibilityPassed: true,
  retrievalRank: 0,
  aiSelected: true,
  aiConfidence: 0.9,
  dbTopAgrees: true,
  officialVerified: true,
};

describe("calibrateConfidence", () => {
  it("treats approved history as Strong", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "supplier_history" });
    expect(r.label).toBe("Strong Match");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.signals).toContain("Matches approved supplier history");
  });

  it("does not trust history that the classifier contradicts", () => {
    const r = calibrateConfidence({ ...base, historyMatch: "learned", contradictions: ["Chapter 22 is excluded"] });
    expect(r.label).not.toBe("Strong Match");
  });

  it("rates a fully corroborated AI pick as Strong", () => {
    const r = calibrateConfidence(fullyCorroborated);
    expect(r.label).toBe("Strong Match");
    expect(r.score).toBeGreaterThanOrEqual(STRONG_MATCH_THRESHOLD);
  });

  it("does not let raw AI confidence alone reach Strong", () => {
    const r = calibrateConfidence({ ...base, aiSelected: true, aiConfidence: 0.99, retrievalRank: 0, dbTopAgrees: true });
    expect(r.label).not.toBe("Strong Match");
  });

  it("needs official verification for a non-history Strong", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, officialVerified: false });
    expect(r.label).toBe("Likely Match");
  });

  it("penalises AI disagreeing with the database", () => {
    const agree = calibrateConfidence(fullyCorroborated).score;
    const disagree = calibrateConfidence({ ...fullyCorroborated, dbTopAgrees: false }).score;
    expect(disagree).toBeLessThan(agree - 0.2);
    expect(calibrateConfidence({ ...fullyCorroborated, dbTopAgrees: false }).signals)
      .toContain("AI disagrees with the tariff database ranking");
  });

  it("penalises vague descriptions", () => {
    const r = calibrateConfidence({ ...fullyCorroborated, descriptionCoverage: 0.3 });
    expect(r.label).not.toBe("Strong Match");
    expect(r.signals).toContain("Description is vague");
  });

  it("penalises contradictions and history conflicts", () => {
    expect(calibrateConfidence({ ...fullyCorroborated, contradictions: ["x"] }).label).not.toBe("Strong Match");
    expect(calibrateConfidence({ ...fullyCorroborated, historyConflict: true }).label).not.toBe("Strong Match");
  });

  it("caps provisional candidates below Possible", () => {
    const r = calibrateConfidence(fullyCorroborated, { provisional: true });
    expect(r.label).toBe("More Information Needed");
    expect(r.score).toBeLessThan(0.45);
  });

  it("rates a retrieval-only top hit with a resolved family as Likely at best", () => {
    const r = calibrateConfidence({ ...base, familyResolved: true, compatibilityPassed: true, retrievalRank: 0 });
    expect(["Likely Match", "Possible Match"]).toContain(r.label);
  });

  it("keeps scores within 0..0.98", () => {
    const hi = calibrateConfidence({ ...fullyCorroborated, historyMatch: "supplier_history" }).score;
    const lo = calibrateConfidence({ ...base, dbTopAgrees: false, descriptionCoverage: 0, contradictions: ["a"], historyConflict: true }).score;
    expect(hi).toBeLessThanOrEqual(0.98);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `packages/product-intelligence`): `npx vitest run src/confidence-calibration.test.ts`
Expected: FAIL — cannot resolve `./confidence-calibration`.

- [ ] **Step 4: Implement**

Create `packages/product-intelligence/src/confidence-calibration.ts`:

```ts
import type { CandidateEvidence, ConfidenceLabel } from "@pas/shared-types";

export const STRONG_MATCH_THRESHOLD = 0.85;
const LIKELY_THRESHOLD = 0.6;
const POSSIBLE_THRESHOLD = 0.45;
const HISTORY_SCORE = 0.96;
const MAX_SCORE = 0.98;
const VAGUE_COVERAGE = 0.5;

const HISTORY_SIGNAL: Record<NonNullable<CandidateEvidence["historyMatch"]>, string> = {
  supplier_history: "Matches approved supplier history",
  learned: "Matches a code the team approved before",
  supplier_evidence: "Matches approved supplier product record",
};

export function labelForScore(score: number): ConfidenceLabel {
  if (score >= STRONG_MATCH_THRESHOLD) return "Strong Match";
  if (score >= LIKELY_THRESHOLD) return "Likely Match";
  if (score >= POSSIBLE_THRESHOLD) return "Possible Match";
  return "More Information Needed";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function calibrateConfidence(
  evidence: CandidateEvidence,
  opts: { provisional?: boolean } = {},
): { score: number; label: ConfidenceLabel; signals: string[] } {
  const signals: string[] = [];
  const contradicted = evidence.contradictions.length > 0;
  let score: number;

  if (evidence.historyMatch && !contradicted && !evidence.historyConflict) {
    score = HISTORY_SCORE;
    signals.push(HISTORY_SIGNAL[evidence.historyMatch]);
  } else {
    score = 0.3;
    if (evidence.historyMatch) signals.push(HISTORY_SIGNAL[evidence.historyMatch]);
    if (evidence.familyResolved && evidence.compatibilityPassed) {
      score += 0.2;
      signals.push("Product family identified and code is compatible");
    }
    if (evidence.dbTopAgrees === true) {
      score += 0.15;
      signals.push("AI and tariff database agree");
    } else if (evidence.dbTopAgrees === false) {
      score -= 0.15;
      signals.push("AI disagrees with the tariff database ranking");
    } else if (evidence.retrievalRank === 0) {
      score += 0.1;
      signals.push("Top tariff database match");
    }
    if (evidence.aiSelected && evidence.aiConfidence != null) {
      score += 0.2 * clamp(evidence.aiConfidence, 0, 1);
    }
    if (evidence.officialVerified) {
      score += 0.1;
      signals.push("Verified on TTBizLink");
    }
  }

  if (evidence.descriptionCoverage < VAGUE_COVERAGE) {
    score -= 0.15;
    signals.push("Description is vague");
  }
  if (contradicted) {
    score -= 0.3;
    signals.push("Classifier found a conflict with this code");
  }
  if (evidence.historyConflict) {
    score -= 0.25;
    signals.push("Differs from the code approved before for this item");
  }

  score = clamp(score, 0, MAX_SCORE);
  if (opts.provisional) {
    score = Math.min(score, POSSIBLE_THRESHOLD - 0.01);
    signals.push("Missing product details");
  }
  score = Math.round(score * 100) / 100;
  return { score, label: labelForScore(score), signals };
}
```

Append to `packages/product-intelligence/src/index.ts`:

```ts
export {
  calibrateConfidence,
  labelForScore,
  STRONG_MATCH_THRESHOLD,
} from "./confidence-calibration";
```

Note: history with vague description scores 0.96 − 0.15 = 0.81 (Likely). That is intended: a vague description matching history text exactly is still history, but the history short-circuit (Task 3) sets `descriptionCoverage` to 1 because an exact approved description match is itself full understanding. Keep the penalty generic here.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/confidence-calibration.test.ts` — Expected: PASS (11 tests). Then `npm test` in `packages/product-intelligence` — all existing tests still pass.

- [ ] **Step 6: Typecheck and commit**

Run from repo root: `npm run typecheck` — exit 0.

```bash
git add packages/shared-types/src/index.ts packages/product-intelligence/src/confidence-calibration.ts packages/product-intelligence/src/confidence-calibration.test.ts packages/product-intelligence/src/index.ts
git commit -m "feat(product-intelligence): evidence-based confidence calibration"
```

---

### Task 2: History lookup and candidate evidence (worker libs)

**Files:**
- Create: `apps/worker/src/lib/classification-history.ts`
- Create: `apps/worker/src/lib/classification-history.test.ts`
- Create: `apps/worker/src/lib/candidate-evidence.ts`
- Create: `apps/worker/src/lib/candidate-evidence.test.ts`

**Interfaces:**
- Consumes: `CandidateEvidence`, `ClassificationRecommendationCandidate` (shared-types); `calibrateConfidence` (product-intelligence); `normalizeDesc`, `normalizeSupplierName` (`@pas/tariff-data` — confirm they are exported from the package index; if not, add them to `packages/tariff-data/src/index.ts` exports).
- Produces:
  - `interface HistoryHit { code: string; source: "supplier_history" | "learned" }`
  - `findHistoryCode(db: HistoryDb, supplier: string, description: string): Promise<HistoryHit | null>`
  - `type HistoryDb = Pick<D1Database, "prepare">` (structural; the fake in tests implements `prepare().bind().first()`)
  - `interface EvidenceContext { familyResolved: boolean; descriptionCoverage: number; scored: Array<{ code: string; conflicts: string[] }>; aiUsed: boolean; aiSelectedCode: string | null; aiConfidence: number | null; history: { code: string; source: CandidateEvidence["historyMatch"] } | null }`
  - `buildCandidateEvidence(candidate: ClassificationRecommendationCandidate, ctx: EvidenceContext): CandidateEvidence`
  - `calibrateCandidate(candidate: ClassificationRecommendationCandidate, ctx: EvidenceContext, provisional: boolean): ClassificationRecommendationCandidate` — returns a copy with `evidence`, `confidence`, `confidenceLabel`, `confidenceSignals` set.

- [ ] **Step 1: Write the failing history tests**

Create `apps/worker/src/lib/classification-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findHistoryCode, type HistoryDb } from "./classification-history";

type Row = Record<string, unknown>;

function fakeDb(rows: { history?: Row[]; learned?: Row[] }): HistoryDb & { queries: string[]; binds: unknown[][] } {
  const queries: string[] = [];
  const binds: unknown[][] = [];
  return {
    queries,
    binds,
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind(...args: unknown[]) {
          binds.push(args);
          return {
            async first<T>() {
              if (sql.includes("supplier_classification_history")) {
                return (rows.history?.find((r) => r.normalized_supplier_name === args[0] && r.normalized_description === args[1]) ?? null) as T | null;
              }
              if (sql.includes("FROM learned")) {
                return (rows.learned?.find((r) => r.normalized_desc === args[0]) ?? null) as T | null;
              }
              return null;
            },
          };
        },
      };
    },
  } as unknown as HistoryDb & { queries: string[]; binds: unknown[][] };
}

describe("findHistoryCode", () => {
  it("prefers approved supplier history over learned pairs", async () => {
    const db = fakeDb({
      history: [{ normalized_supplier_name: "acme", normalized_description: "steel bolts m8", hs_code: "7318.15.00" }],
      learned: [{ normalized_desc: "steel bolts m8", tariff_code: "7318.16.00" }],
    });
    await expect(findHistoryCode(db, "ACME Ltd.", "Steel Bolts, M8")).resolves.toEqual({
      code: "7318.15.00",
      source: "supplier_history",
    });
  });

  it("only reads approved, enabled history rows", async () => {
    const db = fakeDb({});
    await findHistoryCode(db, "Acme", "bolts");
    expect(db.queries[0]).toMatch(/approved_by_clerk\s*=\s*1/);
    expect(db.queries[0]).toMatch(/disabled\s*=\s*0/);
  });

  it("falls back to a learned pair when there is no supplier history", async () => {
    const db = fakeDb({ learned: [{ normalized_desc: "steel bolts m8", tariff_code: "7318.16.00" }] });
    await expect(findHistoryCode(db, "Unknown Co", "Steel Bolts, M8")).resolves.toEqual({
      code: "7318.16.00",
      source: "learned",
    });
  });

  it("skips the supplier query when there is no supplier", async () => {
    const db = fakeDb({ learned: [{ normalized_desc: "bolts", tariff_code: "7318.16.00" }] });
    await expect(findHistoryCode(db, "", "Bolts")).resolves.toEqual({ code: "7318.16.00", source: "learned" });
    expect(db.queries.some((q) => q.includes("supplier_classification_history"))).toBe(false);
  });

  it("returns null when nothing matches or the description is empty", async () => {
    await expect(findHistoryCode(fakeDb({}), "Acme", "bolts")).resolves.toBeNull();
    await expect(findHistoryCode(fakeDb({}), "Acme", "   ")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `apps/worker`): `npx vitest run src/lib/classification-history.test.ts`
Expected: FAIL — cannot resolve `./classification-history`.

- [ ] **Step 3: Implement the history lookup**

Create `apps/worker/src/lib/classification-history.ts`:

```ts
import type { D1Database } from "@cloudflare/workers-types";
import { normalizeDesc, normalizeSupplierName } from "@pas/tariff-data";

export type HistoryDb = Pick<D1Database, "prepare">;

export interface HistoryHit {
  code: string;
  source: "supplier_history" | "learned";
}

/** Clerk-approved code for this exact supplier + description, then for the description alone. */
export async function findHistoryCode(
  db: HistoryDb,
  supplier: string,
  description: string,
): Promise<HistoryHit | null> {
  const desc = normalizeDesc(description);
  if (!desc) return null;

  const supplierKey = supplier.trim() ? normalizeSupplierName(supplier) : "";
  if (supplierKey) {
    const row = await db
      .prepare(
        `SELECT hs_code FROM supplier_classification_history
         WHERE normalized_supplier_name = ? AND normalized_description = ?
           AND approved_by_clerk = 1 AND disabled = 0
         ORDER BY usage_count DESC, updated_at DESC LIMIT 1`,
      )
      .bind(supplierKey, desc)
      .first<{ hs_code: string }>();
    if (row?.hs_code) return { code: row.hs_code, source: "supplier_history" };
  }

  const learned = await db
    .prepare("SELECT tariff_code FROM learned WHERE normalized_desc = ? LIMIT 1")
    .bind(desc)
    .first<{ tariff_code: string }>();
  if (learned?.tariff_code) return { code: learned.tariff_code, source: "learned" };
  return null;
}
```

If `normalizeDesc` / `normalizeSupplierName` are not exported from `@pas/tariff-data`'s index, add `export { normalizeDesc } from "./search";` and `export { normalizeSupplierName } from "./supplier-search";` there (check for an existing `export *` first).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/classification-history.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing evidence tests**

Create `apps/worker/src/lib/candidate-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ClassificationRecommendationCandidate } from "@pas/shared-types";
import { buildCandidateEvidence, calibrateCandidate, type EvidenceContext } from "./candidate-evidence";

function cand(code: string, verified = false): ClassificationRecommendationCandidate {
  return {
    code,
    description: "d",
    chapter: code.slice(0, 2),
    dutyRate: 20,
    vatRate: 12.5,
    reason: "r",
    source: "ai",
    confidence: 0.99,
    confidenceLabel: "Strong Match",
    ...(verified
      ? { officialVerification: { source: "ttbizlink", status: "verified", lookedUpAt: "now", url: "u" } as const }
      : {}),
  };
}

const ctx: EvidenceContext = {
  familyResolved: true,
  descriptionCoverage: 0.9,
  scored: [
    { code: "6109.10.00", conflicts: [] },
    { code: "6205.20.00", conflicts: ["Woven shirt, not knitted"] },
  ],
  aiUsed: true,
  aiSelectedCode: "6109.10.00",
  aiConfidence: 0.9,
  history: null,
};

describe("buildCandidateEvidence", () => {
  it("derives agreement, rank, compatibility and verification for the AI pick", () => {
    const e = buildCandidateEvidence(cand("6109.10.00", true), ctx);
    expect(e).toMatchObject({
      historyMatch: null,
      familyResolved: true,
      compatibilityPassed: true,
      contradictions: [],
      retrievalRank: 0,
      aiSelected: true,
      aiConfidence: 0.9,
      dbTopAgrees: true,
      officialVerified: true,
      historyConflict: false,
    });
  });

  it("matches codes regardless of spacing and case", () => {
    expect(buildCandidateEvidence(cand("6109 10 00"), ctx).retrievalRank).toBe(0);
  });

  it("marks alternatives as not AI-selected and carries their conflicts", () => {
    const e = buildCandidateEvidence(cand("6205.20.00"), ctx);
    expect(e.aiSelected).toBe(false);
    expect(e.aiConfidence).toBeNull();
    expect(e.compatibilityPassed).toBe(false);
    expect(e.contradictions).toEqual(["Woven shirt, not knitted"]);
  });

  it("reports AI disagreement with the database top candidate", () => {
    const e = buildCandidateEvidence(cand("6205.20.00"), { ...ctx, aiSelectedCode: "6205.20.00" });
    expect(e.dbTopAgrees).toBe(false);
  });

  it("leaves agreement unknown when AI was not used", () => {
    const e = buildCandidateEvidence(cand("6109.10.00"), { ...ctx, aiUsed: false, aiSelectedCode: null, aiConfidence: null });
    expect(e.dbTopAgrees).toBeNull();
    expect(e.aiSelected).toBe(false);
  });

  it("treats a code that was not retrieved as not compatibility-checked", () => {
    const e = buildCandidateEvidence(cand("9999.99.99"), ctx);
    expect(e.retrievalRank).toBeNull();
    expect(e.compatibilityPassed).toBe(false);
  });

  it("flags history match and history conflict", () => {
    const history = { code: "6109.10.00", source: "supplier_history" as const };
    expect(buildCandidateEvidence(cand("6109.10.00"), { ...ctx, history }).historyMatch).toBe("supplier_history");
    expect(buildCandidateEvidence(cand("6205.20.00"), { ...ctx, history }).historyConflict).toBe(true);
  });

  it("does not count cached TTBizLink results as verified", () => {
    const c = cand("6109.10.00");
    c.officialVerification = { source: "ttbizlink", status: "cached", lookedUpAt: "now", url: "u" };
    expect(buildCandidateEvidence(c, ctx).officialVerified).toBe(false);
  });
});

describe("calibrateCandidate", () => {
  it("replaces raw AI confidence with the calibrated score and label", () => {
    const out = calibrateCandidate(cand("6205.20.00"), ctx, false);
    expect(out.confidence).toBeLessThan(0.85);
    expect(out.confidenceLabel).not.toBe("Strong Match");
    expect(out.evidence?.contradictions).toEqual(["Woven shirt, not knitted"]);
    expect(out.confidenceSignals?.length).toBeGreaterThan(0);
  });

  it("does not mutate the input candidate", () => {
    const input = cand("6109.10.00", true);
    calibrateCandidate(input, ctx, false);
    expect(input.evidence).toBeUndefined();
    expect(input.confidence).toBe(0.99);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/lib/candidate-evidence.test.ts` — Expected: FAIL — cannot resolve `./candidate-evidence`.

- [ ] **Step 7: Implement**

Create `apps/worker/src/lib/candidate-evidence.ts`:

```ts
import type { CandidateEvidence, ClassificationRecommendationCandidate } from "@pas/shared-types";
import { calibrateConfidence } from "@pas/product-intelligence";

export interface EvidenceContext {
  familyResolved: boolean;
  descriptionCoverage: number;
  /** Database retrieval ranking after the compatibility filter, best first. */
  scored: Array<{ code: string; conflicts: string[] }>;
  aiUsed: boolean;
  aiSelectedCode: string | null;
  aiConfidence: number | null;
  history: { code: string; source: CandidateEvidence["historyMatch"] } | null;
}

function key(code: string): string {
  return code.replace(/\s/g, "").toUpperCase();
}

export function buildCandidateEvidence(
  candidate: ClassificationRecommendationCandidate,
  ctx: EvidenceContext,
): CandidateEvidence {
  const code = key(candidate.code);
  const rank = ctx.scored.findIndex((s) => key(s.code) === code);
  const hit = rank >= 0 ? ctx.scored[rank] : null;
  const contradictions = hit?.conflicts ?? [];
  const aiSelected = ctx.aiUsed && ctx.aiSelectedCode != null && key(ctx.aiSelectedCode) === code;
  const dbTop = ctx.scored[0] ? key(ctx.scored[0].code) : null;
  const historyCode = ctx.history ? key(ctx.history.code) : null;
  return {
    historyMatch: historyCode === code ? ctx.history!.source : null,
    familyResolved: ctx.familyResolved,
    compatibilityPassed: hit != null && contradictions.length === 0,
    contradictions,
    retrievalRank: rank >= 0 ? rank : null,
    aiSelected,
    aiConfidence: aiSelected ? ctx.aiConfidence : null,
    dbTopAgrees: ctx.aiUsed && ctx.aiSelectedCode != null && dbTop != null ? key(ctx.aiSelectedCode) === dbTop : null,
    officialVerified: candidate.officialVerification?.status === "verified",
    descriptionCoverage: ctx.descriptionCoverage,
    historyConflict: historyCode != null && historyCode !== code,
  };
}

export function calibrateCandidate(
  candidate: ClassificationRecommendationCandidate,
  ctx: EvidenceContext,
  provisional: boolean,
): ClassificationRecommendationCandidate {
  const evidence = buildCandidateEvidence(candidate, ctx);
  const { score, label, signals } = calibrateConfidence(evidence, { provisional });
  return { ...candidate, evidence, confidence: score, confidenceLabel: label, confidenceSignals: signals };
}
```

Note: `dbTopAgrees` is a property of the request (did the AI pick the database's top code?). It is the same for every candidate; `calibrateConfidence` only rewards it for `aiSelected` via the score path, and alternatives never reach Strong without history because they lack `aiConfidence` and usually verification.

- [ ] **Step 8: Run to verify pass, then commit**

Run: `npx vitest run src/lib/candidate-evidence.test.ts src/lib/classification-history.test.ts` — PASS. Then `npm test` in `apps/worker` — all pass. Repo-root `npm run typecheck` — exit 0.

```bash
git add apps/worker/src/lib/classification-history.ts apps/worker/src/lib/classification-history.test.ts apps/worker/src/lib/candidate-evidence.ts apps/worker/src/lib/candidate-evidence.test.ts
# plus packages/tariff-data/src/index.ts if exports were added
git commit -m "feat(worker): history lookup and per-candidate evidence for calibrated confidence"
```

---

### Task 3: Wire history-first and calibration into the recommendation route

**Files:**
- Modify: `apps/worker/src/routes/classification-lines.ts` (route `lines.post("/:lineId/recommendation")`, approx. lines 361–1013; helpers at 46–75 and 186–225)

**Interfaces:**
- Consumes: `findHistoryCode` (Task 2), `calibrateCandidate`, `EvidenceContext` (Task 2).
- Produces: every candidate in the recommendation response carries `evidence`, calibrated `confidence`, `confidenceLabel`, `confidenceSignals`. When approved history exists for the line, `recommendations[0]` is the history code with `evidence.historyMatch` set and the response `status` is `"recommended"`.

This route has no unit-test harness; correctness is covered by Task 2's tests, typecheck, and the manual smoke check in Step 7.

- [ ] **Step 1: Remove raw-confidence labelling from helpers**

Delete `toConfidenceLabel` (lines 46–51) and stop `mapCandidate` from setting a label; the label is set only by calibration. Replace `mapCandidate` with:

```ts
function mapCandidate(
  candidate: HeadingCandidate,
  reason: string,
  confidence?: number,
  provisional = false,
): ClassificationRecommendationCandidate {
  const tariff = tariffByCode.get(normalizedCode(candidate.hs_code));
  const code = tariff?.code || candidate.hs_code;
  const score = Number.isFinite(confidence) ? Number(confidence) : candidate.score || 0.4;
  return {
    code,
    description: tariff?.desc || candidate.title,
    chapter: code.replace(/\D/g, "").slice(0, 2),
    dutyRate: percent(tariff?.duty || candidate.duty_rate),
    vatRate: 12.5,
    levyRate: 0,
    reason,
    source: "ai",
    confidence: score,
    provisional,
  };
}
```

In `packResponse`, replace the `confidenceLabel` fallback so uncalibrated candidates (error-recovery path) can never be Strong:

```ts
  const recommendations = input.recommendations.slice(0, 3).map((candidate) => ({
    ...candidate,
    provisional: statusIsProvisional,
    confidenceLabel: candidate.confidenceLabel
      ?? (statusIsProvisional ? "Possible Match" : "Likely Match"),
  }));
```

Remove `ConfidenceLabel` from the shared-types import if it becomes unused.

- [ ] **Step 2: Add imports**

```ts
import { findHistoryCode } from "../lib/classification-history";
import { calibrateCandidate, type EvidenceContext } from "../lib/candidate-evidence";
```

- [ ] **Step 3: Build the evidence context once per request**

Immediately after the `familyKnown` constant (around line 577), add:

```ts
  const historyHit = await findHistoryCode(c.env.DB, supplierName, body.originalDescription).catch(() => null);
  const supplierApprovedTariff = supplierSearch.status === "exact_internal"
    ? String(supplierSearch.evidence?.technicalSpecifications?.approvedTariff || "") || null
    : null;
  const history: EvidenceContext["history"] = historyHit
    ? { code: historyHit.code, source: historyHit.source }
    : supplierApprovedTariff
      ? { code: supplierApprovedTariff, source: "supplier_evidence" }
      : null;
  const evidenceBase: Omit<EvidenceContext, "aiUsed" | "aiSelectedCode" | "aiConfidence"> = {
    familyResolved: familyKnown,
    descriptionCoverage: Number(hierarchical.profile.interpretationConfidence ?? 0.5),
    scored: scored.map((s) => ({ code: s.code, conflicts: s.conflicts ?? [] })),
    history,
  };
```

- [ ] **Step 4: History-first short-circuit**

Directly after the `engineQuestion` constant and **before** `if (!candidates.length) {`, add:

```ts
  const historyTariff = history
    ? getNationalLine(history.code) || tariffByCode.get(normalizedCode(history.code))
    : null;
  if (history && historyTariff) {
    const historyCandidate: HeadingCandidate = {
      hs_code: history.code,
      heading: normalizedCode(history.code).slice(0, 4),
      title: tariffByCode.get(normalizedCode(history.code))?.desc || "",
      score: 0.96,
      duty_rate: tariffByCode.get(normalizedCode(history.code))?.duty,
    };
    const alternatives = candidates
      .filter((h) => normalizedCode(h.hs_code) !== normalizedCode(history.code))
      .slice(0, 2);
    const historyCtx: EvidenceContext = {
      ...evidenceBase,
      descriptionCoverage: 1,
      aiUsed: false,
      aiSelectedCode: null,
      aiConfidence: null,
    };
    const mapped = [
      mapCandidate(historyCandidate, "Approved for this item before.", 0.96, false),
      ...alternatives.map((h) => mapCandidate(h, scored.find((s) => normalizedCode(s.code) === normalizedCode(h.hs_code))?.supportingFacts?.[0] || "Alternative retrieved tariff candidate.", h.score, false)),
    ];
    const verified = await Promise.all(mapped.map((cand) => verifyCandidateWithTtbizlink(c.env.DB, cand)));
    const calibrated = verified.filter(Boolean).map((cand) => calibrateCandidate(cand, historyCtx, false));
    return persistAndRespond({
      status: calibrated[0]?.confidenceLabel === "Strong Match" ? "recommended" : "provisional",
      recommendations: calibrated,
      question: null,
      warnings: [...warnings, "Suggested from approved history for this item."],
    });
  }
```

`persistAndRespond` is created in Step 5. Check the actual type of `tariffByCode` values (`desc`, `duty`) and of `HeadingCandidate.duty_rate` and adjust field access to match; do not change their definitions.

- [ ] **Step 5: Extract `persistAndRespond` from the existing non-AI branch**

The no-AI branch (approx. lines 905–955) builds a response with `packResponse`, patches `productProfile`, inserts into `classification_recommendations`, updates `classification_lines`, and returns `c.json(response)`. Move that body into a local function defined right after `supplierEvidencePayload` is built (around line 682), and use it from the history branch, the AI branch, and the no-AI branch:

```ts
  const persistAndRespond = async (input: {
    status: SimpleRecommendationStatus;
    recommendations: ClassificationRecommendationCandidate[];
    question: ClassificationClarificationQuestion | null;
    warnings: string[];
  }) => {
    if (supplierSearch.notification) input.warnings.push(supplierSearch.notification);
    const response = packResponse({
      status: input.status,
      interpretation,
      recommendations: input.recommendations,
      question: input.question,
      warnings: input.warnings,
      supplierEvidence: supplierEvidencePayload,
      supplierSearchStatus: supplierSearch.status,
      supplierSearchNotification: supplierSearch.notification || null,
    });
    response.productProfile = {
      ...response.productProfile!,
      identifiedItem: hierarchical.profile.canonicalProduct,
      material: hierarchical.profile.material || response.productProfile!.material,
      productFamily: hierarchical.profile.productFamily || response.productProfile!.productFamily,
      primaryUse: hierarchical.profile.primaryFunction || response.productProfile!.primaryUse,
    };
    await c.env.DB.prepare(
      `INSERT INTO classification_recommendations
        (line_id, status, recommended_candidate_json, alternatives_json, product_profile_json,
         resolution_id, evidence_ids_json, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        lineId,
        response.status,
        JSON.stringify(response.recommendations?.[0] || null),
        JSON.stringify(response.recommendations?.slice(1) || []),
        JSON.stringify({
          ...response.productProfile,
          classificationProfile: hierarchical.profile,
          chapters: hierarchical.chapters,
          retrievalTrace: hierarchical.retrievalTrace,
          supplierEvidence: supplierEvidencePayload,
        }),
        body.resolutionId || null,
        JSON.stringify(body.evidenceIds || []),
        c.var.username,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = ?, product_profile_json = ?, updated_at = datetime('now') WHERE line_id = ?`,
    )
      .bind(
        response.status === "clarification_needed" ? "More Information Needed" : "Suggestion Ready",
        JSON.stringify(profileFromEngine),
        lineId,
      )
      .run();
    return c.json(response);
  };
```

Because `persistAndRespond` is used in the history branch (Step 4), define it **before** the history branch: move the `supplierEvidencePayload` construction up so both precede Step 4's block. Keep the AI branch's extra `console.log` and `audit(c, "classification_recommendation_generated")` calls before it returns `persistAndRespond(...)`. Behaviour preserved: the stored candidate JSON becomes the packed (post-`packResponse`) candidates, which now include `evidence`.

- [ ] **Step 6: Calibrate in the AI and no-AI branches**

AI branch — after `verified` is computed (approx. line 809), replace the use of `verified` with calibrated candidates. `selected` is the chosen `HeadingCandidate`; `parsed` is the AI JSON or null:

```ts
      const aiCtx: EvidenceContext = {
        ...evidenceBase,
        aiUsed: Boolean(parsed),
        aiSelectedCode: parsed && rawSelected && selected ? selected.hs_code : null,
        aiConfidence: Number.isFinite(parsed?.confidence) ? Number(parsed!.confidence) : null,
      };
      const candidateProvisional = provisional || selectedConfidence < 0.55 || !parsed;
      const calibrated = verified.map((cand) => calibrateCandidate(cand, aiCtx, candidateProvisional));
```

Note `selected` is reassigned to `candidates[0]` when the AI abstains; `aiSelectedCode` must be `null` in that case — use a boolean captured **before** that fallback, e.g. `const aiPicked = Boolean(selected);` right after the invalid-code rejection block, and `aiSelectedCode: aiPicked ? selected!.hs_code : null`.

Then pass `calibrated` (not `verified`) into `persistAndRespond({ status, recommendations: calibrated, question, warnings })`, and log `calibrated.map((e) => e.code)`.

No-AI branch — after `verified` (approx. line 901):

```ts
    const noAiCtx: EvidenceContext = { ...evidenceBase, aiUsed: false, aiSelectedCode: null, aiConfidence: null };
    const calibrated = verified.map((cand) => calibrateCandidate(cand, noAiCtx, !skipAiForExactInternal || Boolean(question && provisional)));
    return persistAndRespond({
      status: question && provisional ? "clarification_needed" : skipAiForExactInternal ? "recommended" : "provisional",
      recommendations: calibrated,
      question,
      warnings,
    });
```

(The `skipAiForExactInternal` path is normally caught earlier by the history short-circuit, because `supplier_evidence` history is set from the same approved tariff.)

The error-recovery `catch` branch is unchanged except that `mapCandidate` no longer sets a label; `packResponse` gives those candidates `Possible`/`Likely`, never Strong.

- [ ] **Step 7: Verify**

1. Repo-root `npm run typecheck` — exit 0. `npm test` — all pass. Revert `apps/web/tsconfig.tsbuildinfo` if modified.
2. Grep: `toConfidenceLabel` has no matches in `apps/worker/src`.
3. Smoke (local): `npm run dev:worker` (requires `.dev.vars` with `ENVIRONMENT=development`), seed a user via `POST /api/auth/seed` with BOM-free JSON, sign in, create a classification line the way the web does (inspect `api.saveClassificationLine` / route `lines.post("/")` for the body), then `POST /api/classification-lines/:lineId/recommendation` with `{ "originalDescription": "cotton t-shirts" }`. Expected: every `recommendations[i]` has `evidence` and `confidenceSignals`; no candidate is `Strong Match` unless its `evidence.historyMatch` is set or it has `familyResolved`, `compatibilityPassed`, `dbTopAgrees`, and `officialVerified` all true. Then insert a learned pair locally (`npx wrangler d1 execute pas-trinidad --local --command "INSERT OR REPLACE INTO learned (normalized_desc, tariff_code, duty_rate, category, uses, learned_at, updated_by) VALUES ('cotton tshirts','6109.10.00','20%','test',1,datetime('now'),'smoke')"`) and repeat: `recommendations[0].code` is `6109.10.00`, `evidence.historyMatch` is `"learned"`, label `Strong Match`, status `recommended`. Delete the learned row afterwards. Stop only the worker process you started.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/routes/classification-lines.ts
git commit -m "feat(worker): history-first suggestions and calibrated confidence on every candidate"
```

---

### Task 4: Strict `isAutoApplyable` and batch apply

**Files:**
- Modify: `apps/web/src/features/review/classification-helpers.ts` (append)
- Create: `apps/web/src/features/review/classification-helpers.test.ts`
- Modify: `apps/web/src/features/review/ClassificationWorkspace.tsx:486-514`

**Interfaces:**
- Consumes: `CandidateEvidence`, `ClassificationRecommendationCandidate`, `LineItem` (shared-types / web types — use whatever `LineItem` type `classification-helpers.ts` already imports).
- Produces: `isAutoApplyable(item: LineItem, candidate: ClassificationRecommendationCandidate | null | undefined): boolean`; `AUTO_APPLY_MIN_CONFIDENCE = 0.85`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/review/classification-helpers.test.ts`. Build a `LineItem` with only the fields the rule reads; cast through `unknown` so the test does not depend on unrelated required fields:

```ts
import { describe, expect, it } from "vitest";
import type { CandidateEvidence, ClassificationRecommendationCandidate } from "@pas/shared-types";
import { isAutoApplyable } from "./classification-helpers";

type Item = Parameters<typeof isAutoApplyable>[0];

const evidence: CandidateEvidence = {
  historyMatch: null,
  familyResolved: true,
  compatibilityPassed: true,
  contradictions: [],
  retrievalRank: 0,
  aiSelected: true,
  aiConfidence: 0.9,
  dbTopAgrees: true,
  officialVerified: true,
  descriptionCoverage: 0.9,
  historyConflict: false,
};

function candidate(over: Partial<ClassificationRecommendationCandidate> = {}): ClassificationRecommendationCandidate {
  return {
    code: "6109.10.00",
    description: "T-shirts of cotton",
    chapter: "61",
    dutyRate: 20,
    vatRate: 12.5,
    reason: "r",
    source: "ai",
    confidence: 0.9,
    confidenceLabel: "Strong Match",
    provisional: false,
    evidence,
    ...over,
  };
}

function item(over: Record<string, unknown> = {}): Item {
  return {
    id: 1,
    desc: "cotton t-shirts",
    tariff_code: null,
    classification_status: "Suggestion Ready",
    classification_conflict: false,
    pending_questions: [],
    classification_recommendation: { status: "recommended", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] },
    ...over,
  } as unknown as Item;
}

describe("isAutoApplyable", () => {
  it("accepts a fully corroborated Strong candidate", () => {
    expect(isAutoApplyable(item(), candidate())).toBe(true);
  });

  it("accepts approved history even without family/compatibility", () => {
    const c = candidate({ evidence: { ...evidence, historyMatch: "learned", familyResolved: false, compatibilityPassed: false } });
    expect(isAutoApplyable(item(), c)).toBe(true);
  });

  it.each([
    ["no candidate", item(), null],
    ["label not Strong", item(), candidate({ confidenceLabel: "Likely Match" })],
    ["confidence below 0.85", item(), candidate({ confidence: 0.84 })],
    ["missing confidence", item(), candidate({ confidence: undefined })],
    ["provisional", item(), candidate({ provisional: true })],
    ["no evidence (cached before calibration)", item(), candidate({ evidence: undefined })],
    ["family not resolved", item(), candidate({ evidence: { ...evidence, familyResolved: false } })],
    ["compatibility failed", item(), candidate({ evidence: { ...evidence, compatibilityPassed: false } })],
    ["contradictions", item(), candidate({ evidence: { ...evidence, contradictions: ["x"] } })],
    ["history conflict", item(), candidate({ evidence: { ...evidence, historyConflict: true } })],
    ["line conflict flag", item({ classification_conflict: true }), candidate()],
    ["pending question on line", item({ pending_questions: [{ id: "material" }] }), candidate()],
    ["question on recommendation", item({ classification_recommendation: { status: "recommended", question: { id: "m", prompt: "p", options: [] }, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status clarification_needed", item({ classification_recommendation: { status: "clarification_needed", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["status unable_to_classify", item({ classification_recommendation: { status: "unable_to_classify", question: null, recommendations: [], recommendedCandidate: null, alternatives: [] } }), candidate()],
    ["line status More Information Needed", item({ classification_status: "More Information Needed" }), candidate()],
  ])("rejects: %s", (_name, it_, cand) => {
    expect(isAutoApplyable(it_, cand)).toBe(false);
  });

  it("ignores recommendation_source (old shortcut removed)", () => {
    expect(isAutoApplyable(item({ recommendation_source: "ai_recommendation" }), candidate({ confidenceLabel: "Possible Match" }))).toBe(false);
  });
});
```

If `LineItem.pending_questions` has a different element type, keep the test value as an array with one element; the rule only checks length.

- [ ] **Step 2: Run to verify failure**

Run (from `apps/web`): `npx vitest run src/features/review/classification-helpers.test.ts`
Expected: FAIL — `isAutoApplyable` is not exported. If the file fails to import because of a module that needs a browser global, report it rather than mocking broadly; mock only that module with `vi.mock`.

- [ ] **Step 3: Implement**

Append to `apps/web/src/features/review/classification-helpers.ts` (reuse its existing `LineItem` and candidate type imports; add `ClassificationRecommendationCandidate` to the shared-types import if missing):

```ts
export const AUTO_APPLY_MIN_CONFIDENCE = 0.85;

const BLOCKING_LINE_STATUSES = new Set(["More Information Needed", "Needs Manual Review", "Failed"]);

/** The single rule for applying a suggestion without the clerk looking at it. */
export function isAutoApplyable(
  item: LineItem,
  candidate: ClassificationRecommendationCandidate | null | undefined,
): boolean {
  if (!candidate) return false;
  if (candidate.confidenceLabel !== "Strong Match") return false;
  if (candidate.confidence == null || candidate.confidence < AUTO_APPLY_MIN_CONFIDENCE) return false;
  if (candidate.provisional) return false;

  const rec = item.classification_recommendation;
  if (rec?.question) return false;
  if (rec?.status === "clarification_needed" || rec?.status === "unable_to_classify") return false;
  if ((item.pending_questions?.length ?? 0) > 0) return false;
  if (item.classification_status && BLOCKING_LINE_STATUSES.has(item.classification_status)) return false;
  if (item.classification_conflict) return false;

  const e = candidate.evidence;
  if (!e) return false;
  if (e.historyConflict || e.contradictions.length > 0) return false;
  if (e.historyMatch) return true;
  return e.familyResolved && e.compatibilityPassed;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/review/classification-helpers.test.ts` — Expected: PASS.

- [ ] **Step 5: Use the rule in batch apply**

In `ClassificationWorkspace.tsx`, import `isAutoApplyable` from `./classification-helpers` (add to the existing import), then replace `batchApply` and `selectedCanBatchApply`:

```ts
  const batchApply = async () => {
    const selected = items.filter((i) => selectedIds.includes(i.id));
    for (const item of selected) {
      const candidate = preferredCandidate(item);
      if (!isAutoApplyable(item, candidate)) continue;
      await applyRecommendation(item, candidate!, false);
    }
  };
```

```ts
  const selectedCanBatchApply = useMemo(() => {
    if (!selectedIds.length) return false;
    return selectedIds.some((id) => {
      const item = items.find((i) => i.id === id);
      return Boolean(item && isAutoApplyable(item, preferredCandidate(item)));
    });
  }, [selectedIds, items]);
```

(`some` instead of `every`: the button is enabled when at least one selected line qualifies; `batchApply` skips the rest.) Find where the batch-apply button's label is rendered; if it says "Apply selected", change it to "Apply strong matches" so the clerk knows non-strong lines are skipped. Do not change any other UI.

- [ ] **Step 6: Verify and commit**

From `apps/web`: `npx vitest run` — all pass. Repo-root `npm run typecheck` — exit 0 (revert `tsconfig.tsbuildinfo`).

```bash
git add apps/web/src/features/review/classification-helpers.ts apps/web/src/features/review/classification-helpers.test.ts apps/web/src/features/review/ClassificationWorkspace.tsx
git commit -m "feat(web): one strict strong-match rule for batch apply"
```

---

### Task 5: Classification stage completes after lines are applied

**Files:**
- Modify: `apps/web/src/lib/workflow-pipeline.ts:94-102,131-155`
- Create: `apps/web/src/lib/workflow-pipeline.test.ts`

**Interfaces:**
- Produces: `isLineClassified(item: LineItem): boolean` (exported from `workflow-pipeline.ts`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/workflow-pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getInvoiceQueueStatus, getWorkflowStages, isLineClassified } from "./workflow-pipeline";

type Inv = Parameters<typeof getWorkflowStages>[0];
type Line = Parameters<typeof isLineClassified>[0];

function line(over: Record<string, unknown>): Line {
  return { id: 1, desc: "x", status: "done", source: "ai", tariff_code: "6109.10.00", ...over } as unknown as Line;
}

function invoice(items: Line[]): NonNullable<Inv> {
  return { id: 1, status: "done", items } as unknown as NonNullable<Inv>;
}

const taxInputs = {} as Parameters<typeof getWorkflowStages>[1];

function classificationStatus(items: Line[]) {
  return getWorkflowStages(invoice(items), taxInputs, [], null).find((s) => s.id === "classification")!.status;
}

describe("isLineClassified", () => {
  it("counts applied AI suggestions as classified", () => {
    expect(isLineClassified(line({ classification_status: "Applied" }))).toBe(true);
    expect(isLineClassified(line({ classification_status: "AI Applied" }))).toBe(true);
    expect(isLineClassified(line({ classification_status: "Clerk Edited", source: "manual" }))).toBe(true);
  });

  it("counts manual/learned lines with a code and no classification status", () => {
    expect(isLineClassified(line({ source: "manual" }))).toBe(true);
    expect(isLineClassified(line({ source: "learned" }))).toBe(true);
  });

  it("does not count unapplied suggestions or missing codes", () => {
    expect(isLineClassified(line({ classification_status: "Suggestion Ready" }))).toBe(false);
    expect(isLineClassified(line({ source: "ai" }))).toBe(false);
    expect(isLineClassified(line({ classification_status: "Applied", tariff_code: null }))).toBe(false);
  });
});

describe("classification stage", () => {
  it("is complete when every line is applied, even if source is ai", () => {
    expect(classificationStatus([line({ classification_status: "Applied" }), line({ id: 2, classification_status: "Clerk Edited", source: "manual" })])).toBe("complete");
  });

  it("needs review while any line is unapplied", () => {
    expect(classificationStatus([line({ classification_status: "Applied" }), line({ id: 2, classification_status: "Suggestion Ready", tariff_code: null })])).toBe("needs_review");
  });

  it("is in progress while a line is loading", () => {
    expect(classificationStatus([line({ status: "loading", tariff_code: null })])).toBe("in_progress");
  });

  it("unlocks Duties & Taxes once classification is complete", () => {
    const stages = getWorkflowStages(invoice([line({ classification_status: "Applied" })]), taxInputs, [], null);
    expect(stages.find((s) => s.id === "taxes")!.status).toBe("in_progress");
  });
});

describe("getInvoiceQueueStatus", () => {
  it("does not report applied AI lines as needing review", () => {
    const status = getInvoiceQueueStatus(invoice([line({ classification_status: "Applied" })]), [], taxInputs);
    expect(status).not.toBe("needs_review");
  });
});
```

Check `getInvoiceQueueStatus`'s real parameter order (currently `(inv, taxLog, taxInputs)` per `workflow-pipeline.ts:88-91`) and the `WorkflowStageId` values (`"classification"`, `"taxes"`) before running; adjust the test calls to match the code, not the code to match the test.

- [ ] **Step 2: Run to verify failure**

Run (from `apps/web`): `npx vitest run src/lib/workflow-pipeline.test.ts` — Expected: FAIL — `isLineClassified` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/workflow-pipeline.ts`, add near the top-level helpers (use the file's existing `LineItem` import; add one if absent):

```ts
const APPLIED_STATUSES = new Set(["Applied", "AI Applied", "Clerk Edited"]);

/** A line counts as classified once a code is applied, regardless of whether AI suggested it. */
export function isLineClassified(item: LineItem): boolean {
  if (!item.tariff_code) return false;
  if (item.classification_status) return APPLIED_STATUSES.has(item.classification_status);
  return item.source !== "ai";
}
```

In `getInvoiceQueueStatus`, replace:

```ts
  const needsReview = inv.items.some(
    (i) => i.source === "ai" || i.status === "needs_review" || !i.tariff_code,
  );
```

with:

```ts
  const needsReview = inv.items.some((i) => i.status === "needs_review" || !isLineClassified(i));
```

In `getWorkflowStages`, replace:

```ts
  const needsReview = inv?.items.some((i) => i.source === "ai" || !i.tariff_code);
```

with:

```ts
  const needsReview = inv?.items.some((i) => !isLineClassified(i));
```

- [ ] **Step 4: Run to verify pass, check other callers, commit**

Run: `npx vitest run src/lib/workflow-pipeline.test.ts` — PASS. Then `npx vitest run` in `apps/web` — all pass.

Grep `apps/web/src` for other `source === "ai"` checks used to mean "needs review" (e.g. `confidenceTone`/`confidenceLabel` in `workflow-pipeline.ts`, `getInvoiceQueueStatus` callers). Only change ones that decide stage/queue completion; leave display tones alone and list them in your report.

Repo-root `npm run typecheck` — exit 0 (revert `tsconfig.tsbuildinfo`).

```bash
git add apps/web/src/lib/workflow-pipeline.ts apps/web/src/lib/workflow-pipeline.test.ts
git commit -m "fix(web): mark Classification complete once every line is applied"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only; fix commits if problems are found)

- [ ] **Step 1: Full suite**

Repo root: `npm run typecheck` (exit 0) and `npm test` (all workspaces pass). Record per-package test counts. Revert `apps/web/tsconfig.tsbuildinfo`.

- [ ] **Step 2: Browser check (local)**

`npm run db:migrate` (no new migrations expected), `npm run dev:worker`, `npm run dev`. Sign in with a local seeded user.

1. Manual page: add "cotton t-shirts" with a code → Classification stage shows **Complete** on the Worksheet pipeline (no regression).
2. Upload or create a line that gets an AI suggestion (needs `ANTHROPIC_API_KEY` in `.dev.vars`; if absent, the retrieval-only path runs). Confirm the suggestion card shows a label and that, without history, it is not "Strong Match" unless TTBizLink verified it.
3. Apply it → Classification stage shows **Complete** (previously stuck on Needs Review).
4. With a learned pair for that description present, generate again → suggestion is the learned code, labelled Strong Match.
5. Select lines and use batch apply → only lines meeting the strict rule are applied.

Do not exercise Brokerage sends (local env points at live FlowBoard).

- [ ] **Step 3: Record results** in `.superpowers/sdd/progress.md` (create if missing) — commands run, counts, what was checked in the browser, anything not exercised.
