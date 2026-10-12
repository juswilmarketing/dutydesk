# Phase 3 — Classification UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make classification a "confirm the strong ones, work the exceptions" flow: suggestions generate 4 at a time with progress, a one-time modal applies strong matches, the queue shows only exceptions, the line screen has one primary action, and navigation shows the four job steps.

**Architecture:** All decision logic (concurrency, duplicate grouping, progress, strong-match selection, queue split, messages, nav grouping) lives in pure, unit-tested modules (`classification-queue.ts`, `nav-config.ts`). React components only wire those helpers to state. No worker/API changes — `POST /:lineId/apply-recommendation` already accepts any candidate without a stored recommendation for that line, so duplicate lines can share one result.

**Tech Stack:** React 18, zustand, vitest (no component test harness — UI is verified in the browser in Task 7).

**Spec:** `docs/superpowers/specs/2026-10-08-simplified-workflow-design.md` §2 (Flow, Line screen, Navigation), §3 item 3 (Dedup), §4 (suggestion failure).

---

## Global Constraints

- Generation concurrency is exactly **4** (`GENERATION_CONCURRENCY`).
- Copy (exact):
  - Progress: `Classifying {ready} of {total} lines…`
  - Modal title: `{N} lines are strong matches. Apply them?` (singular: `1 line is a strong match. Apply it?`); buttons `Apply {checked}` and `Review individually`.
  - Applied group: `{N} applied`.
  - Done banner: `All lines classified` with button `Continue to Duties & Taxes`.
  - Failure: `Couldn't classify this line.` + reason, buttons `Retry` and `Search tariff`.
- The confirm modal and batch apply only apply lines where `isAutoApplyable(item, candidate)` is true, always with `{ teach: false }` (Phase 2 rule: only hand-applies count toward approved history).
- Modal is offered **once per invoice**, recorded in `invoice.meta.strongConfirmOffered` (persists with the job draft).
- Duplicate key = normalised description **plus** part number (two SKUs with the same wording can differ in supplier evidence).
- Do not change worker code, migrations, or Phase 2 confidence rules.
- Do not exercise Brokerage/FlowBoard sends locally (local env points at live FlowBoard).
- After `npm run typecheck`, run `git checkout -- apps/web/tsconfig.tsbuildinfo`.
- Verification commands: `npm test -w apps/web -- --run`, `npm run typecheck`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/features/review/classification-queue.ts` | Create | Pure queue logic: concurrency runner, duplicate grouping, progress, strong matches, queue split, messages |
| `apps/web/src/features/review/classification-queue.test.ts` | Create | Unit tests for the above |
| `packages/shared-types/src/index.ts` | Modify | `InvoiceMeta.strongConfirmOffered?: boolean` |
| `apps/web/src/features/review/ClassificationWorkspace.tsx` | Modify | Per-line busy set, concurrent generation + sharing, progress, modal, done banner, layout |
| `apps/web/src/features/review/ReviewPage.tsx` | Modify | Remove `updatingLine` state; pass modal flag + continue handler |
| `apps/web/src/features/review/StrongMatchConfirmModal.tsx` | Create | Confirm modal |
| `apps/web/src/features/review/LineQueuePanel.tsx` | Modify | Exceptions first, applied collapsed |
| `apps/web/src/features/review/ClassificationCentre.tsx` | Modify | One primary action, Choose another, failure state, More detail toggle |
| `apps/web/src/styles/globals.css` | Modify | Two-column panels; remove assistant column/sticky/drawer styles |
| `apps/web/src/features/review/{TariffPicker,ProductIntelligencePanel,CompositionPanel,ParsedDescriptionPanel}.tsx` | Delete | Unused |
| `apps/web/src/lib/nav-config.ts` | Create | Tab definitions + active-tab / brokerage grouping |
| `apps/web/src/lib/nav-config.test.ts` | Create | Unit tests |
| `apps/web/src/app/AppShell.tsx` | Modify | Use nav config; Brokerage sub-nav |

---

## Task 1: Pure queue helpers

**Files:**
- Create: `apps/web/src/features/review/classification-queue.ts`
- Test: `apps/web/src/features/review/classification-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { ClassificationRecommendationCandidate, LineItem } from "@pas/shared-types";
import {
  GENERATION_CONCURRENCY,
  batchApplySummary,
  classificationProgress,
  duplicateKey,
  groupDuplicates,
  needsSuggestion,
  runWithConcurrency,
  shouldOfferStrongConfirm,
  splitQueue,
  strongConfirmTitle,
  strongMatches,
} from "./classification-queue";

function line(id: number, overrides: Partial<LineItem> = {}): LineItem {
  return { id, desc: `Item ${id}`, qty: 1, price: 1, ...overrides } as LineItem;
}

const strong: ClassificationRecommendationCandidate = {
  code: "6109.10.10",
  description: "T-shirts of cotton",
  confidence: 0.96,
  confidenceLabel: "Strong Match",
  reason: "Approved history",
  evidence: { historyMatch: true, historyConfirmations: 2, familyResolved: true, compatibilityPassed: true },
} as unknown as ClassificationRecommendationCandidate;

function withRecommendation(id: number, candidate = strong, overrides: Partial<LineItem> = {}): LineItem {
  return line(id, {
    classification_status: "Suggestion Ready",
    classification_recommendation: { status: "recommended", recommendations: [candidate] } as LineItem["classification_recommendation"],
    product_profile: { productFamily: "apparel" } as LineItem["product_profile"],
    ...overrides,
  });
}

describe("runWithConcurrency", () => {
  it("never runs more than the limit at once and processes every item", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], GENERATION_CONCURRENCY, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      running -= 1;
    });
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps going when a worker throws", async () => {
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 1) throw new Error("boom");
      done.push(n);
    });
    expect(done.sort()).toEqual([2, 3]);
  });
});

describe("needsSuggestion", () => {
  it("is true for a described line with no recommendation", () => {
    expect(needsSuggestion(line(1))).toBe(true);
  });
  it("is false for blank, applied, recommended, or failed lines", () => {
    expect(needsSuggestion(line(1, { desc: "  " }))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Applied" }))).toBe(false);
    expect(needsSuggestion(withRecommendation(1))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Failed" }))).toBe(false);
    expect(needsSuggestion(line(1, { classification_status: "Needs Manual Review" }))).toBe(false);
  });
});

describe("groupDuplicates", () => {
  it("groups lines whose normalised description and part number match", () => {
    const a = line(1, { desc: "Cotton T-Shirt, Blue" });
    const b = line(2, { desc: "cotton t-shirt blue" });
    const c = line(3, { desc: "Kitchen sink" });
    const groups = groupDuplicates([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0].leader.id).toBe(1);
    expect(groups[0].followers.map((f) => f.id)).toEqual([2]);
    expect(groups[1].leader.id).toBe(3);
  });

  it("keeps lines with different part numbers apart", () => {
    const a = line(1, { desc: "Widget", part_number: "A-1" });
    const b = line(2, { desc: "Widget", part_number: "B-2" });
    expect(groupDuplicates([a, b])).toHaveLength(2);
    expect(duplicateKey(a)).not.toBe(duplicateKey(b));
  });
});

describe("classificationProgress", () => {
  it("counts ready, failed, and completion", () => {
    const items = [
      withRecommendation(1),
      line(2, { classification_status: "Applied", tariff_code: "6109.10.10" }),
      line(3, { classification_status: "Failed" }),
      line(4),
    ];
    const p = classificationProgress(items, new Set([4]));
    expect(p).toEqual({ total: 4, ready: 3, failed: 1, complete: false });
    const done = classificationProgress(items.slice(0, 3), new Set());
    expect(done.complete).toBe(true);
  });

  it("is not complete while a ready line is still busy", () => {
    expect(classificationProgress([withRecommendation(1)], new Set([1])).complete).toBe(false);
  });
});

describe("strongMatches", () => {
  it("returns only unapplied lines whose top candidate is auto-applyable", () => {
    const weak = { ...strong, confidence: 0.7, confidenceLabel: "Likely Match" } as ClassificationRecommendationCandidate;
    const items = [
      withRecommendation(1),
      withRecommendation(2, weak),
      withRecommendation(3, strong, { classification_status: "Applied" }),
    ];
    expect(strongMatches(items).map((m) => m.item.id)).toEqual([1]);
  });
});

describe("splitQueue", () => {
  it("separates applied lines from exceptions, preserving order", () => {
    const items = [line(1), line(2, { classification_status: "AI Applied" }), line(3)];
    const { exceptions, applied } = splitQueue(items);
    expect(exceptions.map((i) => i.id)).toEqual([1, 3]);
    expect(applied.map((i) => i.id)).toEqual([2]);
  });
});

describe("shouldOfferStrongConfirm", () => {
  it("offers only once, when complete, with at least one strong match", () => {
    const complete = { total: 2, ready: 2, failed: 0, complete: true };
    expect(shouldOfferStrongConfirm(complete, 1, false)).toBe(true);
    expect(shouldOfferStrongConfirm(complete, 1, true)).toBe(false);
    expect(shouldOfferStrongConfirm(complete, 0, false)).toBe(false);
    expect(shouldOfferStrongConfirm({ ...complete, complete: false }, 1, false)).toBe(false);
  });
});

describe("messages", () => {
  it("titles the modal with correct plurals", () => {
    expect(strongConfirmTitle(1)).toBe("1 line is a strong match. Apply it?");
    expect(strongConfirmTitle(14)).toBe("14 lines are strong matches. Apply them?");
  });
  it("summarises batch results", () => {
    expect(batchApplySummary({ applied: 3, skipped: 0, failed: 0 })).toBe("Applied 3 lines.");
    expect(batchApplySummary({ applied: 1, skipped: 2, failed: 1 })).toBe(
      "Applied 1 line · 2 not strong matches, review individually · 1 failed, see the line for the reason.",
    );
    expect(batchApplySummary({ applied: 0, skipped: 0, failed: 0 })).toBe("Nothing to apply.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w apps/web -- --run src/features/review/classification-queue.test.ts`
Expected: FAIL — cannot resolve `./classification-queue`.

- [ ] **Step 3: Implement**

```ts
import type { ClassificationRecommendationCandidate, LineItem } from "@pas/shared-types";
import { normalizeDesc } from "@pas/tariff-data";
import { isAutoApplyable, isLineApplied, recommendationCandidates } from "./classification-helpers";

export const GENERATION_CONCURRENCY = 4;

const TERMINAL_STATUSES = new Set(["Failed", "Needs Manual Review"]);

/** Runs `worker` over `items` with at most `limit` in flight. A worker that throws does not stop the others. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await worker(item);
      } catch {
        // The worker records its own failure on the line.
      }
    }
  });
  await Promise.all(runners);
}

export function needsSuggestion(item: LineItem): boolean {
  if (!item.desc?.trim()) return false;
  if (item.classification_recommendation) return false;
  if (isLineApplied(item)) return false;
  return !TERMINAL_STATUSES.has(item.classification_status || "");
}

export function duplicateKey(item: LineItem): string {
  const desc = normalizeDesc(item.desc || "");
  if (!desc) return `id:${item.id}`;
  return `${desc}|${String(item.part_number || "").trim().toUpperCase()}`;
}

export interface DuplicateGroup {
  leader: LineItem;
  followers: LineItem[];
}

/** First line of each duplicate set leads; the rest reuse its suggestion. */
export function groupDuplicates(items: readonly LineItem[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const item of items) {
    const key = duplicateKey(item);
    const group = groups.get(key);
    if (group) group.followers.push(item);
    else groups.set(key, { leader: item, followers: [] });
  }
  return [...groups.values()];
}

export interface ClassificationProgress {
  total: number;
  ready: number;
  failed: number;
  complete: boolean;
}

export function classificationProgress(
  items: readonly LineItem[],
  busyIds: ReadonlySet<number>,
): ClassificationProgress {
  let ready = 0;
  let failed = 0;
  let busy = false;
  for (const item of items) {
    if (busyIds.has(item.id)) busy = true;
    const status = item.classification_status || "";
    if (status === "Failed" && !item.classification_recommendation) failed += 1;
    if (item.classification_recommendation || isLineApplied(item) || TERMINAL_STATUSES.has(status)) ready += 1;
  }
  return { total: items.length, ready, failed, complete: ready === items.length && !busy };
}

export interface StrongMatch {
  item: LineItem;
  candidate: ClassificationRecommendationCandidate;
}

export function strongMatches(items: readonly LineItem[]): StrongMatch[] {
  return items.flatMap((item) => {
    if (isLineApplied(item)) return [];
    const candidate = recommendationCandidates(item.classification_recommendation)[0];
    return candidate && isAutoApplyable(item, candidate) ? [{ item, candidate }] : [];
  });
}

export function splitQueue(items: readonly LineItem[]): { exceptions: LineItem[]; applied: LineItem[] } {
  const exceptions: LineItem[] = [];
  const applied: LineItem[] = [];
  for (const item of items) (isLineApplied(item) ? applied : exceptions).push(item);
  return { exceptions, applied };
}

export function shouldOfferStrongConfirm(
  progress: ClassificationProgress,
  strongCount: number,
  alreadyOffered: boolean,
): boolean {
  return progress.complete && strongCount > 0 && !alreadyOffered;
}

export function strongConfirmTitle(count: number): string {
  return count === 1
    ? "1 line is a strong match. Apply it?"
    : `${count} lines are strong matches. Apply them?`;
}

export function batchApplySummary(result: { applied: number; skipped: number; failed: number }): string {
  const parts: string[] = [];
  if (result.applied) parts.push(`Applied ${result.applied} line${result.applied === 1 ? "" : "s"}`);
  if (result.skipped) parts.push(`${result.skipped} not strong match${result.skipped === 1 ? "" : "es"}, review individually`);
  if (result.failed) parts.push(`${result.failed} failed, see the line for the reason`);
  return parts.length ? `${parts.join(" · ")}.` : "Nothing to apply.";
}
```

The `strong` fixture is auto-applyable through the approved-history path of `isAutoApplyable` (`historyMatch` + `historyConfirmations >= 2`). If the test still finds it not applyable, fix the **fixture** — do not loosen `isAutoApplyable`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/web -- --run src/features/review/classification-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/review/classification-queue.ts apps/web/src/features/review/classification-queue.test.ts
git commit -m "feat(web): pure classification queue helpers"
```

---

## Task 2: Concurrent generation, duplicate sharing, progress

**Files:**
- Modify: `apps/web/src/features/review/ClassificationWorkspace.tsx`
- Modify: `apps/web/src/features/review/ReviewPage.tsx`

- [ ] **Step 1: Replace the single `updatingLine` with a per-line busy set**

In `ReviewPage.tsx` delete `const [updatingLine, setUpdatingLine] = useState<number | null>(null);` and the `updatingLine=` / `setUpdatingLine=` props. In `ClassificationWorkspace.tsx` remove both props from the `Props` interface and destructuring, and add:

```tsx
const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());
const setBusy = useCallback((id: number, busy: boolean) => {
  setBusyIds((prev) => {
    if (prev.has(id) === busy) return prev;
    const next = new Set(prev);
    if (busy) next.add(id);
    else next.delete(id);
    return next;
  });
}, []);
```

Replace every `setUpdatingLine(x.id)` with `setBusy(x.id, true)`, every `setUpdatingLine(null)` with `setBusy(<same line id>, false)`, and every `updatingLine === activeItem.id` with `busyIds.has(activeItem.id)`. Update `useCallback` dependency arrays (`setUpdatingLine` → `setBusy`).

- [ ] **Step 2: Make `generateRecommendation` return a shareable patch**

Change its return type to `Promise<Partial<LineItem> | null>`. Return `null` on the non-merchandise early exit and in `catch`. On success, build the final patch object (the existing `patchItem(invId, target.id, {...})` argument) into a `const patch: Partial<LineItem>`, add the intelligence fields that were written with `editItem` so a follower receives the same state, call `patchItem(invId, target.id, patch)`, and `return patch`:

```tsx
const patch: Partial<LineItem> = {
  product_profile: profile,
  predictions: target.predictions,
  // ...the existing fields from the single patchItem call, unchanged...
};
```

Track the intelligence results in locals (`let predictions = target.predictions; let pendingQuestions = target.pending_questions; let explainability = target.explainability;`) and assign them where the `editItem(...)` calls already are, so `patch` contains `predictions`, `pending_questions`, `explainability`, and `product_profile` (the interpretation override still wins when `response.interpretation` is present, as today).

- [ ] **Step 3: Replace the one-at-a-time auto-generation effect**

```tsx
const generationRunning = useRef(false);
const [generationPass, setGenerationPass] = useState(0);

useEffect(() => {
  if (generationRunning.current) return;
  const pending = items.filter(
    (item) => needsSuggestion(item) && !autoGenerationAttempted.current.has(item.id),
  );
  if (!pending.length) return;
  pending.forEach((item) => autoGenerationAttempted.current.add(item.id));
  generationRunning.current = true;
  void runWithConcurrency(groupDuplicates(pending), GENERATION_CONCURRENCY, async ({ leader, followers }) => {
    followers.forEach((f) => setBusy(f.id, true));
    try {
      const shared = await generateRecommendation(leader);
      for (const follower of followers) {
        if (shared) {
          patchItem(invId, follower.id, shared);
        } else {
          setRecommendationErrors((errors) => ({ ...errors, [follower.id]: "Same description as a line that couldn't be classified." }));
          editItem(invId, follower.id, "classification_status", "Failed");
        }
      }
    } finally {
      followers.forEach((f) => setBusy(f.id, false));
    }
  }).finally(() => {
    generationRunning.current = false;
    setGenerationPass((n) => n + 1);
  });
}, [editItem, generateRecommendation, generationPass, invId, items, patchItem, setBusy]);
```

`generationPass` re-runs the effect after a pass so lines added mid-pass are picked up. Import `GENERATION_CONCURRENCY`, `groupDuplicates`, `needsSuggestion`, `runWithConcurrency` from `./classification-queue`.

- [ ] **Step 4: Show progress in the batch bar**

```tsx
const progress = useMemo(() => classificationProgress(items, busyIds), [items, busyIds]);
```

In `.dd-class-batch`, before the selection text:

```tsx
{!progress.complete && (
  <div className="text-[12px] font-semibold" role="status">
    Classifying {progress.ready} of {progress.total} lines…
  </div>
)}
```

- [ ] **Step 5: Verify**

Run: `npm test -w apps/web -- --run` → all pass. Run: `npm run typecheck` → no errors, then `git checkout -- apps/web/tsconfig.tsbuildinfo`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/review/ClassificationWorkspace.tsx apps/web/src/features/review/ReviewPage.tsx
git commit -m "feat(web): classify 4 lines at a time and share results across duplicate lines"
```

---

## Task 3: Strong-match confirm modal + batch feedback

**Files:**
- Modify: `packages/shared-types/src/index.ts` (in `InvoiceMeta`, after `sourceJobId`)
- Create: `apps/web/src/features/review/StrongMatchConfirmModal.tsx`
- Modify: `apps/web/src/features/review/ClassificationWorkspace.tsx`, `ReviewPage.tsx`

- [ ] **Step 1: Add the meta flag**

```ts
  /** The "apply strong matches" prompt was already shown for this invoice. */
  strongConfirmOffered?: boolean;
```

- [ ] **Step 2: Create the modal** (styling follows `components/invoice/InvoiceTotalsReviewModal.tsx`)

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { strongConfirmTitle, type StrongMatch } from "./classification-queue";

interface Props {
  matches: StrongMatch[];
  applying: boolean;
  onApply: (lineIds: number[]) => void;
  onDismiss: () => void;
}

export function StrongMatchConfirmModal({ matches, applying, onApply, onDismiss }: Props) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(matches.map((m) => m.item.id)));
  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--accent2)" }}>
          {strongConfirmTitle(matches.length)}
        </h2>
        <ul className="mt-4 space-y-1.5">
          {matches.map(({ item, candidate }) => (
            <li key={item.id}>
              <label className="flex items-start gap-2 rounded-lg border p-2 text-[12px]" style={{ borderColor: "var(--border)" }}>
                <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} disabled={applying} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.desc}</span>
                  <span className="font-mono font-semibold">{candidate.code}</span>{" "}
                  <span className="dd-text-muted">{candidate.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onDismiss} disabled={applying}>Review individually</Button>
          <Button onClick={() => onApply([...checked])} disabled={applying || checked.size === 0}>
            {applying ? "Applying…" : `Apply ${checked.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the workspace**

New props on `ClassificationWorkspace`: `strongConfirmOffered: boolean; onStrongConfirmOffered: () => void;`. In `ReviewPage`, pass `strongConfirmOffered={Boolean(activeInv.meta.strongConfirmOffered)}` and

```tsx
onStrongConfirmOffered={() =>
  setInvoices((p) =>
    p.map((inv) => (inv.id === activeInv.id ? { ...inv, meta: { ...inv.meta, strongConfirmOffered: true } } : inv)),
  )
}
```

In the workspace, one helper is used by both the modal and the batch button:

```tsx
const [batchMessage, setBatchMessage] = useState("");
const [applyingStrong, setApplyingStrong] = useState(false);
const strong = useMemo(() => strongMatches(items), [items]);
const showStrongConfirm = shouldOfferStrongConfirm(progress, strong.length, strongConfirmOffered);

const applyStrong = async (targets: LineItem[]) => {
  setApplyingStrong(true);
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  try {
    for (const item of targets) {
      const candidate = preferredCandidate(item);
      if (!isAutoApplyable(item, candidate)) {
        skipped += 1;
        continue;
      }
      if (await applyRecommendation(item, candidate!, false, { teach: false })) applied += 1;
      else failed += 1;
    }
  } finally {
    setApplyingStrong(false);
  }
  setBatchMessage(batchApplySummary({ applied, skipped, failed }));
};
```

Replace `batchApply` with `() => applyStrong(items.filter((i) => selectedIds.includes(i.id)))`. Render, at the end of the workspace root:

```tsx
{showStrongConfirm && (
  <StrongMatchConfirmModal
    matches={strong}
    applying={applyingStrong}
    onApply={(ids) => {
      void applyStrong(items.filter((i) => ids.includes(i.id))).finally(onStrongConfirmOffered);
    }}
    onDismiss={onStrongConfirmOffered}
  />
)}
```

and in `.dd-class-batch`: `{batchMessage && <div className="text-[12px]" role="status">{batchMessage}</div>}`.

- [ ] **Step 4: Verify** — `npm test -w apps/web -- --run` and `npm run typecheck` pass (revert tsbuildinfo).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/index.ts apps/web/src/features/review/StrongMatchConfirmModal.tsx apps/web/src/features/review/ClassificationWorkspace.tsx apps/web/src/features/review/ReviewPage.tsx
git commit -m "feat(web): one-time confirm modal for strong matches with batch result summary"
```

---

## Task 4: Exceptions queue + done banner

**Files:**
- Modify: `apps/web/src/features/review/LineQueuePanel.tsx`, `ClassificationWorkspace.tsx`, `ReviewPage.tsx`

- [ ] **Step 1: Split the queue**

In `LineQueuePanel`, extract the existing per-line JSX into a local `renderRow(item)` (same markup as today, keeping the original line number `#` from the item's index in `items`). Replace the sorted list with:

```tsx
const { exceptions, applied } = useMemo(() => splitQueue(items), [items]);
const activeIsApplied = applied.some((i) => i.id === activeId);
const [showApplied, setShowApplied] = useState(false);
const appliedOpen = showApplied || activeIsApplied;
```

Render `exceptions.map(renderRow)`; when `exceptions.length === 0` show `<div className="p-3 text-[12px] dd-text-muted">No lines need attention.</div>`. Below, when `applied.length > 0`:

```tsx
<button type="button" className="dd-class-queue-applied-toggle" onClick={() => setShowApplied((v) => !v)} aria-expanded={appliedOpen}>
  {appliedOpen ? "▾" : "▸"} {applied.length} applied
</button>
{appliedOpen && applied.map(renderRow)}
```

"Select all" now selects `exceptions` ids only. Add to `globals.css`:

```css
.dd-class-queue-applied-toggle {
  @apply w-full border-t px-3 py-2 text-left text-[12px] font-semibold;
  border-color: var(--border);
  color: var(--text2);
}
```

- [ ] **Step 2: Done banner**

New workspace prop `onContinue: () => void`; `ReviewPage` passes `onContinue={() => navigate("/duties-taxes")}`. In the workspace:

```tsx
const allClassified = progress.complete && splitQueue(items).exceptions.length === 0;
```

Render above `.dd-class-batch`:

```tsx
{allClassified && (
  <div className="dd-class-done-banner" role="status">
    <strong>All lines classified</strong>
    <Button onClick={onContinue}>Continue to Duties &amp; Taxes</Button>
  </div>
)}
```

```css
.dd-class-done-banner {
  @apply mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm;
  border-color: var(--green, var(--accent));
  background: var(--surface2);
}
```

- [ ] **Step 3: Verify** — tests + typecheck pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/review/LineQueuePanel.tsx apps/web/src/features/review/ClassificationWorkspace.tsx apps/web/src/features/review/ReviewPage.tsx apps/web/src/styles/globals.css
git commit -m "feat(web): exceptions-first line queue and all-classified banner"
```

---

## Task 5: Line screen simplification

**Files:**
- Modify: `apps/web/src/features/review/ClassificationCentre.tsx`, `ClassificationWorkspace.tsx`, `apps/web/src/styles/globals.css`
- Delete: `TariffPicker.tsx`, `ProductIntelligencePanel.tsx`, `CompositionPanel.tsx`, `ParsedDescriptionPanel.tsx` in `apps/web/src/features/review/`

- [ ] **Step 1: One primary action row on the recommendation card**

Replace the action row (`<div className="mt-4 flex flex-wrap gap-2">` … Regenerate) with:

```tsx
<div className="mt-4 flex flex-wrap gap-2">
  <Button
    onClick={() => {
      if (editing) {
        if (draft?.code) onApplyRecommendation(draft, true);
        return;
      }
      onApplyAndNext?.();
    }}
    disabled={updating || (editing ? !draft?.code : !preferred?.code || applied)}
  >
    {editing ? "Apply this code" : applied ? "Applied" : "Apply & Next"}
  </Button>
  <Button variant="secondary" onClick={() => setShowAlternatives((v) => !v)}>
    {showAlternatives ? "Hide choices" : "Choose another"}
  </Button>
  {question && (
    <Button
      variant="secondary"
      onClick={() => document.getElementById("dd-clarification-question")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
    >
      Answer question
    </Button>
  )}
  <Button variant="secondary" onClick={onSearchTariff}>Search tariff</Button>
</div>
```

The "Choose another" panel (`showAlternatives`) now always renders when open (remove the `candidates.length > 1` gate) and contains: the existing alternatives list (if any), then a row with `Enter a different code` (toggles `editing`; label `Cancel` while editing) and `Regenerate` (existing `onGenerateRecommendation()` button). Remove the `onSkip` prop from `Props` and its call site in the workspace.

- [ ] **Step 2: Failure state**

Replace the top `recommendationError` banner (`<strong>Classification failed.</strong>`) with, when `recommendationError && !preferred`:

```tsx
<section className="dd-class-card" role="alert">
  <div className="text-sm font-semibold">Couldn't classify this line.</div>
  <div className="mt-1 text-[12px] dd-text-muted">{recommendationError}</div>
  <div className="mt-3 flex gap-2">
    <Button onClick={() => onGenerateRecommendation()} disabled={updating}>Retry</Button>
    <Button variant="secondary" onClick={onSearchTariff}>Search tariff</Button>
  </div>
</section>
```

When a recommendation exists and an error is also set (e.g. a failed apply), keep a one-line error note above the card: `<div className="text-[12px]" style={{ color: "var(--red)" }}>{recommendationError}</div>`.

- [ ] **Step 3: One "More detail" toggle**

Add prop `moreDetail?: React.ReactNode` to `ClassificationCentre`. Rename the "Advanced details" section heading to `More detail` and render, when open, `{moreDetail}` followed by the existing advanced fields grid. In the workspace, pass as `moreDetail`:

```tsx
<>
  <AiAssistantPanel {/* existing props, unchanged */} />
  <ProductResolverPanel {/* existing props from the "Evidence & product memory" section, unchanged */} />
</>
```

Then delete from the workspace: the `dd-class-assistant-desktop` column, the "Evidence & product memory" section, the mobile `Open AI assistant` button, the `dd-class-drawer` block and `assistantOpen` state, and the `dd-class-sticky-actions` footer.

- [ ] **Step 4: CSS**

In `globals.css`, change the desktop `.dd-class-panels` columns to `minmax(200px, 240px) minmax(0, 1fr)` and delete the `.dd-class-assistant-desktop`, `.dd-class-sticky-actions`, and `.dd-class-drawer` rule blocks (including their media-query variants). Grep the web app for each removed class first; delete only if no remaining usages.

- [ ] **Step 5: Delete unused components**

Run `rg -l "TariffPicker|ProductIntelligencePanel|CompositionPanel|ParsedDescriptionPanel" apps/web/src` — expect only the four files themselves. Delete them.

- [ ] **Step 6: Verify** — tests + typecheck pass; `rg "setUpdatingLine|updatingLine|onSkip|dd-class-sticky-actions" apps/web/src` returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/features/review apps/web/src/styles/globals.css
git commit -m "feat(web): single primary action, More detail toggle, retry on failure; drop unused review panels"
```

---

## Task 6: Navigation — four job steps + Brokerage menu

**Files:**
- Create: `apps/web/src/lib/nav-config.ts`, `apps/web/src/lib/nav-config.test.ts`
- Modify: `apps/web/src/app/AppShell.tsx`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { BROKERAGE_LINKS, CLERK_TABS, activeTabFor, isBrokeragePath } from "./nav-config";

describe("nav config", () => {
  it("lists the job steps in order, then secondary tabs", () => {
    expect(CLERK_TABS.map((t) => t.label)).toEqual([
      "Dashboard", "Upload", "Classify", "Duties & Taxes", "Worksheet & Send", "Manual", "Brokerage",
    ]);
  });

  it("keeps FlowBoard and ASYCUDA under Brokerage", () => {
    expect(CLERK_TABS.some((t) => t.to === "/flowboard" || t.to === "/asycuda")).toBe(false);
    expect(BROKERAGE_LINKS.map((l) => l.to)).toEqual(["/brokerage", "/flowboard", "/asycuda"]);
    expect(activeTabFor("/flowboard", CLERK_TABS)?.to).toBe("/brokerage");
    expect(activeTabFor("/asycuda/123", CLERK_TABS)?.to).toBe("/brokerage");
    expect(isBrokeragePath("/flowboard")).toBe(true);
    expect(isBrokeragePath("/worksheet")).toBe(false);
  });

  it("matches ordinary tabs by prefix", () => {
    expect(activeTabFor("/classification", CLERK_TABS)?.label).toBe("Classify");
    expect(activeTabFor("/nowhere", CLERK_TABS)).toBeUndefined();
  });
});
```

Run: `npm test -w apps/web -- --run src/lib/nav-config.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
export type TabDef = {
  to: string;
  label: string;
  short: string;
  icon: string;
  badge?: "invoices" | "flowboard" | "reports";
  requiresInvoices?: boolean;
  adminOnly?: boolean;
  /** Extra path prefixes that highlight this tab. */
  matches?: string[];
};

export const BROKERAGE_LINKS = [
  { to: "/brokerage", label: "Brokerage calculator" },
  { to: "/flowboard", label: "FlowBoard" },
  { to: "/asycuda", label: "ASYCUDA" },
] as const;

export const CLERK_TABS: TabDef[] = [
  { to: "/dashboard", label: "Dashboard", short: "Home", icon: "📊" },
  { to: "/upload", label: "Upload", short: "Upload", icon: "📄" },
  { to: "/classification", label: "Classify", short: "Classify", icon: "📋", badge: "invoices", requiresInvoices: true },
  { to: "/duties-taxes", label: "Duties & Taxes", short: "Taxes", icon: "🧮" },
  { to: "/worksheet", label: "Worksheet & Send", short: "Send", icon: "📝" },
  { to: "/manual", label: "Manual", short: "Manual", icon: "✏️" },
  {
    to: "/brokerage",
    label: "Brokerage",
    short: "Broker",
    icon: "⚓",
    badge: "flowboard",
    matches: BROKERAGE_LINKS.map((l) => l.to),
  },
];

export function isBrokeragePath(pathname: string): boolean {
  return BROKERAGE_LINKS.some((l) => pathname.startsWith(l.to));
}

export function activeTabFor(pathname: string, tabs: readonly TabDef[]): TabDef | undefined {
  return tabs.find((t) => [t.to, ...(t.matches || [])].some((p) => pathname.startsWith(p)));
}
```

Run the test → PASS.

- [ ] **Step 3: Use it in `AppShell`**

- Delete the local `TabDef` type and `clerkTabs`; import `CLERK_TABS`, `BROKERAGE_LINKS`, `activeTabFor`, `isBrokeragePath`, `type TabDef` from `@/lib/nav-config`. Keep `adminTabs` in `AppShell` typed with the imported `TabDef`.
- `const activeTab = activeTabFor(location.pathname, tabs);`
- Desktop `NavLink` className: `cn('dd-tab no-underline', activeTab?.to === tab.to && 'dd-tab-active')` (so Brokerage stays highlighted on /flowboard and /asycuda).
- Below `</ScrollableTabNav>`, render the sub-nav on brokerage paths:

```tsx
{isBrokeragePath(location.pathname) && (
  <nav className="dd-subnav" aria-label="Brokerage">
    {BROKERAGE_LINKS.map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        className={({ isActive }) => cn('dd-subnav-link no-underline', isActive && 'dd-subnav-link-active')}
      >
        {link.label}
      </NavLink>
    ))}
  </nav>
)}
```

```css
.dd-subnav {
  @apply mb-4 flex flex-wrap gap-1.5;
}
.dd-subnav-link {
  @apply rounded-full border px-3 py-1 text-[12px];
  border-color: var(--border);
  color: var(--text2);
}
.dd-subnav-link-active {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent);
}
```

If `NAV_TAB_TIPS` in `@/lib/nav-tips` describes `/classification` or `/worksheet` with the old labels, update the wording to "Classify" / "Worksheet & Send".

- [ ] **Step 4: Verify** — tests + typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/nav-config.ts apps/web/src/lib/nav-config.test.ts apps/web/src/app/AppShell.tsx apps/web/src/lib/nav-tips.ts apps/web/src/styles/globals.css
git commit -m "feat(web): job-step navigation with FlowBoard and ASYCUDA under Brokerage"
```

---

## Task 7: End-to-end browser verification

No code unless a defect is found (then: systematic-debugging → failing test where the logic is pure → fix → re-run).

- [ ] **Step 1:** `npm test -w apps/web -- --run`, `npm test` at root (worker + packages), `npm run typecheck` — all pass; revert tsbuildinfo.
- [ ] **Step 2:** Start local dev (`--local` D1 only), sign in, upload an invoice with ≥ 8 lines including two identical descriptions. Confirm:
  1. Progress text `Classifying X of N lines…` climbs; network shows up to 4 concurrent `/recommendation` requests; the duplicate line gets a suggestion without its own `/recommendation` request.
  2. When done: modal appears if any line is a strong match (seed one by hand-applying the same description + code twice on an earlier invoice per Phase 2). Untick one, Apply → summary message; modal does not reappear after reload.
  3. Queue shows only unapplied lines; `N applied` expands and lines there are still editable.
  4. Line screen: `Apply & Next` is the only primary; `Choose another` shows alternatives / Enter a different code / Regenerate; `Answer question` only when a question exists; `More detail` reveals assistant, resolver, and fields; no sticky footer on a narrow (mobile) viewport.
  5. Force a failure (e.g. stop the worker mid-run) → `Couldn't classify this line.` with Retry / Search tariff; other lines continue.
  6. After all lines are applied → `All lines classified` banner → `Continue to Duties & Taxes` navigates.
  7. Tabs read Dashboard, Upload, Classify, Duties & Taxes, Worksheet & Send, Manual, Brokerage; /flowboard and /asycuda highlight Brokerage and show the sub-nav. **Do not send anything to FlowBoard.**
- [ ] **Step 3:** Record results in `.superpowers/sdd/p3-task-7-report.md` with screenshots.
