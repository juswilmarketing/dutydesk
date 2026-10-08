# Simplified Clerk Workflow & Classification Confidence — Design

**Date:** 2026-10-08
**Status:** Approved in brainstorming, pending spec review
**Approach:** Job Reset + Exception Queue (Approach 1)

## Problem

1. After a worksheet is sent, the previous job's invoices, lines and tax inputs remain on screen. Clerks must log out and back in to start clean. Cause: the active job lives only in browser storage (`pas-invoices-v2`, `dutydesk-workflow-v1` via zustand `persist`), and the only reset path is `clearLocalSessionData()` on logout.
2. The Classification screen is dense: three panels (line queue, Classification Centre, AI Assistant), duplicate Apply buttons, duplicate clarification UIs, two "advanced" collapsibles, and a six-stage pipeline bar.
3. "Strong match" is loosely defined (`item.recommendation_source === "ai_recommendation"` alone counts as strong in `batchApply`), so batch apply is not safe to automate.
4. The Classification stage shows "Needs Review" even after every line is applied, because applied AI suggestions keep `source === "ai"`.
5. Suggestions are generated one line at a time, so large invoices are slow to become reviewable.

## Goals

- Sending a worksheet closes the job and returns the clerk to an empty Upload screen — no logout.
- In-progress jobs are stored server-side and survive refresh / device change.
- Clerks confirm strong matches in one step and only work exception lines.
- Confidence reflects independent evidence, so "strong" is safe to bulk-apply.
- Measurable accuracy gate before each deploy.

## Non-goals

- Migrating from Cloudflare D1 to Supabase (separate future project).
- Redesigning Duties & Taxes or Worksheet screens beyond send/clear behaviour.

---

## 1. Server-side jobs, auto-closed on send

### Data model (new migration `0021_duty_jobs.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `status` | TEXT | `draft` \| `sent` \| `abandoned` |
| `job_type` | TEXT NULL | `classification_only` \| `brokerage_clearance` (set at send) |
| `worksheet_num` | TEXT NULL | |
| `consignee_id` | TEXT NULL | |
| `created_by` | TEXT | user id / name |
| `state_json` | TEXT | `{ invoices, activeInvId, itemExemptions, taxInputs, brokerageInputs, approvedTaxSheet }` |
| `created_at` / `updated_at` / `sent_at` | TEXT | ISO timestamps |

Partial unique index: one `draft` per `created_by`.

### Worker API (`apps/worker/src/routes/jobs.ts`)

- `GET /api/jobs/current` — returns the caller's open draft, or `null`.
- `PUT /api/jobs/current` — upsert draft `state_json` (creates draft if none).
- `POST /api/jobs/:id/sent` — `{ jobType, worksheetNum }` → status `sent`, `sent_at` set. Idempotent.
- `POST /api/jobs/:id/abandon` — status `abandoned`. Idempotent.

Sent/abandoned jobs are never returned by `/current`.

### Web behaviour

- **Upload** ensures a draft exists (creates via `PUT` if needed).
- **Autosave:** subscribe to invoice + workflow job fields; debounce ~1s; `PUT /api/jobs/current`. Browser persistence stays as an offline buffer until the server confirms.
- **App load / login:** fetch `/api/jobs/current`; if present, hydrate stores from `state_json`.
- **New `clearActiveJob()`** (in `apps/web/src/lib/session-reset.ts`): clears invoices, lines, activeInvId, itemExemptions, taxInputs, brokerageInputs, approvedTaxSheet, exchange rate. **Keeps** consignees, tax log, learned map, supplier history, auth.
- **On successful send:**
  - Classification Only: `WorksheetPage.handleClassificationSent` (after `EmailModal` `onSent`).
  - Brokerage: after `sendWorksheetToFlowBoard` resolves in `handleBrokerageSend`.
  - Sequence: `POST /sent` → `clearActiveJob()` → navigate `/upload` → toast *"Worksheet {num} sent. Ready for the next job."*
- **Start new job** button on Worksheet (and Upload when a draft exists): confirm dialog → `POST /abandon` → `clearActiveJob()` → `/upload`.
- **Failed send:** no clear; job stays `draft`.
- Logout keeps existing `clearLocalSessionData()`; the draft remains on the server and reloads on next login.

---

## 2. Classification: confirm strong, work exceptions

### Flow

1. **Generating** — suggestions run with bounded concurrency (4 lines in parallel) replacing the one-at-a-time `updatingLine` gate for auto-generation. Progress: *"Classifying 18 of 40 lines…"*.
2. **Confirm** — when every line has a recommendation (or a terminal failure), show a modal: *"14 lines are strong matches. Apply them?"* listing description + HS code with per-line checkboxes (default checked) → **Apply N**. Shown once per invoice; dismissible ("Review individually").
3. **Exceptions queue** — `LineQueuePanel` shows only non-applied lines by default; applied lines are collapsed under *"N applied"* (expandable, editable).
4. **Done** — when no exceptions remain: banner **"All lines classified → Continue to Duties & Taxes"**.

### Single strong-match rule

New pure function `isAutoApplyable(item, candidate)` in `apps/web/src/features/review/classification-helpers.ts`, used by the confirm modal and the batch-apply button. True only if **all** hold:

- `candidate.confidenceLabel === "Strong Match"` and `candidate.confidence >= 0.85`
- not `candidate.provisional`; no pending clarification; status not `clarification_needed` / `unable_to_classify`
- product family resolved and candidate passed compatibility (no contradiction flags)
- no conflict with supplier history / learned code (`classification_conflict` false)

The current `recommendation_source === "ai_recommendation"` shortcut is removed.

### Line screen

- Description → one suggested code + "Why" → **Apply**, **Choose another**, **Answer question** (only if one exists), **Search tariff**.
- AI Assistant panel, Product Resolver ("Evidence & product memory") and "Advanced details" move behind a single **More detail** toggle (collapsed by default).
- One Apply action (remove sticky-footer duplicate; keep **Apply & Next** as the card's primary).
- Delete unused review components: `TariffPicker.tsx`, `ProductIntelligencePanel.tsx`, `CompositionPanel.tsx`, `ParsedDescriptionPanel.tsx` (after confirming no imports).

### Workflow status fix

`getWorkflowStages` marks Classification **Complete** when every line has an applied `tariff_code` and `classification_status` in `Applied | AI Applied | Clerk Edited` — independent of `source`.

### Navigation

Primary steps: **Upload → Classify → Duties & Taxes → Worksheet & Send**. FlowBoard and ASYCUDA move to a secondary "Brokerage" menu in `AppShell`.

---

## 3. Accuracy & calibrated confidence

1. **Evidence-based confidence** (`packages/product-intelligence`, new `confidence-calibration.ts`). Final confidence combines:
   - Strong: approved supplier/product history or learned pair for this code; family resolved + compatibility pass.
   - Medium: T&T DB retrieval top candidate agrees with AI rerank; TTBizLink verified.
   - Penalties: AI vs DB disagreement; vague description (low token-role coverage); recent clerk correction on a similar description.
   `confidenceLabel` is derived from the calibrated score, not raw model confidence.
2. **History first** — exact approved supplier+description (or learned pair) short-circuits to that code as Strong.
3. **Dedup** — lines with the same normalised description within an invoice are classified once; result shared.
4. **Learn from corrections** — when a clerk changes an applied code or rejects a suggestion: save learned pair, and insert a row into `classification_test_cases` (migration 0018) with input + corrected code.
5. **One critical question** — ask only the highest-impact family question from existing profiles; answer triggers immediate rerank.
6. **Gate** — golden suite asserts **≥ 98% precision** on lines labelled Strong. If unmet, the Strong threshold is raised in config until it passes. Track post-apply override rate on Strong lines.

---

## 4. Error handling

| Situation | Behaviour |
|---|---|
| Suggestion fails for a line | Line shows "Couldn't classify — Retry / Search tariff"; others continue |
| Autosave fails | "Not saved — retrying" banner; browser copy kept until server confirms |
| Send fails | Job stays `draft`; error beside Send |
| Send OK, `/sent` call fails | Still clear UI; store `{ jobId, jobType, worksheetNum }` in localStorage key `dutydesk-pending-job-close`; retry in background, and on every app load flush pending closes **before** calling `GET /api/jobs/current`, so a sent job is never re-hydrated |
| Batch apply partial failure | Applied lines stay applied; failures return to exceptions with reason |

## 5. Testing

- **Unit (web):** `isAutoApplyable`; `clearActiveJob` keeps consignees/tax log and removes job fields; classification stage Complete rule; dedup grouping.
- **Unit (product-intelligence):** confidence calibration signals and penalties.
- **Worker:** jobs routes — create/upsert draft, single draft per user, `sent`/`abandon` idempotent, `/current` excludes closed jobs.
- **Golden regression:** ≥ 98% Strong precision, run before deploy.
- **Manual browser check:** upload → confirm batch → fix exceptions → duties → send → returns to empty Upload without logout; refresh mid-job restores draft.

## 6. Rollout (each phase shippable alone)

1. Server-side jobs + clear-after-send.
2. Strict `isAutoApplyable`, calibrated confidence, history-first.
3. Classification UI: concurrent generation, confirm modal, exceptions queue, More detail toggle, navigation.
4. Correction learning + golden expansion.
