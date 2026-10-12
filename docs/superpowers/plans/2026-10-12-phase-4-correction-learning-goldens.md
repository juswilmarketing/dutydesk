# Phase 4 — Correction Learning + Strong Precision Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every clerk correction becomes a saved regression case, the Learning Stats page shows how often clerks override Strong applies, and a golden suite proves ≥ 98% precision on lines labelled Strong before each deploy.

**Architecture:** Correction detection is a pure worker helper (`correction-capture.ts`) called from `POST /:lineId/apply-recommendation`, which writes a `classification_test_cases` row (`source='clerk_correction'`) and records the applied candidate's confidence label on `classification_approvals`. The precision gate (`strong-precision.ts`) replays golden cases offline through the same retrieval + calibration code the route uses, under a worst-case assumption (AI agrees with the database top pick at 0.9 confidence, TTBizLink verifies it, no remembered history). Active test cases are pulled from D1 into a generated TypeScript fixture by `scripts/pull-test-cases.mjs`. If precision is below 98% after classifier fixes, `NON_HISTORY_STRONG_MIN_SCORE` is raised so only clerk-confirmed history can be Strong.

**Tech Stack:** Cloudflare Workers + Hono + D1, React 18, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-simplified-workflow-design.md` §3 item 4 (learn from corrections), §3 item 6 (gate), §5 (golden regression before deploy), rollout step 4.

**Decisions (user, 2026-10-12):** simulated worst-case gate in normal tests; a correction is *either* applying a code different from the top suggestion *or* changing an already-applied code; corrections reach the suite via a pull script (no admin approval); override rate shown on Learning Stats; to reach 98%, tighten golden expectations and fix the classifier first, then fall back to history-only Strong if still short.

**Baseline (measured 2026-10-12, worst-case simulation, 38 cases):** 26 Strong, of which these are wrong: `Diced tomatoes canned`/`DICED TOMATOES` → `0702.00.00` (fresh; should be 2002), `LED driver 24V`/`LED DRIVER` → `8536.30.00` (should be 8504), `PLASTIC SHOWER CAPS`/`Shower caps plastic` → `6505.00.10` (should be 3926). Precision ≈ 77–85%.

---

## Global Constraints

- Correction kinds and exact `notes` copy:
  - `changed_applied`: `Clerk changed applied code {old}[ ({label})] to {new}`
  - `rejected_suggestion`: `Clerk rejected suggestion {old}[ ({label})]; applied {new}`
- Corrections are captured **only** when the `classification_lines` row existed before this apply (soft-created rows have no real description).
- Re-applying the same code to an already-applied line is never a correction.
- One active correction case per description: a new correction deactivates older `clerk_correction` rows for the same description with a different tariff; an identical active row is not duplicated.
- Gate assumptions are fixed: `SIMULATED_AI_CONFIDENCE = 0.9`, TTBizLink verified, no history. Target `STRONG_PRECISION_TARGET = 0.98`. Zero Strong picks counts as precision 1.
- Correctness for a case with `expected_tariff` is that exact code (or a listed alternative) — never the whole heading.
- The route and the gate must share `familyResolvedFor` / `isProvisionalResult` (no duplicated logic).
- Do not change history scoring (`HISTORY_SCORE`, `HISTORY_CONFIRMATIONS_REQUIRED`) or the client-side teach rules from Phase 2.
- Never run `--remote` D1 commands, migrations, pushes or deploys without user approval. Local D1 only during tasks.
- Do not exercise Brokerage/FlowBoard sends locally (local env points at live FlowBoard).
- After `npm run typecheck`, run `git checkout -- apps/web/tsconfig.tsbuildinfo`.
- Verification commands:
  - `npm test -w packages/product-intelligence`
  - `npm test -w apps/worker`
  - `npm test -w apps/web -- --run`
  - `npm run typecheck`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/product-intelligence/src/confidence-calibration.ts` | Modify | `NON_HISTORY_STRONG_MIN_SCORE` + `nonHistoryStrongMin` option |
| `packages/product-intelligence/src/confidence-calibration.test.ts` | Modify | Tests for the above |
| `packages/product-intelligence/src/index.ts` | Modify | Export the constant and `CLASSIFICATION_GOLDENS` |
| `apps/worker/src/lib/correction-capture.ts` | Create | Pure correction detection + stored-suggestion parsing |
| `apps/worker/src/lib/correction-capture.test.ts` | Create | Unit tests |
| `migrations/0023_correction_learning.sql` | Create | Test-case source/replaced columns; approval label columns |
| `apps/worker/src/routes/classification-lines.ts` | Modify | Capture corrections + labels on apply; use shared signal helpers |
| `apps/worker/src/routes/product-intelligence.ts` | Modify | Learning-stats: Strong applied/overridden, corrections captured |
| `apps/web/src/features/admin/learning-stats.ts` | Create | `overrideRateText` helper |
| `apps/web/src/features/admin/learning-stats.test.ts` | Create | Unit tests |
| `apps/web/src/features/admin/LearningStatsPage.tsx` | Modify | Two new stat cards |
| `apps/web/src/lib/api-client.ts` | Modify | Learning-stats response type |
| `apps/worker/src/lib/candidate-evidence.ts` | Modify | `familyResolvedFor`, `isProvisionalResult` |
| `apps/worker/src/lib/candidate-evidence.test.ts` | Modify | Tests for the above |
| `apps/worker/src/lib/strong-precision.ts` | Create | Case mapping, worst-case simulation, precision report |
| `apps/worker/src/lib/strong-precision.test.ts` | Create | Unit tests |
| `scripts/pull-test-cases.mjs` | Create | Pull active D1 test cases into the generated fixture |
| `apps/worker/src/lib/fixtures/test-cases.generated.ts` | Create (generated) | Active `classification_test_cases` rows |
| `package.json` | Modify | `golden:pull`, `golden:check` scripts |
| `packages/product-intelligence/src/fixtures/classification-goldens.ts` | Modify | Tighten tomato / LED driver / plastic shower cap expectations |
| `packages/product-intelligence/src/{product-families,classification-profile}.ts` | Modify | Classifier fixes for those items |
| `apps/worker/src/lib/strong-precision.gate.test.ts` | Create | The ≥ 98% gate |

---

## Task 1: Configurable Strong eligibility for non-history picks

**Files:**
- Modify: `packages/product-intelligence/src/confidence-calibration.ts`
- Modify: `packages/product-intelligence/src/confidence-calibration.test.ts`
- Modify: `packages/product-intelligence/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Add to the import line in `confidence-calibration.test.ts`: `NON_HISTORY_STRONG_MIN_SCORE`. Append inside `describe("calibrateConfidence", …)`:

```ts
  it("keeps the non-history Strong minimum at or above the Strong threshold", () => {
    expect(NON_HISTORY_STRONG_MIN_SCORE).toBeGreaterThanOrEqual(STRONG_MATCH_THRESHOLD);
  });

  it("caps a fully corroborated non-history pick below Strong when the minimum is raised", () => {
    const r = calibrateConfidence(fullyCorroborated, { nonHistoryStrongMin: 0.99 });
    expect(r.label).toBe("Likely Match");
    expect(r.score).toBe(Math.round((STRONG_MATCH_THRESHOLD - 0.01) * 100) / 100);
  });

  it("still allows confirmed history to be Strong when the non-history minimum is raised", () => {
    const r = calibrateConfidence(
      { ...base, historyMatch: "supplier_history", historyConfirmations: 2 },
      { nonHistoryStrongMin: 0.99 },
    );
    expect(r.label).toBe("Strong Match");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/product-intelligence -- confidence-calibration`
Expected: FAIL (`NON_HISTORY_STRONG_MIN_SCORE` is not exported; option ignored).

- [ ] **Step 3: Implement**

In `confidence-calibration.ts`, after `STRONG_MATCH_THRESHOLD`:

```ts
/**
 * Minimum calibrated score for a pick without confirmed history to be Strong.
 * Raise above MAX_SCORE (e.g. 0.99) to make Strong history-only when the golden gate fails.
 */
export const NON_HISTORY_STRONG_MIN_SCORE = 0.85;
```

Change the signature to `opts: { provisional?: boolean; nonHistoryStrongMin?: number } = {}` and replace the cap block:

```ts
  score = clamp(score, 0, MAX_SCORE);
  const nonHistoryStrongMin = opts.nonHistoryStrongMin ?? NON_HISTORY_STRONG_MIN_SCORE;
  if (!historyShortCircuit && (!evidence.officialVerified || score < nonHistoryStrongMin)) {
    score = Math.min(score, STRONG_MATCH_THRESHOLD - 0.01);
  }
```

In `index.ts`, add `NON_HISTORY_STRONG_MIN_SCORE,` to the `./confidence-calibration` export list, and add:

```ts
export { CLASSIFICATION_GOLDENS, type ClassificationGolden } from "./fixtures/classification-goldens";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w packages/product-intelligence`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/product-intelligence/src
git commit -m "feat(pi): configurable minimum score for non-history Strong matches"
```

---

## Task 2: Correction detection helper

**Files:**
- Create: `apps/worker/src/lib/correction-capture.ts`
- Test: `apps/worker/src/lib/correction-capture.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { codeDigits, detectCorrection, suggestedTop, type CorrectionInput } from "./correction-capture";

const input = (over: Partial<CorrectionInput> = {}): CorrectionInput => ({
  description: "LED DRIVER 24V",
  supplier: null,
  appliedCode: "8504.40.90",
  previousStatus: "Suggestion Ready",
  previousCode: null,
  previousLabel: null,
  suggestedCode: "8504.40.90",
  suggestedLabel: "Strong Match",
  ...over,
});

describe("codeDigits", () => {
  it("strips dots and spaces", () => {
    expect(codeDigits("8504.40 90")).toBe("85044090");
    expect(codeDigits(null)).toBe("");
  });
});

describe("detectCorrection", () => {
  it("returns null when the clerk applies the top suggestion", () => {
    expect(detectCorrection(input())).toBeNull();
  });

  it("returns null when there is no suggestion and no previous code", () => {
    expect(detectCorrection(input({ suggestedCode: null, suggestedLabel: null }))).toBeNull();
  });

  it("captures a rejected suggestion", () => {
    const r = detectCorrection(input({ suggestedCode: "8536.30.00", suggestedLabel: "Strong Match" }));
    expect(r).toEqual({
      kind: "rejected_suggestion",
      rawDescription: "LED DRIVER 24V",
      supplier: null,
      expectedTariff: "8504.40.90",
      expectedHeading: "8504",
      expectedChapter: "85",
      replacedCode: "8536.30.00",
      replacedLabel: "Strong Match",
      notes: "Clerk rejected suggestion 8536.30.00 (Strong Match); applied 8504.40.90",
    });
  });

  it("captures a change to an already-applied code, preferring it over the suggestion", () => {
    const r = detectCorrection(input({
      previousStatus: "Applied",
      previousCode: "8536.30.00",
      previousLabel: "Strong Match",
      suggestedCode: "8536.30.00",
    }));
    expect(r?.kind).toBe("changed_applied");
    expect(r?.replacedCode).toBe("8536.30.00");
    expect(r?.replacedLabel).toBe("Strong Match");
    expect(r?.notes).toBe("Clerk changed applied code 8536.30.00 (Strong Match) to 8504.40.90");
  });

  it("omits the label from notes when unknown", () => {
    const r = detectCorrection(input({ previousStatus: "Applied", previousCode: "8536.30.00" }));
    expect(r?.notes).toBe("Clerk changed applied code 8536.30.00 to 8504.40.90");
  });

  it("is not a correction to re-apply the same code to an applied line", () => {
    expect(detectCorrection(input({
      previousStatus: "Applied",
      previousCode: "8504.40.90",
      suggestedCode: "8536.30.00",
    }))).toBeNull();
  });

  it("ignores codes that differ only in punctuation", () => {
    expect(detectCorrection(input({ suggestedCode: "85044090" }))).toBeNull();
  });

  it("returns null for a blank description or a code shorter than a heading", () => {
    expect(detectCorrection(input({ description: "  ", suggestedCode: "8536.30.00" }))).toBeNull();
    expect(detectCorrection(input({ appliedCode: "85", suggestedCode: "8536.30.00" }))).toBeNull();
  });

  it("trims description and supplier", () => {
    const r = detectCorrection(input({ description: " LED DRIVER ", supplier: " Acme ", suggestedCode: "8536.30.00" }));
    expect(r?.rawDescription).toBe("LED DRIVER");
    expect(r?.supplier).toBe("Acme");
  });
});

describe("suggestedTop", () => {
  it("reads code and label from the stored recommended candidate", () => {
    expect(suggestedTop(JSON.stringify({ code: "8536.30.00", confidenceLabel: "Strong Match" })))
      .toEqual({ code: "8536.30.00", label: "Strong Match" });
  });

  it("returns null for missing, null or malformed JSON", () => {
    expect(suggestedTop(null)).toBeNull();
    expect(suggestedTop("null")).toBeNull();
    expect(suggestedTop("{not json")).toBeNull();
    expect(suggestedTop(JSON.stringify({ confidenceLabel: "Strong Match" }))).toBeNull();
  });

  it("returns a null label when absent", () => {
    expect(suggestedTop(JSON.stringify({ code: "8536.30.00" }))).toEqual({ code: "8536.30.00", label: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w apps/worker -- correction-capture`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { ConfidenceLabel } from "@pas/shared-types";

export interface CorrectionInput {
  description: string;
  supplier: string | null;
  appliedCode: string;
  /** Line state before this apply. */
  previousStatus: string | null;
  previousCode: string | null;
  /** Confidence label recorded when the previous code was applied. */
  previousLabel: ConfidenceLabel | null;
  /** Top candidate of the latest stored recommendation for this line. */
  suggestedCode: string | null;
  suggestedLabel: ConfidenceLabel | null;
}

export interface CorrectionCase {
  kind: "changed_applied" | "rejected_suggestion";
  rawDescription: string;
  supplier: string | null;
  expectedTariff: string;
  expectedHeading: string;
  expectedChapter: string;
  replacedCode: string;
  replacedLabel: ConfidenceLabel | null;
  notes: string;
}

export function codeDigits(code: string | null | undefined): string {
  return String(code ?? "").replace(/\D/g, "");
}

function withLabel(code: string, label: ConfidenceLabel | null): string {
  return label ? `${code} (${label})` : code;
}

export function detectCorrection(input: CorrectionInput): CorrectionCase | null {
  const applied = codeDigits(input.appliedCode);
  const description = input.description.trim();
  if (applied.length < 4 || !description) return null;
  const base = {
    rawDescription: description,
    supplier: input.supplier?.trim() || null,
    expectedTariff: input.appliedCode,
    expectedHeading: applied.slice(0, 4),
    expectedChapter: applied.slice(0, 2),
  };

  const previous = codeDigits(input.previousCode);
  if (input.previousStatus === "Applied" && previous) {
    if (previous === applied) return null;
    return {
      ...base,
      kind: "changed_applied",
      replacedCode: input.previousCode!,
      replacedLabel: input.previousLabel,
      notes: `Clerk changed applied code ${withLabel(input.previousCode!, input.previousLabel)} to ${input.appliedCode}`,
    };
  }

  const suggested = codeDigits(input.suggestedCode);
  if (suggested && suggested !== applied) {
    return {
      ...base,
      kind: "rejected_suggestion",
      replacedCode: input.suggestedCode!,
      replacedLabel: input.suggestedLabel,
      notes: `Clerk rejected suggestion ${withLabel(input.suggestedCode!, input.suggestedLabel)}; applied ${input.appliedCode}`,
    };
  }
  return null;
}

export function suggestedTop(
  recommendedCandidateJson: string | null | undefined,
): { code: string; label: ConfidenceLabel | null } | null {
  if (!recommendedCandidateJson) return null;
  try {
    const parsed = JSON.parse(recommendedCandidateJson) as { code?: unknown; confidenceLabel?: unknown } | null;
    if (!parsed || typeof parsed.code !== "string" || !parsed.code) return null;
    return {
      code: parsed.code,
      label: typeof parsed.confidenceLabel === "string" ? (parsed.confidenceLabel as ConfidenceLabel) : null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w apps/worker -- correction-capture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/correction-capture.ts apps/worker/src/lib/correction-capture.test.ts
git commit -m "feat(worker): pure clerk-correction detection"
```

---

## Task 3: Migration + capture corrections on apply

**Files:**
- Create: `migrations/0023_correction_learning.sql`
- Modify: `apps/worker/src/routes/classification-lines.ts` (`POST /:lineId/apply-recommendation`, ~line 1033)

No route test harness exists; the pure logic is covered by Task 2 and the wiring is verified against local D1 in Task 8.

- [ ] **Step 1: Write the migration**

```sql
-- Clerk corrections become regression cases; track overrides of Strong applies.
ALTER TABLE classification_test_cases ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE classification_test_cases ADD COLUMN replaced_code TEXT;
ALTER TABLE classification_test_cases ADD COLUMN replaced_label TEXT;
ALTER TABLE classification_approvals ADD COLUMN confidence_label TEXT;
ALTER TABLE classification_approvals ADD COLUMN overrode_label TEXT;
CREATE INDEX IF NOT EXISTS idx_classification_test_cases_source
  ON classification_test_cases(source, active);
```

- [ ] **Step 2: Apply locally**

Run (from `apps/worker`): `npx wrangler d1 migrations apply pas-trinidad --local`
Expected: `0023_correction_learning.sql` applied, no errors.

- [ ] **Step 3: Wire the route**

Add import near the other `../lib` imports:

```ts
import { detectCorrection, suggestedTop } from "../lib/correction-capture";
```

Change the `latestRecommendation` query to also select the stored top candidate:

```ts
  const latestRecommendation = await c.env.DB.prepare(
    `SELECT id, resolution_id, recommended_candidate_json FROM classification_recommendations
     WHERE line_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(lineId)
    .first<{ id: number; resolution_id: number | null; recommended_candidate_json: string | null }>();
```

After `latestRecommendation` (before `const dbDuty`), add:

```ts
  const previousApproval = existing
    ? await c.env.DB.prepare(
      `SELECT confidence_label FROM classification_approvals WHERE line_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(lineId).first<{ confidence_label: ConfidenceLabel | null }>()
    : null;
  const suggestion = suggestedTop(latestRecommendation?.recommended_candidate_json);
  const correction = existing
    ? detectCorrection({
      description: String(existing.original_description || ""),
      supplier: null,
      appliedCode: knownTariff?.code || candidate.code,
      previousStatus: existing.classification_status ? String(existing.classification_status) : null,
      previousCode: existing.tariff_code ? String(existing.tariff_code) : null,
      previousLabel: previousApproval?.confidence_label ?? null,
      suggestedCode: suggestion?.code ?? null,
      suggestedLabel: suggestion?.label ?? null,
    })
    : null;
```

Add `ConfidenceLabel` to the existing `@pas/shared-types` type import.

Change the `classification_approvals` insert in the `DB.batch([...])` to record labels:

```ts
    c.env.DB.prepare(
      `INSERT INTO classification_approvals
        (line_id, recommendation_id, resolution_id, product_master_id, selected_tariff,
         source, evidence_ids_json, approved_by, previous_value_json, approved_value_json,
         confidence_label, overrode_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      lineId,
      latestRecommendation?.id || null,
      body.resolutionId || null,
      body.productMasterId || null,
      after.tariff_code,
      source,
      JSON.stringify(body.evidenceIds || []),
      c.var.username,
      JSON.stringify(lineRow),
      JSON.stringify(after),
      body.candidate.confidenceLabel ?? null,
      correction?.kind === "changed_applied" ? correction.replacedLabel : null,
    ),
```

Turn the existing `await c.env.DB.batch([...])` into `const statements: D1PreparedStatement[] = [...]` (same four statements, with the approval insert above), append the correction statements, then `await c.env.DB.batch(statements);`:

```ts
  if (correction) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE classification_test_cases SET active = 0
         WHERE source = 'clerk_correction' AND active = 1
           AND upper(trim(raw_description)) = upper(trim(?)) AND expected_tariff <> ?`,
      ).bind(correction.rawDescription, correction.expectedTariff),
      c.env.DB.prepare(
        `INSERT INTO classification_test_cases
          (raw_description, supplier, expected_chapter, expected_heading, expected_tariff,
           notes, approved_by, source, replaced_code, replaced_label)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'clerk_correction', ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM classification_test_cases
           WHERE active = 1 AND upper(trim(raw_description)) = upper(trim(?)) AND expected_tariff = ?
         )`,
      ).bind(
        correction.rawDescription,
        correction.supplier,
        correction.expectedChapter,
        correction.expectedHeading,
        correction.expectedTariff,
        correction.notes,
        c.var.username,
        correction.replacedCode,
        correction.replacedLabel,
        correction.rawDescription,
        correction.expectedTariff,
      ),
    );
  }
```

- [ ] **Step 4: Verify**

Run: `npm test -w apps/worker` and `npm run typecheck` (then `git checkout -- apps/web/tsconfig.tsbuildinfo`).
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0023_correction_learning.sql apps/worker/src/routes/classification-lines.ts
git commit -m "feat(worker): save clerk corrections as test cases and record applied confidence labels"
```

---

## Task 4: Strong override rate on Learning Stats

**Files:**
- Create: `apps/web/src/features/admin/learning-stats.ts`
- Test: `apps/web/src/features/admin/learning-stats.test.ts`
- Modify: `apps/worker/src/routes/product-intelligence.ts` (`admin.get("/learning-stats")`, ~line 739)
- Modify: `apps/web/src/lib/api-client.ts` (`getLearningStats`, ~line 725)
- Modify: `apps/web/src/features/admin/LearningStatsPage.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { overrideRateText } from "./learning-stats";

describe("overrideRateText", () => {
  it("shows a dash before any Strong applies", () => {
    expect(overrideRateText(0, 0)).toBe("—");
  });

  it("formats the share of Strong applies later changed, one decimal", () => {
    expect(overrideRateText(200, 3)).toBe("1.5%");
    expect(overrideRateText(3, 0)).toBe("0.0%");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w apps/web -- --run learning-stats`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement helper**

```ts
export function overrideRateText(strongApplied: number, strongOverridden: number): string {
  if (!strongApplied) return "—";
  return `${((strongOverridden / strongApplied) * 100).toFixed(1)}%`;
}
```

- [ ] **Step 4: Extend the endpoint**

In the learning-stats handler, before `return c.json(...)`:

```ts
  const correction = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN confidence_label = 'Strong Match' THEN 1 ELSE 0 END), 0) AS strong_applied,
       COALESCE(SUM(CASE WHEN overrode_label = 'Strong Match' THEN 1 ELSE 0 END), 0) AS strong_overridden
     FROM classification_approvals`,
  ).first<{ strong_applied: number; strong_overridden: number }>().catch(() => null);
  const captured = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM classification_test_cases WHERE source = 'clerk_correction' AND active = 1`,
  ).first<{ n: number }>().catch(() => null);
```

and add to the response object:

```ts
    strong_applied: correction?.strong_applied ?? 0,
    strong_overridden: correction?.strong_overridden ?? 0,
    corrections_captured: captured?.n ?? 0,
```

- [ ] **Step 5: Client type + page**

In `api-client.ts` `getLearningStats` response type add:

```ts
      strong_applied: number;
      strong_overridden: number;
      corrections_captured: number;
```

In `LearningStatsPage.tsx`: import `overrideRateText` from `./learning-stats`; add state `const [correction, setCorrection] = useState({ strongApplied: 0, strongOverridden: 0, captured: 0 });`; in `load` after `setByChapter(...)`:

```ts
      setCorrection({
        strongApplied: data.strong_applied,
        strongOverridden: data.strong_overridden,
        captured: data.corrections_captured,
      });
```

Change the top grid to `sm:grid-cols-3 lg:grid-cols-5` and append two cards after "Unknown product terms":

```tsx
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide dd-text-muted">Strong matches later changed</div>
          <div className="mt-1 text-2xl font-bold">
            {overrideRateText(correction.strongApplied, correction.strongOverridden)}
          </div>
          <div className="text-xs dd-text-muted">
            {correction.strongOverridden} of {correction.strongApplied} Strong applies
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide dd-text-muted">Corrections saved as test cases</div>
          <div className="mt-1 text-2xl font-bold">{correction.captured}</div>
        </Card>
```

- [ ] **Step 6: Verify**

Run: `npm test -w apps/web -- --run`, `npm test -w apps/worker`, `npm run typecheck` (then revert tsbuildinfo).
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/admin apps/web/src/lib/api-client.ts apps/worker/src/routes/product-intelligence.ts
git commit -m "feat: show Strong override rate and captured corrections on Learning Stats"
```

---

## Task 5: Precision harness + shared signal helpers

**Files:**
- Modify: `apps/worker/src/lib/candidate-evidence.ts`, `candidate-evidence.test.ts`
- Modify: `apps/worker/src/routes/classification-lines.ts` (~lines 567–570 and 779–782)
- Create: `apps/worker/src/lib/strong-precision.ts`
- Test: `apps/worker/src/lib/strong-precision.test.ts`

- [ ] **Step 1: Write failing tests for the signal helpers**

Append to `candidate-evidence.test.ts` (add `familyResolvedFor, isProvisionalResult` to the import, and `import type { HierarchicalClassificationResult } from "@pas/product-intelligence";`):

```ts
type Profile = HierarchicalClassificationResult["profile"];
const profile = (over: Record<string, unknown> = {}): Profile =>
  ({ knownAttributes: {}, familyConfidence: 0, missingCriticalAttributes: [], ...over }) as unknown as Profile;

describe("familyResolvedFor", () => {
  it("is true for a hard heading gate, a fast path, or family confidence ≥ 0.85", () => {
    expect(familyResolvedFor(profile({ knownAttributes: { hardHeadingGate: true } }))).toBe(true);
    expect(familyResolvedFor(profile({ knownAttributes: { commonProductFastPath: true } }))).toBe(true);
    expect(familyResolvedFor(profile({ familyConfidence: 0.85 }))).toBe(true);
    expect(familyResolvedFor(profile({ knownAttributes: { productFamilyConfidence: 0.9 } }))).toBe(true);
  });

  it("is false otherwise", () => {
    expect(familyResolvedFor(profile({ familyConfidence: 0.84 }))).toBe(false);
  });
});

describe("isProvisionalResult", () => {
  const result = (status: HierarchicalClassificationResult["recommendationStatus"], missing: string[] = []) =>
    ({ recommendationStatus: status, profile: profile({ missingCriticalAttributes: missing }) }) as HierarchicalClassificationResult;

  it("is provisional for provisional/insufficient status or missing critical attributes", () => {
    expect(isProvisionalResult(result("provisional"))).toBe(true);
    expect(isProvisionalResult(result("insufficient"))).toBe(true);
    expect(isProvisionalResult(result("strong", ["material"]))).toBe(true);
  });

  it("is not provisional for a complete strong/likely result", () => {
    expect(isProvisionalResult(result("strong"))).toBe(false);
    expect(isProvisionalResult(result("likely"))).toBe(false);
  });
});
```

- [ ] **Step 2: Implement helpers and use them in the route**

In `candidate-evidence.ts` add `import type { HierarchicalClassificationResult } from "@pas/product-intelligence";` and:

```ts
export function familyResolvedFor(profile: HierarchicalClassificationResult["profile"]): boolean {
  return Boolean(profile.knownAttributes?.hardHeadingGate)
    || Number(profile.familyConfidence ?? profile.knownAttributes?.productFamilyConfidence ?? 0) >= 0.85
    || Boolean(profile.knownAttributes?.commonProductFastPath);
}

export function isProvisionalResult(result: HierarchicalClassificationResult): boolean {
  return result.recommendationStatus === "provisional"
    || result.recommendationStatus === "insufficient"
    || result.profile.missingCriticalAttributes.length > 0;
}
```

In `classification-lines.ts` import both from `../lib/candidate-evidence` and replace the bodies:

```ts
  const familyKnown = familyResolvedFor(hierarchical.profile);
```

```ts
  const provisional = isProvisionalResult(hierarchical);
```

Run: `npm test -w apps/worker -- candidate-evidence` → PASS.

- [ ] **Step 3: Write failing tests for the harness**

```ts
import { describe, expect, it } from "vitest";
import type { ClassificationGolden } from "@pas/product-intelligence";
import {
  caseFromGolden,
  caseFromRow,
  isAcceptable,
  simulateTopPick,
  strongPrecision,
  type PrecisionCase,
  type TestCaseRow,
} from "./strong-precision";

const row = (over: Partial<TestCaseRow> = {}): TestCaseRow => ({
  id: 7,
  raw_description: "LED DRIVER",
  supplier: null,
  expected_chapter: "85",
  expected_heading: "8504",
  expected_tariff: "8504.40.90",
  acceptable_alternatives_json: "[]",
  prohibited_chapters_json: '["20"]',
  source: "clerk_correction",
  ...over,
});

describe("caseFromRow", () => {
  it("accepts only the exact tariff (plus alternatives) when a tariff is given", () => {
    const c = caseFromRow(row({ acceptable_alternatives_json: '["8504.40.10"]' }));
    expect(c).toEqual({
      id: "db-7",
      description: "LED DRIVER",
      supplier: null,
      acceptable: ["85044090", "85044010"],
      prohibitedChapters: ["20"],
    });
  });

  it("falls back to heading, then alternatives, then chapter", () => {
    expect(caseFromRow(row({ expected_tariff: null })).acceptable).toEqual(["8504"]);
    expect(caseFromRow(row({ expected_tariff: null, expected_heading: null, acceptable_alternatives_json: '["8504","8537"]' })).acceptable)
      .toEqual(["8504", "8537"]);
    expect(caseFromRow(row({ expected_tariff: null, expected_heading: null })).acceptable).toEqual(["85"]);
  });

  it("tolerates malformed JSON lists", () => {
    const c = caseFromRow(row({ acceptable_alternatives_json: "nope", prohibited_chapters_json: "nope" }));
    expect(c.acceptable).toEqual(["85044090"]);
    expect(c.prohibitedChapters).toEqual([]);
  });
});

describe("caseFromGolden", () => {
  const golden: ClassificationGolden = {
    id: "fridge",
    description: "REFRIGERATOR",
    expectedProduct: /fridge/,
    expectedFamily: /refrigeration/,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8418",
    prohibitedChapters: ["20"],
    consignee: "X Ltd",
  };

  it("uses the heading prefix when present, else the chapters", () => {
    expect(caseFromGolden(golden)).toEqual({
      id: "golden-fridge",
      description: "REFRIGERATOR",
      clarification: null,
      consignee: "X Ltd",
      acceptable: ["8418"],
      prohibitedChapters: ["20"],
    });
    expect(caseFromGolden({ ...golden, expectedHeadingPrefix: undefined }).acceptable).toEqual(["84"]);
  });
});

describe("isAcceptable", () => {
  const c: PrecisionCase = { id: "x", description: "x", acceptable: ["8504"], prohibitedChapters: ["20"] };
  it("matches by digit prefix", () => {
    expect(isAcceptable("8504.40.90", c)).toBe(true);
    expect(isAcceptable("8536.30.00", c)).toBe(false);
  });
  it("rejects prohibited chapters even when a prefix matches", () => {
    expect(isAcceptable("2002.10.00", { ...c, acceptable: ["20"] })).toBe(false);
  });
});

describe("strongPrecision", () => {
  const cases: PrecisionCase[] = [
    { id: "a", description: "a", acceptable: ["8418"], prohibitedChapters: [] },
    { id: "b", description: "b", acceptable: ["8504"], prohibitedChapters: [] },
    { id: "c", description: "c", acceptable: ["6302"], prohibitedChapters: [] },
  ];
  const picks: Record<string, { code: string | null; label: "Strong Match" | "Likely Match" | null }> = {
    a: { code: "8418.30.00", label: "Strong Match" },
    b: { code: "8536.30.00", label: "Strong Match" },
    c: { code: "6302.60.00", label: "Likely Match" },
  };

  it("counts only Strong picks and lists the wrong ones", () => {
    const r = strongPrecision(cases, (c) => picks[c.id]);
    expect(r).toEqual({
      total: 3,
      strong: 2,
      correct: 1,
      precision: 0.5,
      misses: [{ id: "b", description: "b", code: "8536.30.00", acceptable: ["8504"] }],
    });
  });

  it("treats zero Strong picks as full precision", () => {
    expect(strongPrecision(cases, () => ({ code: null, label: null })).precision).toBe(1);
  });
});

describe("simulateTopPick (real classifier)", () => {
  it("rates an unambiguous appliance Strong in the worst case", () => {
    const pick = simulateTopPick({ id: "f", description: "REFRIGERATOR", acceptable: ["8418"], prohibitedChapters: [] });
    expect(pick.label).toBe("Strong Match");
    expect(pick.code?.startsWith("8418")).toBe(true);
  });

  it("never rates a line that needs a clarifying question Strong", () => {
    const pick = simulateTopPick({ id: "s", description: "STOVE", acceptable: ["85", "73"], prohibitedChapters: [] });
    expect(pick.label).not.toBe("Strong Match");
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm test -w apps/worker -- strong-precision`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the harness**

```ts
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
  for (const c of cases) {
    const p = pick(c);
    if (p.label !== "Strong Match" || !p.code) continue;
    strong += 1;
    if (isAcceptable(p.code, c)) correct += 1;
    else misses.push({ id: c.id, description: c.description, code: p.code, acceptable: c.acceptable });
  }
  return { total: cases.length, strong, correct, precision: strong ? correct / strong : 1, misses };
}

export function formatReport(r: PrecisionReport): string {
  const head = `Strong precision ${(r.precision * 100).toFixed(1)}% (${r.correct}/${r.strong} Strong of ${r.total} cases)`;
  return [head, ...r.misses.map((m) => `  WRONG ${m.code} for "${m.description}" (expected ${m.acceptable.join(" | ")})`)].join("\n");
}
```

- [ ] **Step 6: Verify**

Run: `npm test -w apps/worker` and `npm run typecheck` (revert tsbuildinfo).
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/lib apps/worker/src/routes/classification-lines.ts
git commit -m "feat(worker): worst-case Strong precision harness sharing route signal rules"
```

---

## Task 6: Pull test cases into a fixture

**Files:**
- Create: `scripts/pull-test-cases.mjs`
- Create (generated): `apps/worker/src/lib/fixtures/test-cases.generated.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const remote = process.argv.includes("--remote");
const outFile = resolve(root, "apps/worker/src/lib/fixtures/test-cases.generated.ts");
const query = [
  "SELECT id, raw_description, supplier, expected_chapter, expected_heading, expected_tariff,",
  "acceptable_alternatives_json, prohibited_chapters_json, source",
  "FROM classification_test_cases WHERE active = 1 ORDER BY id",
].join(" ");

// The query contains no double quotes, so wrapping it is safe for both cmd.exe and sh.
const result = spawnSync(
  `npx wrangler d1 execute pas-trinidad ${remote ? "--remote" : "--local"} --json --command "${query}"`,
  { cwd: root, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "wrangler failed\n");
  process.exit(result.status ?? 1);
}
const start = result.stdout.indexOf("[");
const parsed = JSON.parse(result.stdout.slice(start));
const rows = parsed[0]?.results ?? [];

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `// Generated by scripts/pull-test-cases.mjs (${remote ? "remote" : "local"} D1). Do not edit by hand.\n`
    + `import type { TestCaseRow } from "../strong-precision";\n\n`
    + `export const TEST_CASE_ROWS: TestCaseRow[] = ${JSON.stringify(rows, null, 2)};\n`,
  "utf8",
);
console.log(`Wrote ${rows.length} active test cases to ${outFile}`);
```

- [ ] **Step 2: Add npm scripts**

In root `package.json` `scripts`:

```json
    "golden:pull": "node scripts/pull-test-cases.mjs",
    "golden:check": "npm run test --workspace @pas/worker -- strong-precision",
```

- [ ] **Step 3: Generate from local D1**

Run: `npm run golden:pull`
Expected: `Wrote 15 active test cases …` (the 0018 seed rows; more if local corrections exist). Open the file and confirm each row has the `TestCaseRow` fields and `source: "seed"`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` (revert tsbuildinfo).
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/pull-test-cases.mjs package.json apps/worker/src/lib/fixtures/test-cases.generated.ts
git commit -m "feat: pull active classification test cases into a golden fixture"
```

---

## Task 7: Honest goldens, classifier fixes, and the ≥ 98% gate

**Files:**
- Modify: `packages/product-intelligence/src/fixtures/classification-goldens.ts`
- Modify: `packages/product-intelligence/src/product-families.ts`, `classification-profile.ts` (and only what the fixes need)
- Create: `apps/worker/src/lib/strong-precision.gate.test.ts`
- Possibly modify: `packages/product-intelligence/src/confidence-calibration.ts` (fallback only)

Use superpowers:systematic-debugging for each wrong item: find where the routing decides the heading before changing it.

- [ ] **Step 1: Tighten golden expectations (failing tests)**

In `classification-goldens.ts`:
- `diced-tomatoes`: `expectedChapters: ["20"]`, add `expectedHeadingPrefix: "2002"`, add `"07"` to `prohibitedChapters`.
- `led-driver`: add `expectedHeadingPrefix: "8504"`, add `"8536"` to `prohibitedHeadingPrefixes`.
- `shower-cap` ("Shower caps plastic"): `expectedChapters: ["39"]`, add `expectedHeadingPrefix: "3926"`, add `"65"` and `"63"` to `prohibitedChapters`.

Run: `npm test -w packages/product-intelligence -- classification-goldens`
Expected: FAIL on those three cases.

- [ ] **Step 2: Fix the classifier**

Known routing (verify before editing):
- Tomatoes: `product-families.ts` `food_preparations` has `likelyChapters: ["20","07","21"]`, `likelyHeadings: ["2002","0702"]`; `classification-profile.ts` tomato rule has `likelyChapters: ["20","07"]`. Diced/canned/prepared tomatoes are heading 2002; route chapter 07 only when the description says fresh.
- LED driver: `electrical_control` family groups LED drivers (8504 static converters) with voltage/surge protectors (8535/8536) under `likelyHeadings: ["8504","8536"]`. Route LED drivers / power supplies to 8504 only; keep protectors on 8535/8536.
- Plastic shower caps: `classification-profile.ts` material tuning sets `likelyChapters = ["39","65"]` for plastic; 6505 is textile headgear. Plastic → `["39"]` (heading 3926).

Keep every other golden and the 0018 seed expectations passing. Run: `npm test -w packages/product-intelligence` → PASS.

- [ ] **Step 3: Write the gate test**

```ts
import { describe, expect, it } from "vitest";
import { CLASSIFICATION_GOLDENS } from "@pas/product-intelligence";
import { TEST_CASE_ROWS } from "./fixtures/test-cases.generated";
import { caseFromGolden, caseFromRow, formatReport, strongPrecision, STRONG_PRECISION_TARGET } from "./strong-precision";

describe("golden Strong precision gate", () => {
  it(`labels Strong only when right at least ${STRONG_PRECISION_TARGET * 100}% of the time`, () => {
    const cases = [...CLASSIFICATION_GOLDENS.map(caseFromGolden), ...TEST_CASE_ROWS.map(caseFromRow)];
    const report = strongPrecision(cases);
    console.log(formatReport(report));
    expect(report.precision, formatReport(report)).toBeGreaterThanOrEqual(STRONG_PRECISION_TARGET);
  }, 120_000);
});
```

Run: `npm run golden:check`
Record the printed report in the task report.

- [ ] **Step 4: Fallback only if still below 98%**

If any `WRONG` lines remain that are not a quick, clearly-correct routing fix, set `NON_HISTORY_STRONG_MIN_SCORE = 0.99` in `confidence-calibration.ts` (Strong becomes history-only). Existing calibration tests that expect a fully corroborated non-history pick to be Strong must then pass `{ nonHistoryStrongMin: 0.85 }` explicitly. Re-run `npm run golden:check` → PASS. Report which path was taken and the final report text.

- [ ] **Step 5: Full verification**

Run all four verification commands from Global Constraints (revert tsbuildinfo).
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/product-intelligence/src apps/worker/src/lib/strong-precision.gate.test.ts
git commit -m "feat: golden Strong precision gate (>=98%) with classifier fixes"
```

---

## Task 8: End-to-end verification (local)

No code unless a defect is found (then systematic-debugging + a fix commit).

- [ ] **Step 1:** Start `npm run dev:worker` and `npm run dev`; log in as `p2check` / `p2check-pass`.
- [ ] **Step 2: Rejected suggestion.** On an invoice line with a generated suggestion, use **Choose another** to apply a different code. Then (from `apps/worker`):
  `npx wrangler d1 execute pas-trinidad --local --command "SELECT raw_description, expected_tariff, replaced_code, replaced_label, source, notes, active FROM classification_test_cases WHERE source = 'clerk_correction' ORDER BY id DESC LIMIT 5"`
  Expected: one row, `notes` = `Clerk rejected suggestion … ; applied …`.
- [ ] **Step 3: Changed applied code.** Open the same (now applied) line from the applied group and apply another code. Re-run the query. Expected: a new active `Clerk changed applied code …` row; the previous row for that description is `active = 0`.
- [ ] **Step 4: No false capture.** Apply a line's top suggestion unchanged. Expected: no new test-case row. Check `SELECT confidence_label, overrode_label FROM classification_approvals ORDER BY id DESC LIMIT 3` shows the applied label.
- [ ] **Step 5: Stats page.** Open Admin → Learning Stats. Expected: "Strong matches later changed" and "Corrections saved as test cases" cards with values matching D1.
- [ ] **Step 6: Gate with local corrections.** `npm run golden:pull` then `npm run golden:check`; report the result. Do **not** commit local-only correction rows — `git checkout -- apps/worker/src/lib/fixtures/test-cases.generated.ts` afterwards.

---

## Deploy notes (after merge, user approval required)

1. Remote migration: `npx wrangler d1 migrations apply pas-trinidad --remote` (applies 0023).
2. `npm run golden:pull -- --remote` → `npm run golden:check` → commit the regenerated fixture if it changed. This is the pre-deploy golden run (spec §5); if it fails, fix or raise `NON_HISTORY_STRONG_MIN_SCORE` before deploying.
3. `npm run build:web`, `npx wrangler deploy`, `npx wrangler deploy --name pas-trinidad-api`.

**Known limits:** codes changed directly on the Worksheet/Tax Calculator pages bypass the apply route and are not captured; duplicate-follower lines without their own stored recommendation only capture `changed_applied` corrections.
