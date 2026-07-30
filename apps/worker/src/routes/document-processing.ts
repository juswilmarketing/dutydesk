import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";
import {
  advanceDocumentJob,
  getJob,
  jobConfig,
  publicJobView,
} from "../lib/document-processing";

const docs = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const MAX_BASE64_LENGTH = 14_000_000; // ~10MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Upload only — validate, store in R2, create job, return immediately (<5s).
 * Does NOT OCR / classify / wait for AI.
 */
docs.post("/upload", async (c) => {
  if (!c.env.DOCUMENTS) {
    return c.json({ success: false, error: "Document storage not configured" }, 503);
  }

  const body = await c.req.json<{
    base64?: string;
    mediaType?: string;
    filename?: string;
    pagesTotalHint?: number;
    shipmentId?: string;
    documentType?: string;
  }>();

  const base64 = body.base64;
  const mediaType = body.mediaType || "application/pdf";
  const filename = (body.filename || "invoice.pdf").slice(0, 240);

  if (!base64) return c.json({ success: false, error: "File data required" }, 400);
  if (base64.length > MAX_BASE64_LENGTH) {
    return c.json({ success: false, error: "File too large (max 10MB)" }, 413);
  }
  if (!ALLOWED_TYPES.has(mediaType)) {
    return c.json({ success: false, error: "Unsupported file type" }, 415);
  }

  const cfg = jobConfig(c.env);
  const jobId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const r2Key = `dutydesk/docs/${documentId}/${filename.replace(/[^\w.\-]+/g, "_")}`;

  const bytes = base64ToBytes(base64);
  await c.env.DOCUMENTS.put(r2Key, bytes, {
    httpMetadata: { contentType: mediaType },
    customMetadata: {
      jobId,
      documentId,
      username: c.var.username,
    },
  });

  await c.env.DB.prepare(
    `INSERT INTO document_processing_jobs
      (id, user_id, username, document_id, original_filename, r2_key, media_type,
       shipment_id, document_type, status, current_stage, pages_total, batch_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'Queued for processing', ?, ?)`,
  )
    .bind(
      jobId,
      c.var.userId,
      c.var.username,
      documentId,
      filename,
      r2Key,
      mediaType,
      body.shipmentId || jobId,
      body.documentType || "commercial_invoice",
      body.pagesTotalHint || 0,
      cfg.batchSize,
    )
    .run();

  await audit(c, "document_upload");

  return c.json({
    success: true,
    jobId,
    documentId,
    status: "queued",
    pagesTotal: body.pagesTotalHint || 0,
    message: "Document uploaded and queued for processing.",
  });
});

docs.get("/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJob(c.env.DB, jobId);
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);
  return c.json(publicJobView(job));
});

docs.post("/jobs/:jobId/link-shipment", async (c) => {
  const jobId = c.req.param("jobId");
  const body = await c.req.json<{ shipmentId?: string; documentType?: string }>();
  if (!body.shipmentId?.trim()) {
    return c.json({ success: false, error: "shipmentId is required" }, 400);
  }
  const updated = await c.env.DB.prepare(
    `UPDATE document_processing_jobs
     SET shipment_id = ?, document_type = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(body.shipmentId, body.documentType || "supporting_document", jobId).run();
  if (!updated.meta.changes) return c.json({ success: false, error: "Job not found" }, 404);
  await audit(c, "document_linked_to_shipment");
  return c.json({ success: true, jobId, shipmentId: body.shipmentId });
});

/**
 * Process exactly one durable batch/stage for this job.
 * Frontend polls this until status is completed/failed.
 */
docs.post("/jobs/:jobId/advance", async (c) => {
  const jobId = c.req.param("jobId");
  const existing = await getJob(c.env.DB, jobId);
  if (!existing) return c.json({ success: false, error: "Job not found" }, 404);

  if (existing.status === "cancelled") {
    return c.json(publicJobView(existing));
  }

  try {
    const job = await advanceDocumentJob(c.env, jobId);
    return c.json(publicJobView(job));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Advance failed";
    return c.json(
      {
        success: false,
        jobId,
        status: "failed",
        error: { code: "ADVANCE_FAILED", message: msg },
      },
      500,
    );
  }
});

docs.post("/jobs/:jobId/retry", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJob(c.env.DB, jobId);
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE document_processing_jobs SET
      status = 'ocr_processing',
      error_code = NULL,
      error_message = NULL,
      retry_count = 0,
      completed_at = NULL,
      current_stage = 'Retrying from failed batch',
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(jobId)
    .run();

  // Clear only the failed batch run for current batch so it can re-run
  const fromPage = job.current_batch * job.batch_size + 1;
  const toPage = Math.min(fromPage + job.batch_size - 1, job.pages_total || fromPage);
  const key = `${job.document_id}:ocr:pages-${fromPage}-${toPage}`;
  await c.env.DB.prepare(`DELETE FROM document_batch_runs WHERE idempotency_key = ? AND status = 'failed'`)
    .bind(key)
    .run();

  const advanced = await advanceDocumentJob(c.env, jobId);
  await audit(c, "document_job_retry");
  return c.json(publicJobView(advanced));
});

docs.post("/jobs/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJob(c.env.DB, jobId);
  if (!job) return c.json({ success: false, error: "Job not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE document_processing_jobs SET status = 'cancelled', current_stage = 'Cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(jobId)
    .run();

  await audit(c, "document_job_cancel");
  const updated = await getJob(c.env.DB, jobId);
  return c.json(publicJobView(updated!));
});

export default docs;
