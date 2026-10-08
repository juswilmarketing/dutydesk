# Phase 1: Server-Side Jobs & Clear-After-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each clerk's in-progress job in D1 as a draft, close it when the worksheet is sent (or abandoned), and return the clerk to an empty Upload screen without logging out.

**Architecture:** A new `duty_jobs` table plus a small Hono route (`/api/jobs`) owns draft/sent/abandoned state per user. The web app autosaves job-scoped store fields (debounced) to that route, hydrates from it after login, and calls a single `finishJob()` on successful send or "Start new job". Failed closes are queued in localStorage and flushed before any later load or save, so a sent job can never be re-hydrated or overwritten.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite), React 18 + zustand 5 + react-router 7, vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-08-simplified-workflow-design.md` (Section 1 and the error-handling rows for autosave / send).

## Global Constraints

- Statuses are exactly `draft`, `sent`, `abandoned`. Job types are exactly `classification_only`, `brokerage_clearance`.
- One open draft per user (`user_id`), enforced by a partial unique index.
- `state_json` maximum 1,500,000 bytes (UTF-8); larger payloads return HTTP 413.
- Autosave debounce 1000 ms; retry after failure 5000 ms. Jobs with zero invoices are never saved.
- Pending-close localStorage key: `dutydesk-pending-job-close`. It must survive logout (not in `SESSION_STORAGE_KEYS`).
- `clearActiveJob()` keeps consignee list, tax log, learned map, supplier history, shared exchange rate, auth.
- Close endpoints are idempotent: closing an already-closed job returns `200 { ok: true, status }`.
- Web tests run from `apps/web` with `npx vitest run <file>`; worker tests from `apps/worker` with `npx vitest run <file>`.

## File Map

| File | Responsibility |
|---|---|
| `migrations/0021_duty_jobs.sql` (create) | `duty_jobs` table + indexes |
| `apps/worker/src/lib/duty-jobs.ts` (create) | Pure payload validation for draft save / close |
| `apps/worker/src/lib/duty-jobs.test.ts` (create) | Tests for the above |
| `apps/worker/src/routes/jobs.ts` (create) | `GET/PUT /current`, `POST /:id/sent`, `POST /:id/abandon` |
| `apps/worker/src/index.ts` (modify) | Mount `/jobs` on `protectedApi` |
| `apps/web/src/lib/job-state.ts` (create) | `JobState` type, pick/empty/validate helpers, Upload notice type |
| `apps/web/src/lib/job-state.test.ts` (create) | Tests |
| `apps/web/src/lib/job-close-queue.ts` (create) | Pending-close queue over an injected storage |
| `apps/web/src/lib/job-close-queue.test.ts` (create) | Tests |
| `apps/web/src/lib/api-client.ts` (modify) | Export `ApiError`; add 4 job API methods |
| `apps/web/src/stores/invoice-store.ts`, `workflow-store.ts` (modify) | `clearJob()` actions |
| `apps/web/src/lib/session-reset.ts` (modify) | `clearActiveJob()` |
| `apps/web/src/stores/job-sync-store.ts` (create) | Save status for the UI |
| `apps/web/src/lib/job-sync.ts` (create) | Autosave, hydrate, flush, `finishJob()` |
| `apps/web/src/components/workflow/JobSaveIndicator.tsx` (create) | "Not saved — retrying" banner |
| `apps/web/src/app/App.tsx`, `AppShell.tsx`, `stores/auth-store.ts` (modify) | Wire hydrate/autosave/indicator/logout flush |
| `apps/web/src/features/worksheet/WorksheetPage.tsx` (modify) | Finish job on send; Start new job |
| `apps/web/src/features/upload/UploadPage.tsx` (modify) | Sent banner; Start new job |

---

### Task 1: `duty_jobs` table and worker payload validation

**Files:**
- Create: `migrations/0021_duty_jobs.sql`
- Create: `apps/worker/src/lib/duty-jobs.ts`
- Test: `apps/worker/src/lib/duty-jobs.test.ts`

**Interfaces:**
- Produces: `MAX_JOB_STATE_BYTES`, `DutyJobStatus`, `DutyJobType`, `parseDraftPayload(body: unknown): ParsedDraft`, `parseClosePayload(body: unknown): ParsedClose` (types below).

- [ ] **Step 1: Write the migration**

`migrations/0021_duty_jobs.sql`:

```sql
-- One in-progress clerk job per user; closed when sent or abandoned.

CREATE TABLE IF NOT EXISTS duty_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'abandoned')),
  job_type TEXT CHECK (job_type IS NULL OR job_type IN ('classification_only', 'brokerage_clearance')),
  worksheet_num TEXT,
  consignee_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_duty_jobs_one_draft_per_user
  ON duty_jobs(user_id) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_duty_jobs_user_status
  ON duty_jobs(user_id, status, updated_at DESC);
```

- [ ] **Step 2: Write the failing tests**

`apps/worker/src/lib/duty-jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_JOB_STATE_BYTES, parseClosePayload, parseDraftPayload } from "./duty-jobs";

describe("parseDraftPayload", () => {
  it("rejects a non-object body", () => {
    expect(parseDraftPayload(null)).toEqual({ ok: false, status: 400, error: "Missing job state" });
  });

  it("rejects state without an invoices array", () => {
    expect(parseDraftPayload({ state: { invoices: "x" } })).toEqual({
      ok: false,
      status: 400,
      error: "Job state must include an invoices array",
    });
  });

  it("rejects state larger than the limit", () => {
    const big = "x".repeat(MAX_JOB_STATE_BYTES);
    const result = parseDraftPayload({ state: { invoices: [{ filename: big }] } });
    expect(result).toEqual({ ok: false, status: 413, error: "Job is too large to save" });
  });

  it("extracts worksheet number and consignee from valid state", () => {
    const state = {
      invoices: [{ id: 1 }],
      taxInputs: { worksheetNum: "  WS-100 " },
      activeConsigneeId: "c_1",
    };
    expect(parseDraftPayload({ state })).toEqual({
      ok: true,
      stateJson: JSON.stringify(state),
      worksheetNum: "WS-100",
      consigneeId: "c_1",
    });
  });

  it("uses nulls when worksheet number and consignee are blank", () => {
    const result = parseDraftPayload({ state: { invoices: [], taxInputs: { worksheetNum: "" } } });
    expect(result).toMatchObject({ ok: true, worksheetNum: null, consigneeId: null });
  });
});

describe("parseClosePayload", () => {
  it("accepts an empty body", () => {
    expect(parseClosePayload(undefined)).toEqual({ ok: true, jobType: null, worksheetNum: null });
  });

  it("accepts a valid job type and worksheet number", () => {
    expect(parseClosePayload({ jobType: "brokerage_clearance", worksheetNum: " WS-9 " })).toEqual({
      ok: true,
      jobType: "brokerage_clearance",
      worksheetNum: "WS-9",
    });
  });

  it("rejects an unknown job type", () => {
    expect(parseClosePayload({ jobType: "other" })).toEqual({ ok: false, error: "Invalid job type" });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `apps/worker`): `npx vitest run src/lib/duty-jobs.test.ts`
Expected: FAIL — `Failed to resolve import "./duty-jobs"`.

- [ ] **Step 4: Implement**

`apps/worker/src/lib/duty-jobs.ts`:

```ts
export const MAX_JOB_STATE_BYTES = 1_500_000;

export type DutyJobStatus = "draft" | "sent" | "abandoned";
export type DutyJobType = "classification_only" | "brokerage_clearance";

const JOB_TYPES: readonly DutyJobType[] = ["classification_only", "brokerage_clearance"];

export type ParsedDraft =
  | { ok: true; stateJson: string; worksheetNum: string | null; consigneeId: string | null }
  | { ok: false; status: 400 | 413; error: string };

export type ParsedClose =
  | { ok: true; jobType: DutyJobType | null; worksheetNum: string | null }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseDraftPayload(body: unknown): ParsedDraft {
  if (!isRecord(body) || !isRecord(body.state)) {
    return { ok: false, status: 400, error: "Missing job state" };
  }
  const state = body.state;
  if (!Array.isArray(state.invoices)) {
    return { ok: false, status: 400, error: "Job state must include an invoices array" };
  }
  const stateJson = JSON.stringify(state);
  if (new TextEncoder().encode(stateJson).length > MAX_JOB_STATE_BYTES) {
    return { ok: false, status: 413, error: "Job is too large to save" };
  }
  const taxInputs = isRecord(state.taxInputs) ? state.taxInputs : {};
  return {
    ok: true,
    stateJson,
    worksheetNum: trimmedOrNull(taxInputs.worksheetNum),
    consigneeId: trimmedOrNull(state.activeConsigneeId),
  };
}

export function parseClosePayload(body: unknown): ParsedClose {
  const payload = isRecord(body) ? body : {};
  const rawType = payload.jobType;
  if (rawType !== undefined && rawType !== null && !JOB_TYPES.includes(rawType as DutyJobType)) {
    return { ok: false, error: "Invalid job type" };
  }
  return {
    ok: true,
    jobType: (rawType as DutyJobType | undefined) ?? null,
    worksheetNum: trimmedOrNull(payload.worksheetNum),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/worker`): `npx vitest run src/lib/duty-jobs.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Apply the migration locally and check the draft index**

Run (from repo root):

```bash
npx wrangler d1 migrations apply pas-trinidad --local
npx wrangler d1 execute pas-trinidad --local --command "INSERT INTO duty_jobs (id,user_id,status,created_at,updated_at) VALUES ('t1',999,'draft','x','x'); INSERT INTO duty_jobs (id,user_id,status,created_at,updated_at) VALUES ('t2',999,'draft','x','x');"
```

Expected: migration `0021_duty_jobs.sql` applied; the second statement fails with `UNIQUE constraint failed: duty_jobs.user_id`.

Clean up:

```bash
npx wrangler d1 execute pas-trinidad --local --command "DELETE FROM duty_jobs WHERE user_id = 999;"
```

- [ ] **Step 7: Commit**

```bash
git add migrations/0021_duty_jobs.sql apps/worker/src/lib/duty-jobs.ts apps/worker/src/lib/duty-jobs.test.ts
git commit -m "feat(worker): duty_jobs table and job payload validation"
```

---

### Task 2: `/api/jobs` route

**Files:**
- Create: `apps/worker/src/routes/jobs.ts`
- Modify: `apps/worker/src/index.ts` (imports block lines 1-23; `protectedApi.route(...)` block lines 47-61)

**Interfaces:**
- Consumes: `parseDraftPayload`, `parseClosePayload`, `DutyJobStatus` from Task 1.
- Produces HTTP API (all behind `authMiddleware`, scoped to `c.var.userId`):
  - `GET /api/jobs/current` → `200 { job: { id: string; state: unknown; updatedAt: string } | null }`
  - `PUT /api/jobs/current` body `{ state }` → `200 { id: string; updatedAt: string }` | `400` | `413`
  - `POST /api/jobs/:id/sent` body `{ jobType?, worksheetNum? }` → `200 { ok: true; status: DutyJobStatus }` | `400` | `404`
  - `POST /api/jobs/:id/abandon` → `200 { ok: true; status: DutyJobStatus }` | `404`

- [ ] **Step 1: Write the route**

`apps/worker/src/routes/jobs.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, AppVariables } from "../env";
import { parseClosePayload, parseDraftPayload, type DutyJobStatus } from "../lib/duty-jobs";

type JobsEnv = { Bindings: Env; Variables: AppVariables };

const jobs = new Hono<JobsEnv>();

async function findDraftId(c: Context<JobsEnv>): Promise<string | null> {
  const row = await c.env.DB.prepare(
    "SELECT id FROM duty_jobs WHERE user_id = ? AND status = 'draft' LIMIT 1",
  )
    .bind(c.var.userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

jobs.get("/current", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, state_json, updated_at FROM duty_jobs WHERE user_id = ? AND status = 'draft' LIMIT 1",
  )
    .bind(c.var.userId)
    .first<{ id: string; state_json: string; updated_at: string }>();
  if (!row) return c.json({ job: null });
  return c.json({ job: { id: row.id, state: JSON.parse(row.state_json), updatedAt: row.updated_at } });
});

jobs.put("/current", async (c) => {
  const parsed = parseDraftPayload(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  const now = new Date().toISOString();
  const update = (id: string) =>
    c.env.DB.prepare(
      `UPDATE duty_jobs SET state_json = ?, worksheet_num = ?, consignee_id = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
      .bind(parsed.stateJson, parsed.worksheetNum, parsed.consigneeId, now, id)
      .run();

  const existingId = await findDraftId(c);
  if (existingId) {
    await update(existingId);
    return c.json({ id: existingId, updatedAt: now });
  }

  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO duty_jobs (id, user_id, created_by, status, state_json, worksheet_num, consignee_id, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    )
      .bind(id, c.var.userId, c.var.name || c.var.username, parsed.stateJson, parsed.worksheetNum, parsed.consigneeId, now, now)
      .run();
    return c.json({ id, updatedAt: now });
  } catch {
    // Another request created the draft first (unique draft-per-user index).
    const racedId = await findDraftId(c);
    if (!racedId) throw new Error("Failed to save job draft");
    await update(racedId);
    return c.json({ id: racedId, updatedAt: now });
  }
});

async function closeJob(c: Context<JobsEnv>, status: Exclude<DutyJobStatus, "draft">) {
  const id = c.req.param("id") ?? "";
  const parsed = parseClosePayload(status === "sent" ? await c.req.json().catch(() => undefined) : undefined);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const row = await c.env.DB.prepare("SELECT status FROM duty_jobs WHERE id = ? AND user_id = ?")
    .bind(id, c.var.userId)
    .first<{ status: DutyJobStatus }>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.status !== "draft") return c.json({ ok: true, status: row.status });

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE duty_jobs
     SET status = ?, job_type = COALESCE(?, job_type), worksheet_num = COALESCE(?, worksheet_num),
         sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
     WHERE id = ? AND status = 'draft'`,
  )
    .bind(status, parsed.jobType, parsed.worksheetNum, status, now, now, id)
    .run();
  return c.json({ ok: true, status });
}

jobs.post("/:id/sent", (c) => closeJob(c, "sent"));
jobs.post("/:id/abandon", (c) => closeJob(c, "abandoned"));

export default jobs;
```

- [ ] **Step 2: Mount the route**

In `apps/worker/src/index.ts`, add after `import supplierSearchRoutes from "./routes/supplier-search";`:

```ts
import jobsRoutes from "./routes/jobs";
```

and after `protectedApi.route("/document-processing", documentProcessingRoutes);`:

```ts
protectedApi.route("/jobs", jobsRoutes);
```

- [ ] **Step 3: Typecheck**

Run (from `apps/worker`): `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 4: Smoke-test against local D1**

Start the worker: `npm run dev:worker` (repo root). Log in through the web app (or `POST /api/auth/login`) and copy the session cookie value, then:

```bash
curl -s -b "<SESSION_COOKIE_NAME>=<value>" http://localhost:8787/api/jobs/current
curl -s -b "<SESSION_COOKIE_NAME>=<value>" -X PUT -H "Content-Type: application/json" -d '{"state":{"invoices":[{"id":1}],"taxInputs":{"worksheetNum":"WS-1"}}}' http://localhost:8787/api/jobs/current
curl -s -b "<SESSION_COOKIE_NAME>=<value>" http://localhost:8787/api/jobs/current
curl -s -b "<SESSION_COOKIE_NAME>=<value>" -X POST -H "Content-Type: application/json" -d '{"jobType":"classification_only"}' http://localhost:8787/api/jobs/<id>/sent
curl -s -b "<SESSION_COOKIE_NAME>=<value>" -X POST http://localhost:8787/api/jobs/<id>/sent
curl -s -b "<SESSION_COOKIE_NAME>=<value>" http://localhost:8787/api/jobs/current
```

(`SESSION_COOKIE` is exported from `apps/worker/src/lib/utils.ts`.)

Expected, in order: `{"job":null}`; `{"id":"<uuid>",...}`; job with that id and the state; `{"ok":true,"status":"sent"}`; `{"ok":true,"status":"sent"}` (idempotent); `{"job":null}`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/jobs.ts apps/worker/src/index.ts
git commit -m "feat(worker): /api/jobs draft, sent and abandon endpoints"
```

---

### Task 3: Web job-state helpers and pending-close queue

**Files:**
- Create: `apps/web/src/lib/job-state.ts`, `apps/web/src/lib/job-state.test.ts`
- Create: `apps/web/src/lib/job-close-queue.ts`, `apps/web/src/lib/job-close-queue.test.ts`

**Interfaces:**
- Produces (`job-state.ts`): `interface JobState`, `pickJobState(inv, wf): JobState`, `hasJobContent(state): boolean`, `emptyJobState(defaults): JobState`, `isJobState(value): value is JobState`, `interface JobFinishedNotice { message: string; flowboardJobUrl?: string }`, `interface UploadLocationState { jobFinished?: JobFinishedNotice }`.
- Produces (`job-close-queue.ts`): `PENDING_JOB_CLOSE_KEY`, `interface KeyValueStorage`, `type PendingJobClose`, `readPendingCloses(storage)`, `enqueuePendingClose(storage, entry)`, `removePendingClose(storage, jobId)`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/job-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BrokerageInputs, Invoice, TaxInputs } from "@pas/shared-types";
import { emptyJobState, hasJobContent, isJobState, pickJobState } from "./job-state";

const taxInputs = { worksheetNum: "WS-1" } as TaxInputs;
const brokerageInputs = { cifUSD: "" } as BrokerageInputs;
const invoice = { id: 1, filename: "a.pdf" } as Invoice;

describe("pickJobState", () => {
  it("keeps only job fields", () => {
    const state = pickJobState(
      { invoices: [invoice], activeInvId: 1, itemExemptions: {}, learnedMap: { x: {} } } as never,
      { taxInputs, brokerageInputs, approvedTaxSheet: null, activeConsigneeId: "c_1", consignees: [] } as never,
    );
    expect(state).toEqual({
      invoices: [invoice],
      activeInvId: 1,
      itemExemptions: {},
      taxInputs,
      brokerageInputs,
      approvedTaxSheet: null,
      activeConsigneeId: "c_1",
    });
  });
});

describe("hasJobContent", () => {
  it("is true only when invoices are loaded", () => {
    expect(hasJobContent({ invoices: [] })).toBe(false);
    expect(hasJobContent({ invoices: [invoice] })).toBe(true);
  });
});

describe("emptyJobState", () => {
  it("copies defaults so callers cannot mutate them", () => {
    const state = emptyJobState({ taxInputs, brokerageInputs });
    expect(state.invoices).toEqual([]);
    expect(state.taxInputs).toEqual(taxInputs);
    expect(state.taxInputs).not.toBe(taxInputs);
    expect(state.activeConsigneeId).toBeNull();
  });
});

describe("isJobState", () => {
  it("accepts a complete state", () => {
    expect(isJobState(emptyJobState({ taxInputs, brokerageInputs }))).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isJobState(null)).toBe(false);
    expect(isJobState({ invoices: [] })).toBe(false);
    expect(isJobState({ ...emptyJobState({ taxInputs, brokerageInputs }), invoices: "x" })).toBe(false);
  });
});
```

`apps/web/src/lib/job-close-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PENDING_JOB_CLOSE_KEY,
  enqueuePendingClose,
  readPendingCloses,
  removePendingClose,
  type KeyValueStorage,
} from "./job-close-queue";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("job close queue", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readPendingCloses(memoryStorage())).toEqual([]);
  });

  it("returns an empty list for corrupt data", () => {
    expect(readPendingCloses(memoryStorage({ [PENDING_JOB_CLOSE_KEY]: "{oops" }))).toEqual([]);
  });

  it("enqueues and replaces entries with the same job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "a", status: "sent", jobType: "classification_only", worksheetNum: "WS-1" });
    enqueuePendingClose(storage, { jobId: "b", status: "abandoned" });
    expect(readPendingCloses(storage)).toEqual([
      { jobId: "a", status: "sent", jobType: "classification_only", worksheetNum: "WS-1" },
      { jobId: "b", status: "abandoned" },
    ]);
  });

  it("removes an entry by job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "b", status: "abandoned" });
    removePendingClose(storage, "a");
    expect(readPendingCloses(storage)).toEqual([{ jobId: "b", status: "abandoned" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/web`): `npx vitest run src/lib/job-state.test.ts src/lib/job-close-queue.test.ts`
Expected: FAIL — both modules fail to resolve.

- [ ] **Step 3: Implement**

`apps/web/src/lib/job-state.ts`:

```ts
import type { ApprovedTaxSheet, BrokerageInputs, Invoice, ItemExemptions, TaxInputs } from "@pas/shared-types";

/** The per-job slice of the invoice + workflow stores that is saved to the server. */
export interface JobState {
  invoices: Invoice[];
  activeInvId: number | null;
  itemExemptions: Record<number, ItemExemptions>;
  taxInputs: TaxInputs;
  brokerageInputs: BrokerageInputs;
  approvedTaxSheet: ApprovedTaxSheet | null;
  activeConsigneeId: string | null;
}

export interface JobFinishedNotice {
  message: string;
  flowboardJobUrl?: string;
}

export interface UploadLocationState {
  jobFinished?: JobFinishedNotice;
}

export function pickJobState(
  inv: Pick<JobState, "invoices" | "activeInvId" | "itemExemptions">,
  wf: Pick<JobState, "taxInputs" | "brokerageInputs" | "approvedTaxSheet" | "activeConsigneeId">,
): JobState {
  return {
    invoices: inv.invoices,
    activeInvId: inv.activeInvId,
    itemExemptions: inv.itemExemptions,
    taxInputs: wf.taxInputs,
    brokerageInputs: wf.brokerageInputs,
    approvedTaxSheet: wf.approvedTaxSheet,
    activeConsigneeId: wf.activeConsigneeId,
  };
}

export function hasJobContent(state: Pick<JobState, "invoices">): boolean {
  return state.invoices.length > 0;
}

export function emptyJobState(defaults: { taxInputs: TaxInputs; brokerageInputs: BrokerageInputs }): JobState {
  return {
    invoices: [],
    activeInvId: null,
    itemExemptions: {},
    taxInputs: { ...defaults.taxInputs },
    brokerageInputs: { ...defaults.brokerageInputs },
    approvedTaxSheet: null,
    activeConsigneeId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJobState(value: unknown): value is JobState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.invoices) &&
    (value.activeInvId === null || typeof value.activeInvId === "number") &&
    isRecord(value.itemExemptions) &&
    isRecord(value.taxInputs) &&
    isRecord(value.brokerageInputs) &&
    (value.approvedTaxSheet === null || isRecord(value.approvedTaxSheet)) &&
    (value.activeConsigneeId === null || typeof value.activeConsigneeId === "string")
  );
}
```

`apps/web/src/lib/job-close-queue.ts`:

```ts
import type { DutyDeskJobType } from "@pas/shared-types";

/** Survives logout on purpose: a sent job must be closed on the server even if the clerk signs out first. */
export const PENDING_JOB_CLOSE_KEY = "dutydesk-pending-job-close";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PendingJobClose =
  | { jobId: string; status: "sent"; jobType: DutyDeskJobType; worksheetNum: string }
  | { jobId: string; status: "abandoned" };

export function readPendingCloses(storage: KeyValueStorage): PendingJobClose[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PENDING_JOB_CLOSE_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as PendingJobClose[]) : [];
  } catch {
    return [];
  }
}

function write(storage: KeyValueStorage, entries: PendingJobClose[]) {
  storage.setItem(PENDING_JOB_CLOSE_KEY, JSON.stringify(entries));
}

export function enqueuePendingClose(storage: KeyValueStorage, entry: PendingJobClose) {
  const entries = readPendingCloses(storage);
  const index = entries.findIndex((e) => e.jobId === entry.jobId);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  write(storage, entries);
}

export function removePendingClose(storage: KeyValueStorage, jobId: string) {
  write(storage, readPendingCloses(storage).filter((e) => e.jobId !== jobId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/web`): `npx vitest run src/lib/job-state.test.ts src/lib/job-close-queue.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/job-state.ts apps/web/src/lib/job-state.test.ts apps/web/src/lib/job-close-queue.ts apps/web/src/lib/job-close-queue.test.ts
git commit -m "feat(web): job state helpers and pending job-close queue"
```

---

### Task 4: API methods, store `clearJob` actions, `clearActiveJob()`

**Files:**
- Modify: `apps/web/src/lib/api-client.ts` (line 35 `class ApiError`; `api` object near `getTaxLog`, line ~1017)
- Modify: `apps/web/src/stores/invoice-store.ts`
- Modify: `apps/web/src/stores/workflow-store.ts`
- Modify: `apps/web/src/lib/session-reset.ts`

**Interfaces:**
- Consumes: `JobState` (Task 3).
- Produces: exported `ApiError` (has `.status: number`); `api.getCurrentJob()`, `api.saveCurrentJob(state)`, `api.markJobSent(id, payload)`, `api.abandonJob(id)`; `useInvoiceStore.getState().clearJob()`, `useWorkflowStore.getState().clearJob()`; `clearActiveJob(): void`.

- [ ] **Step 1: Export `ApiError`**

In `apps/web/src/lib/api-client.ts` change line 35:

```ts
class ApiError extends Error {
```

to:

```ts
export class ApiError extends Error {
```

- [ ] **Step 2: Add job API methods**

Add `DutyDeskJobType,` to the existing `import type { ... } from "@pas/shared-types";` list at the top of `api-client.ts`, and add below that import:

```ts
import type { JobState } from "@/lib/job-state";
```

Add inside the `api` object, directly after `appendTaxLogRemote`:

```ts
  getCurrentJob: () =>
    request<{ job: { id: string; state: unknown; updatedAt: string } | null }>("/api/jobs/current"),

  saveCurrentJob: (state: JobState) =>
    request<{ id: string; updatedAt: string }>("/api/jobs/current", {
      method: "PUT",
      body: JSON.stringify({ state }),
    }),

  markJobSent: (id: string, payload: { jobType: DutyDeskJobType; worksheetNum: string }) =>
    request<{ ok: boolean; status: string }>(`/api/jobs/${encodeURIComponent(id)}/sent`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  abandonJob: (id: string) =>
    request<{ ok: boolean; status: string }>(`/api/jobs/${encodeURIComponent(id)}/abandon`, {
      method: "POST",
    }),
```

- [ ] **Step 3: Add `clearJob` to the invoice store**

In `apps/web/src/stores/invoice-store.ts`, add to `interface InvoiceState` after `resetSession: () => void;`:

```ts
  /** Clear the active job only; keeps learned map, supplier history and exchange rate. */
  clearJob: () => void;
```

and in the store body after the `resetSession` implementation:

```ts
      clearJob: () =>
        set({
          invoices: [],
          activeInvId: null,
          itemExemptions: {},
        }),
```

- [ ] **Step 4: Add `clearJob` to the workflow store**

In `apps/web/src/stores/workflow-store.ts`, add to `interface WorkflowState` after `resetSession: () => void;`:

```ts
  /** Clear the active job only; keeps consignee list and tax log. */
  clearJob: () => void;
```

and after the `resetSession` implementation:

```ts
      clearJob: () =>
        set({
          activeConsigneeId: null,
          approvedTaxSheet: null,
          taxInputs: { ...DEFAULT_TAX_INPUTS },
          brokerageInputs: defaultBrokerageInputs(),
        }),
```

- [ ] **Step 5: Add `clearActiveJob()`**

Append to `apps/web/src/lib/session-reset.ts`:

```ts
/** Clear the current job after it is sent or abandoned, without signing out. */
export function clearActiveJob() {
  useInvoiceStore.getState().clearJob();
  useWorkflowStore.getState().clearJob();
}
```

- [ ] **Step 6: Typecheck**

Run (from `apps/web`): `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/stores/invoice-store.ts apps/web/src/stores/workflow-store.ts apps/web/src/lib/session-reset.ts
git commit -m "feat(web): job API client and clearActiveJob"
```

---

### Task 5: Autosave, hydrate, `finishJob`, save indicator

**Files:**
- Create: `apps/web/src/stores/job-sync-store.ts`
- Create: `apps/web/src/lib/job-sync.ts`
- Create: `apps/web/src/components/workflow/JobSaveIndicator.tsx`
- Modify: `apps/web/src/app/App.tsx` (`ProtectedRoutes`, lines 57-75)
- Modify: `apps/web/src/app/AppShell.tsx` (line 176 `<main>`)
- Modify: `apps/web/src/stores/auth-store.ts` (`logout`)

**Interfaces:**
- Consumes: Tasks 3-4.
- Produces: `startJobAutosave(): () => void`, `hydrateJobFromServer(): Promise<void>`, `flushJobAutosave(): Promise<void>`, `finishJob(close: FinishJobInput): Promise<void>`, `START_NEW_JOB_CONFIRM: string`, `type FinishJobInput = { status: "sent"; jobType: DutyDeskJobType; worksheetNum: string } | { status: "abandoned" }`; `useJobSyncStore` with `saveState: "idle" | "saving" | "saved" | "error"` and `error: string`.

- [ ] **Step 1: Save-status store**

`apps/web/src/stores/job-sync-store.ts`:

```ts
import { create } from "zustand";

export type JobSaveState = "idle" | "saving" | "saved" | "error";

interface JobSyncState {
  saveState: JobSaveState;
  error: string;
  setSaveState: (saveState: JobSaveState, error?: string) => void;
}

export const useJobSyncStore = create<JobSyncState>((set) => ({
  saveState: "idle",
  error: "",
  setSaveState: (saveState, error = "") => set({ saveState, error }),
}));
```

- [ ] **Step 2: Job sync module**

`apps/web/src/lib/job-sync.ts`:

```ts
import type { DutyDeskJobType } from "@pas/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { hasJobContent, isJobState, pickJobState, type JobState } from "@/lib/job-state";
import { enqueuePendingClose, readPendingCloses, removePendingClose } from "@/lib/job-close-queue";
import { clearActiveJob } from "@/lib/session-reset";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useJobSyncStore } from "@/stores/job-sync-store";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;

export const START_NEW_JOB_CONFIRM =
  "Discard this job and start a new one? The current invoice, classifications and tax entries will be cleared.";

export type FinishJobInput =
  | { status: "sent"; jobType: DutyDeskJobType; worksheetNum: string }
  | { status: "abandoned" };

let currentJobId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let suspended = false;

function currentState(): JobState {
  return pickJobState(useInvoiceStore.getState(), useWorkflowStore.getState());
}

function applyJobState(state: JobState) {
  useInvoiceStore.setState({
    invoices: state.invoices,
    activeInvId: state.activeInvId,
    itemExemptions: state.itemExemptions,
  });
  useWorkflowStore.setState({
    taxInputs: state.taxInputs,
    brokerageInputs: state.brokerageInputs,
    approvedTaxSheet: state.approvedTaxSheet,
    activeConsigneeId: state.activeConsigneeId,
  });
}

/** Retry queued closes. Returns ids that are still pending (server unreachable). */
async function flushPendingJobCloses(): Promise<Set<string>> {
  const stillPending = new Set<string>();
  for (const entry of readPendingCloses(localStorage)) {
    try {
      if (entry.status === "sent") {
        await api.markJobSent(entry.jobId, { jobType: entry.jobType, worksheetNum: entry.worksheetNum });
      } else {
        await api.abandonJob(entry.jobId);
      }
      removePendingClose(localStorage, entry.jobId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) removePendingClose(localStorage, entry.jobId);
      else stillPending.add(entry.jobId);
    }
  }
  return stillPending;
}

function schedule(delay = AUTOSAVE_DELAY_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void enqueueSave();
  }, delay);
}

async function saveNow(): Promise<void> {
  if (suspended) return;
  const state = currentState();
  if (!hasJobContent(state)) return;
  const sync = useJobSyncStore.getState();

  // Never write into a draft that is still waiting to be closed as sent/abandoned.
  if (readPendingCloses(localStorage).length > 0 && (await flushPendingJobCloses()).size > 0) {
    sync.setSaveState("error", "Not saved — retrying");
    schedule(RETRY_DELAY_MS);
    return;
  }

  sync.setSaveState("saving");
  try {
    const res = await api.saveCurrentJob(state);
    currentJobId = res.id;
    useJobSyncStore.getState().setSaveState("saved");
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) {
      useJobSyncStore
        .getState()
        .setSaveState("error", "This job is too large to save to the server. It is kept in this browser only.");
      return;
    }
    useJobSyncStore.getState().setSaveState("error", "Not saved — retrying");
    schedule(RETRY_DELAY_MS);
  }
}

function enqueueSave(): Promise<void> {
  chain = chain.then(saveNow);
  return chain;
}

export async function flushJobAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    await enqueueSave();
    return;
  }
  await chain;
}

export function startJobAutosave(): () => void {
  const unsubInvoices = useInvoiceStore.subscribe((s, prev) => {
    if (s.invoices !== prev.invoices || s.activeInvId !== prev.activeInvId || s.itemExemptions !== prev.itemExemptions) {
      schedule();
    }
  });
  const unsubWorkflow = useWorkflowStore.subscribe((s, prev) => {
    if (
      s.taxInputs !== prev.taxInputs ||
      s.brokerageInputs !== prev.brokerageInputs ||
      s.approvedTaxSheet !== prev.approvedTaxSheet ||
      s.activeConsigneeId !== prev.activeConsigneeId
    ) {
      schedule();
    }
  });
  return () => {
    unsubInvoices();
    unsubWorkflow();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export async function hydrateJobFromServer(): Promise<void> {
  const pending = await flushPendingJobCloses();
  const { job } = await api.getCurrentJob();
  if (!job || pending.has(job.id)) return;
  currentJobId = job.id;
  if (hasJobContent(currentState())) return;
  if (isJobState(job.state)) applyJobState(job.state);
}

/** Close the current job on the server (queued if offline) and clear it from the screen. */
export async function finishJob(close: FinishJobInput): Promise<void> {
  suspended = true;
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await chain;
    let jobId = currentJobId;
    if (!jobId) {
      jobId = (await api.getCurrentJob().catch(() => ({ job: null }))).job?.id ?? null;
    }
    if (jobId) enqueuePendingClose(localStorage, { jobId, ...close });
    clearActiveJob();
    currentJobId = null;
    useJobSyncStore.getState().setSaveState("idle");
    if (jobId) await flushPendingJobCloses();
  } finally {
    suspended = false;
  }
}
```

- [ ] **Step 3: Save indicator component**

`apps/web/src/components/workflow/JobSaveIndicator.tsx`:

```tsx
import { InfoBanner } from "@/components/ui/banners";
import { useJobSyncStore } from "@/stores/job-sync-store";

export function JobSaveIndicator() {
  const saveState = useJobSyncStore((s) => s.saveState);
  const error = useJobSyncStore((s) => s.error);
  if (saveState !== "error") return null;
  return (
    <InfoBanner tone="warn" className="mb-3">
      {error}
    </InfoBanner>
  );
}
```

- [ ] **Step 4: Wire into the app**

`apps/web/src/app/AppShell.tsx` — add import:

```tsx
import { JobSaveIndicator } from '@/components/workflow/JobSaveIndicator';
```

and replace line 176:

```tsx
        <main className="min-w-0">{children}</main>
```

with:

```tsx
        <main className="min-w-0">
          <JobSaveIndicator />
          {children}
        </main>
```

`apps/web/src/app/App.tsx` — add import:

```tsx
import { hydrateJobFromServer, startJobAutosave } from "@/lib/job-sync";
```

and in `ProtectedRoutes`, directly after the existing `useEffect(...)` that loads learned/supplier history, add:

```tsx
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let stopAutosave: (() => void) | null = null;
    hydrateJobFromServer()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) stopAutosave = startJobAutosave();
      });
    return () => {
      cancelled = true;
      stopAutosave?.();
    };
  }, [user]);
```

`apps/web/src/stores/auth-store.ts` — add import:

```ts
import { flushJobAutosave } from "@/lib/job-sync";
```

and change `logout` to save pending edits first:

```ts
  logout: async () => {
    try {
      await flushJobAutosave().catch(() => null);
      await api.logout();
    } finally {
      clearLocalSessionData();
      set({ user: null, error: "" });
    }
  },
```

- [ ] **Step 5: Typecheck and run all web tests**

Run (from `apps/web`): `npm run typecheck` then `npx vitest run`
Expected: typecheck exits 0; all tests pass (including Task 3's 9 tests and the existing `worksheet-lines.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/job-sync-store.ts apps/web/src/lib/job-sync.ts apps/web/src/components/workflow/JobSaveIndicator.tsx apps/web/src/app/App.tsx apps/web/src/app/AppShell.tsx apps/web/src/stores/auth-store.ts
git commit -m "feat(web): autosave jobs to the server and hydrate after login"
```

---

### Task 6: Finish job on send; "Start new job"

**Files:**
- Modify: `apps/web/src/features/worksheet/WorksheetPage.tsx` (imports; `handleClassificationSent` line 257; `handleBrokerageSend` success block lines 320-335; `PageHeader` actions line 362)
- Modify: `apps/web/src/features/upload/UploadPage.tsx` (imports; state; `PageHeader` actions lines 136-145)

**Interfaces:**
- Consumes: `finishJob`, `START_NEW_JOB_CONFIRM` (Task 5); `UploadLocationState`, `JobFinishedNotice` (Task 3).

- [ ] **Step 1: Worksheet page — imports and helpers**

Add imports to `WorksheetPage.tsx`:

```tsx
import { finishJob, START_NEW_JOB_CONFIRM } from "@/lib/job-sync";
import type { UploadLocationState } from "@/lib/job-state";
```

Add these handlers directly above `const handleClassificationSent`:

```tsx
  const completeAndStartNext = async (
    jobType: DutyDeskJobType,
    notice: NonNullable<UploadLocationState["jobFinished"]>,
  ) => {
    await finishJob({ status: "sent", jobType, worksheetNum });
    navigate("/upload", { state: { jobFinished: notice } satisfies UploadLocationState });
  };

  const handleStartNewJob = async () => {
    if (!window.confirm(START_NEW_JOB_CONFIRM)) return;
    await finishJob({ status: "abandoned" });
    navigate("/upload");
  };
```

- [ ] **Step 2: Worksheet page — finish on Classification Only send**

Replace:

```tsx
  const handleClassificationSent = () => {
    setJobStatus("completed_directly");
    recordActivity("Classification worksheet sent directly from Duty Desk");
  };
```

with:

```tsx
  const handleClassificationSent = () => {
    setJobStatus("completed_directly");
    recordActivity("Classification worksheet sent directly from Duty Desk");
    void completeAndStartNext("classification_only", {
      message: `Worksheet ${worksheetNum} sent to the customer. Ready for the next job.`,
    });
  };
```

- [ ] **Step 3: Worksheet page — finish on Brokerage send**

In `handleBrokerageSend`, after the existing lines:

```tsx
      await syncTeamWorkflow().catch(() => null);
      refreshTaxLog();
```

add:

```tsx
      await completeAndStartNext("brokerage_clearance", {
        message: `Worksheet ${worksheetNum} sent to FlowBoard${
          result.entry.flowboardReference ? ` (${result.entry.flowboardReference})` : ""
        }. Ready for the next job.`,
        flowboardJobUrl: result.flowboardJobUrl || resolveFlowboardJobUrl(result.jobId) || undefined,
      });
```

- [ ] **Step 4: Worksheet page — Start new job button**

Replace:

```tsx
        actions={<DutyDeskJobStatusBadge status={jobStatus} />}
```

with:

```tsx
        actions={
          <div className="flex items-center gap-2">
            <DutyDeskJobStatusBadge status={jobStatus} />
            <Button variant="secondary" className="text-xs" onClick={() => void handleStartNewJob()}>
              Start new job
            </Button>
          </div>
        }
```

- [ ] **Step 5: Upload page — sent banner and Start new job**

In `UploadPage.tsx` change the router import:

```tsx
import { useNavigate } from "react-router-dom";
```

to:

```tsx
import { useLocation, useNavigate } from "react-router-dom";
```

and add:

```tsx
import { finishJob, START_NEW_JOB_CONFIRM } from "@/lib/job-sync";
import type { JobFinishedNotice, UploadLocationState } from "@/lib/job-state";
```

Inside `UploadPage`, after `const navigate = useNavigate();`:

```tsx
  const location = useLocation();
  const [jobFinished, setJobFinished] = useState<JobFinishedNotice | null>(
    () => (location.state as UploadLocationState | null)?.jobFinished ?? null,
  );

  const handleStartNewJob = async () => {
    if (!window.confirm(START_NEW_JOB_CONFIRM)) return;
    await finishJob({ status: "abandoned" });
  };
```

Replace the `PageHeader` `actions` prop:

```tsx
        actions={
          invoices.length > 0 ? (
            <Badge tone="green">{invoices.length} loaded</Badge>
          ) : undefined
        }
```

with:

```tsx
        actions={
          invoices.length > 0 ? (
            <div className="flex items-center gap-2">
              <Badge tone="green">{invoices.length} loaded</Badge>
              <Button variant="secondary" className="text-xs" onClick={() => void handleStartNewJob()}>
                Start new job
              </Button>
            </div>
          ) : undefined
        }
      />

      {jobFinished && (
        <InfoBanner className="mb-4" onDismiss={() => setJobFinished(null)}>
          {jobFinished.message}
          {jobFinished.flowboardJobUrl && (
            <>
              {" "}
              <a href={jobFinished.flowboardJobUrl} target="_blank" rel="noreferrer" className="underline">
                Open in FlowBoard
              </a>
            </>
          )}
        </InfoBanner>
      )}
```

(The original `/>` that closed `PageHeader` is now part of the replacement — remove the old one so the JSX stays balanced.)

- [ ] **Step 6: Typecheck and build**

Run (from `apps/web`): `npm run typecheck` then `npm run build`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/worksheet/WorksheetPage.tsx apps/web/src/features/upload/UploadPage.tsx
git commit -m "feat(web): clear the job and return to Upload after send; Start new job"
```

---

### Task 7: End-to-end verification and release notes

**Files:** none (verification only).

- [ ] **Step 1: Full test + typecheck**

Run (repo root): `npm run typecheck` and `npm test`
Expected: all workspaces exit 0.

- [ ] **Step 2: Manual browser check (local)**

With `npm run dev:worker` and `npm run dev` running, logged in as a clerk:

1. Upload an invoice → wait ~2s → in a second terminal run
   `npx wrangler d1 execute pas-trinidad --local --command "SELECT id, status, worksheet_num FROM duty_jobs ORDER BY updated_at DESC LIMIT 3;"`
   Expected: one `draft` row.
2. Refresh the browser on `/classification`. Expected: the invoice is still loaded.
3. Classify, fill Duties & Taxes, enter a worksheet number, Worksheet → Complete Job → Classification Only → send by email.
   Expected: app lands on `/upload` with the banner "Worksheet … sent to the customer. Ready for the next job."; no invoices loaded; the DB row is `sent` with `sent_at` set.
4. Upload a second invoice → Worksheet → **Start new job** → confirm. Expected: Upload is empty; DB row `abandoned`.
5. Upload a third invoice, log out, log back in. Expected: the third invoice is restored from the server.
6. Stop the worker, change a tax field. Expected: the "Not saved — retrying" banner appears; restart the worker → the banner clears within ~5s.

- [ ] **Step 3: Remote migration before deploy**

Deploying requires the new table remotely first:

```bash
npm run db:migrate:remote
```

Expected: `0021_duty_jobs.sql` applied. Then deploy both workers as usual (dutydesk and pas-trinidad-api share the same D1 database).

---

## Later phases (separate plans)

Phase 2 (strict `isAutoApplyable`, calibrated confidence, history-first), Phase 3 (Classification UI: concurrent generation, confirm modal, exceptions queue, More detail, navigation), and Phase 4 (correction learning, golden expansion) each get their own plan after Phase 1 ships, per the spec's rollout section.
