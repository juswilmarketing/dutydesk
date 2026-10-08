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
       WHERE id = ? AND user_id = ? AND status = 'draft'`,
    )
      .bind(parsed.stateJson, parsed.worksheetNum, parsed.consigneeId, now, id, c.var.userId)
      .run();
  const findStatus = (id: string) =>
    c.env.DB.prepare("SELECT status FROM duty_jobs WHERE id = ? AND user_id = ?")
      .bind(id, c.var.userId)
      .first<{ status: DutyJobStatus }>();
  const jobClosed = (status: DutyJobStatus) =>
    c.json({ error: "This job was already sent or closed", code: "job_closed", status }, 409);
  const draftConflict = () =>
    c.json({ error: "Job was closed; save again to start a new draft", code: "draft_conflict" }, 409);

  if (parsed.jobId) {
    const known = await findStatus(parsed.jobId);
    if (known && known.status !== "draft") return jobClosed(known.status);
    if (known) {
      const result = await update(parsed.jobId);
      if (!result.meta.changes) {
        const current = await findStatus(parsed.jobId);
        return current && current.status !== "draft" ? jobClosed(current.status) : draftConflict();
      }
      return c.json({ id: parsed.jobId, updatedAt: now });
    }
  }

  const existingId = await findDraftId(c);
  if (existingId) {
    const result = await update(existingId);
    if (!result.meta.changes) return draftConflict();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("UNIQUE constraint failed")) throw err;
    // Another request created the draft first (unique draft-per-user index).
    const racedId = await findDraftId(c);
    if (!racedId) throw err;
    const result = await update(racedId);
    if (!result.meta.changes) return draftConflict();
    return c.json({ id: racedId, updatedAt: now });
  }
});

async function closeJob(c: Context<JobsEnv>, status: Exclude<DutyJobStatus, "draft">) {
  const id = c.req.param("id") ?? "";
  let closeBody: unknown = undefined;
  if (status === "sent") {
    const raw = await c.req.text();
    if (raw.trim() !== "") {
      try {
        closeBody = JSON.parse(raw);
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
    }
  }
  const parsed = parseClosePayload(closeBody);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const row = await c.env.DB.prepare("SELECT status FROM duty_jobs WHERE id = ? AND user_id = ?")
    .bind(id, c.var.userId)
    .first<{ status: DutyJobStatus }>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.status !== "draft") return c.json({ ok: true, status: row.status });

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE duty_jobs
     SET status = ?, job_type = COALESCE(?, job_type), worksheet_num = COALESCE(?, worksheet_num),
         sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'draft'`,
  )
    .bind(status, parsed.jobType, parsed.worksheetNum, status, now, now, id, c.var.userId)
    .run();
  if (!result.meta.changes) {
    const current = await c.env.DB.prepare("SELECT status FROM duty_jobs WHERE id = ? AND user_id = ?")
      .bind(id, c.var.userId)
      .first<{ status: DutyJobStatus }>();
    if (!current) return c.json({ error: "Job not found" }, 404);
    return c.json({ ok: true, status: current.status });
  }
  return c.json({ ok: true, status });
}

jobs.post("/:id/sent", (c) => closeJob(c, "sent"));
jobs.post("/:id/abandon", (c) => closeJob(c, "abandoned"));

export default jobs;
