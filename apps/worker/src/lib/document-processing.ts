import { PDFDocument } from "pdf-lib";
import type { ParsedInvoice } from "@pas/shared-types";
import type { Env } from "../env";
import { anthropicDocument } from "./anthropic";
import { INVOICE_PROMPT, parseInvoicesFromModelText } from "./invoice-parse";

export type JobStatus =
  | "queued"
  | "preparing"
  | "rendering"
  | "ocr_processing"
  | "extracting"
  | "resolving_products"
  | "classifying"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export type DocumentJobRow = {
  id: string;
  user_id: number | null;
  username: string | null;
  document_id: string;
  original_filename: string;
  r2_key: string;
  media_type: string;
  shipment_id: string | null;
  document_type: string;
  status: JobStatus;
  current_stage: string | null;
  pages_total: number;
  pages_completed: number;
  progress_percent: number;
  batch_size: number;
  current_batch: number;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  warnings_json: string;
  result_json: string | null;
  started_at: string | null;
  completed_at: string | null;
};

function numEnv(env: Env, key: keyof Env, fallback: number): number {
  const raw = env[key];
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function jobConfig(env: Env) {
  return {
    batchSize: numEnv(env, "DOC_OCR_BATCH_SIZE", 4),
    aiLineBatchSize: numEnv(env, "DOC_AI_LINE_BATCH_SIZE", 15),
    maxPages: numEnv(env, "DOC_MAX_PAGES", 100),
    maxRetries: numEnv(env, "DOC_MAX_RETRIES", 3),
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function updateJob(
  db: D1Database,
  jobId: string,
  patch: Partial<{
    status: string;
    current_stage: string | null;
    pages_total: number;
    pages_completed: number;
    progress_percent: number;
    batch_size: number;
    current_batch: number;
    retry_count: number;
    error_code: string | null;
    error_message: string | null;
    warnings_json: string;
    result_json: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>,
) {
  const fields: string[] = ["updated_at = datetime('now')"];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    binds.push(v);
  }
  binds.push(jobId);
  await db.prepare(`UPDATE document_processing_jobs SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
}

export async function getJob(db: D1Database, jobId: string): Promise<DocumentJobRow | null> {
  const row = await db.prepare(`SELECT * FROM document_processing_jobs WHERE id = ?`).bind(jobId).first();
  return (row as DocumentJobRow | null) ?? null;
}

function invoiceKey(inv: ParsedInvoice): string {
  const num = (inv.invoice_number || "").trim().toLowerCase();
  const sup = (inv.supplier || "").trim().toLowerCase();
  if (num) return `n:${num}|s:${sup}`;
  return `s:${sup}|d:${inv.invoice_date || ""}`;
}

function itemKey(it: ParsedInvoice["items"][number]): string {
  return `${it.description.trim().toLowerCase()}|${it.qty}|${it.line_total}`;
}

export function mergeInvoices(chunkResults: ParsedInvoice[][]): ParsedInvoice[] {
  const map = new Map<string, ParsedInvoice>();
  for (const invoices of chunkResults) {
    for (const inv of invoices) {
      if (!inv.items?.length && !inv.charges?.length) continue;
      const key = invoiceKey(inv);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...inv, items: [...(inv.items || [])], charges: [...(inv.charges || [])] });
        continue;
      }
      const seen = new Set(existing.items.map(itemKey));
      for (const it of inv.items || []) {
        const k = itemKey(it);
        if (!seen.has(k)) {
          existing.items.push(it);
          seen.add(k);
        }
      }
      const seenCh = new Set(existing.charges.map((c) => `${c.kind}|${c.label}|${c.amount}`));
      for (const ch of inv.charges || []) {
        const k = `${ch.kind}|${ch.label}|${ch.amount}`;
        if (!seenCh.has(k)) {
          existing.charges.push(ch);
          seenCh.add(k);
        }
      }
      existing.supplier = existing.supplier || inv.supplier;
      existing.invoice_number = existing.invoice_number || inv.invoice_number;
      existing.invoice_date = existing.invoice_date || inv.invoice_date;
      if (inv.goods_subtotal != null && (existing.goods_subtotal == null || inv.goods_subtotal > existing.goods_subtotal)) {
        existing.goods_subtotal = inv.goods_subtotal;
      }
      if (inv.invoice_total != null && (existing.invoice_total == null || inv.invoice_total > existing.invoice_total)) {
        existing.invoice_total = inv.invoice_total;
      }
    }
  }
  return [...map.values()].filter((i) => i.items.length > 0);
}

async function extractPdfPageCount(pdfBytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function slicePdfPages(pdfBytes: ArrayBuffer, fromPage: number, toPage: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = Array.from({ length: toPage - fromPage + 1 }, (_, i) => fromPage - 1 + i);
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

type AccumulatedResult = {
  invoices: ParsedInvoice[];
  warnings: string[];
  pagesProcessed: number;
  documentText?: string;
};

function parseResult(raw: string | null): AccumulatedResult {
  if (!raw) return { invoices: [], warnings: [], pagesProcessed: 0 };
  try {
    return JSON.parse(raw) as AccumulatedResult;
  } catch {
    return { invoices: [], warnings: [], pagesProcessed: 0 };
  }
}

function invoiceSearchableText(invoices: ParsedInvoice[]): string {
  return invoices.flatMap((invoice) => [
    invoice.supplier || "",
    invoice.invoice_number || "",
    ...invoice.items.map((item) => item.description),
  ]).filter(Boolean).join("\n");
}

function supportingDocumentPrompt(documentType: string, fromPage: number, toPage: number, pagesTotal: number): string {
  return `Extract searchable product evidence from this ${documentType.replace(/_/g, " ")}.
Return JSON only:
{"searchableText":"","productReferences":[{"productCode":"","sku":"","brand":"","manufacturer":"","productName":"","material":"","primaryFunction":"","excerpt":""}]}

Preserve exact product codes, SKUs, model numbers, product names, composition, intended use,
technical descriptions and safety-document terminology visible on the page. Do not infer a tariff.
This batch is pages ${fromPage}-${toPage} of ${pagesTotal}.`;
}

function parseSupportingDocumentText(text: string): {
  searchableText: string;
  productReferences: Array<Record<string, string>>;
} {
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      searchableText?: unknown;
      productReferences?: unknown;
    };
    return {
      searchableText: String(parsed.searchableText || "").trim(),
      productReferences: Array.isArray(parsed.productReferences)
        ? parsed.productReferences.filter((entry): entry is Record<string, string> =>
            Boolean(entry) && typeof entry === "object")
        : [],
    };
  } catch {
    return { searchableText: text.trim(), productReferences: [] };
  }
}

/**
 * Advance a document job by exactly one durable step/batch.
 * Safe to call repeatedly — completed batches are skipped via idempotency keys.
 */
export async function advanceDocumentJob(env: Env, jobId: string): Promise<DocumentJobRow> {
  const cfg = jobConfig(env);
  let job = await getJob(env.DB, jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "completed" || job.status === "completed_with_warnings" || job.status === "cancelled") {
    return job;
  }
  if (job.status === "failed" && job.retry_count >= cfg.maxRetries) {
    return job;
  }

  if (!env.ANTHROPIC_API_KEY) {
    await updateJob(env.DB, jobId, {
      status: "failed",
      error_code: "AI_NOT_CONFIGURED",
      error_message: "AI service not configured",
      completed_at: new Date().toISOString(),
    });
    return (await getJob(env.DB, jobId))!;
  }

  const obj = await env.DOCUMENTS.get(job.r2_key);
  if (!obj) {
    await updateJob(env.DB, jobId, {
      status: "failed",
      error_code: "MISSING_FILE",
      error_message: "Uploaded document not found in storage",
      completed_at: new Date().toISOString(),
    });
    return (await getJob(env.DB, jobId))!;
  }

  const pdfBytes = await obj.arrayBuffer();

  // Stage: preparing — determine page count
  if (job.status === "queued" || job.pages_total === 0) {
    await updateJob(env.DB, jobId, {
      status: "preparing",
      current_stage: "Inspecting PDF",
      started_at: job.started_at || new Date().toISOString(),
    });
    const pages = job.media_type.startsWith("image/") ? 1 : await extractPdfPageCount(pdfBytes);
    if (pages > cfg.maxPages) {
      await updateJob(env.DB, jobId, {
        status: "failed",
        error_code: "TOO_MANY_PAGES",
        error_message: `PDF has ${pages} pages (max ${cfg.maxPages})`,
        pages_total: pages,
        completed_at: new Date().toISOString(),
      });
      return (await getJob(env.DB, jobId))!;
    }
    await updateJob(env.DB, jobId, {
      status: "ocr_processing",
      current_stage: `Ready to OCR ${pages} page(s)`,
      pages_total: pages,
      batch_size: cfg.batchSize,
      current_batch: 0,
      progress_percent: 2,
      result_json: JSON.stringify({ invoices: [], warnings: [], pagesProcessed: 0 }),
    });
    return (await getJob(env.DB, jobId))!;
  }

  job = (await getJob(env.DB, jobId))!;
  const pagesTotal = job.pages_total;
  const batchSize = job.batch_size || cfg.batchSize;
  const batchIndex = job.current_batch;
  const fromPage = batchIndex * batchSize + 1;
  const toPage = Math.min(fromPage + batchSize - 1, pagesTotal);

  if (fromPage > pagesTotal) {
    // Finalize
    const acc = parseResult(job.result_json);
    const merged = mergeInvoices([acc.invoices]);
    const warnings = acc.warnings;
    await updateJob(env.DB, jobId, {
      status: warnings.length ? "completed_with_warnings" : "completed",
      current_stage: "Completed",
      pages_completed: pagesTotal,
      progress_percent: 100,
      result_json: JSON.stringify({
        invoices: merged,
        warnings,
        pagesProcessed: pagesTotal,
        lineItemsExtracted: merged.reduce((s, inv) => s + inv.items.length, 0),
      }),
      completed_at: new Date().toISOString(),
    });
    return (await getJob(env.DB, jobId))!;
  }

  const idempotencyKey = `${job.document_id}:ocr:pages-${fromPage}-${toPage}`;
  const existingBatch = await env.DB.prepare(
    `SELECT status, result_json FROM document_batch_runs WHERE idempotency_key = ?`,
  )
    .bind(idempotencyKey)
    .first<{ status: string; result_json: string | null }>();

  if (existingBatch?.status === "done") {
    await updateJob(env.DB, jobId, {
      current_batch: batchIndex + 1,
      pages_completed: toPage,
      progress_percent: Math.min(99, Math.round((toPage / pagesTotal) * 90) + 5),
      current_stage: `Completed pages ${fromPage}–${toPage} of ${pagesTotal}`,
      status: toPage >= pagesTotal ? "extracting" : "ocr_processing",
    });
    if (toPage >= pagesTotal) {
      return advanceDocumentJob(env, jobId);
    }
    return (await getJob(env.DB, jobId))!;
  }

  await updateJob(env.DB, jobId, {
    status: "ocr_processing",
    current_stage: `OCR pages ${fromPage}–${toPage} of ${pagesTotal}`,
  });

  await env.DB.prepare(
    `INSERT INTO document_batch_runs (job_id, idempotency_key, batch_index, from_page, to_page, stage, status)
     VALUES (?, ?, ?, ?, ?, 'ocr_extract', 'running')
     ON CONFLICT(idempotency_key) DO UPDATE SET status = 'running', retry_count = retry_count + 1, updated_at = datetime('now')`,
  )
    .bind(jobId, idempotencyKey, batchIndex, fromPage, toPage)
    .run();

  const started = Date.now();
  try {
    let batchPdfB64: string;
    let mediaType = job.media_type;
    if (job.media_type.startsWith("image/") || pagesTotal === 1) {
      batchPdfB64 = uint8ToBase64(new Uint8Array(pdfBytes));
    } else {
      const sliced = await slicePdfPages(pdfBytes, fromPage, toPage);
      batchPdfB64 = uint8ToBase64(sliced);
      mediaType = "application/pdf";
    }

    const isCommercialInvoice = !job.document_type || job.document_type === "commercial_invoice";
    const prompt = isCommercialInvoice
      ? `${INVOICE_PROMPT}\n\nThis batch is pages ${fromPage}-${toPage} of a ${pagesTotal}-page scanned document. Extract only what is visible on these pages.`
      : supportingDocumentPrompt(job.document_type, fromPage, toPage, pagesTotal);
    const text = await anthropicDocument(env.ANTHROPIC_API_KEY, batchPdfB64, mediaType, prompt, 8000);
    const supporting = isCommercialInvoice
      ? { searchableText: "", productReferences: [] as Array<Record<string, string>> }
      : parseSupportingDocumentText(text);
    const invoices = isCommercialInvoice ? parseInvoicesFromModelText(text) : [];
    const searchableText = isCommercialInvoice
      ? invoiceSearchableText(invoices) || text
      : supporting.searchableText;

    // Preserve searchable extraction for product-code/SKU evidence and page citations.
    for (let p = fromPage; p <= toPage; p++) {
      const pageKey = `${job.document_id}:page:${p}`;
      await env.DB.prepare(
        `INSERT INTO document_pages
          (document_id, job_id, page_number, status, raw_ocr_text, cleaned_text,
           processing_time_ms, idempotency_key)
         VALUES (?, ?, ?, 'done', ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'done',
           raw_ocr_text = excluded.raw_ocr_text,
           cleaned_text = excluded.cleaned_text,
           processing_time_ms = excluded.processing_time_ms,
           updated_at = datetime('now')`,
      )
        .bind(job.document_id, jobId, p, text, searchableText, Date.now() - started, pageKey)
        .run();
    }

    if (!isCommercialInvoice) {
      for (const reference of supporting.productReferences.slice(0, 100)) {
        const productCode = String(reference.productCode || reference.sku || "");
        await env.DB.prepare(
          `INSERT INTO document_product_references
            (shipment_id, document_id, job_id, page_number, document_type, document_filename,
             product_code, normalized_product_code, extracted_product_name, brand,
             manufacturer, material, primary_function, excerpt, confidence, approved)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.8, 0)`,
        ).bind(
          job.shipment_id || job.id,
          job.document_id,
          job.id,
          fromPage,
          job.document_type,
          job.original_filename,
          productCode || null,
          productCode.toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
          reference.productName || null,
          reference.brand || null,
          reference.manufacturer || null,
          reference.material || null,
          reference.primaryFunction || null,
          reference.excerpt || supporting.searchableText.slice(0, 500),
        ).run();
      }
    }

    const acc = parseResult(job.result_json);
    const merged = mergeInvoices([acc.invoices, invoices]);
    const nextResult: AccumulatedResult = {
      invoices: merged,
      warnings: acc.warnings,
      pagesProcessed: toPage,
      documentText: [acc.documentText, searchableText].filter(Boolean).join("\n"),
    };

    await env.DB.prepare(
      `UPDATE document_batch_runs SET status = 'done', result_json = ?, duration_ms = ?, updated_at = datetime('now') WHERE idempotency_key = ?`,
    )
      .bind(
        JSON.stringify({ invoices, searchableText, productReferences: supporting.productReferences }),
        Date.now() - started,
        idempotencyKey,
      )
      .run();

    const nextBatch = batchIndex + 1;
    const progress = Math.min(99, Math.round((toPage / pagesTotal) * 90) + 5);
    await updateJob(env.DB, jobId, {
      current_batch: nextBatch,
      pages_completed: toPage,
      progress_percent: progress,
      current_stage:
        toPage >= pagesTotal
          ? "Assembling extracted invoices"
          : `OCR pages ${fromPage}–${toPage} of ${pagesTotal}`,
      status: toPage >= pagesTotal ? "extracting" : "ocr_processing",
      result_json: JSON.stringify(nextResult),
      retry_count: 0,
      error_code: null,
      error_message: null,
    });

    if (toPage >= pagesTotal) {
      const finalMerged = mergeInvoices([merged]);
      await updateJob(env.DB, jobId, {
        status: "completed",
        current_stage: "Completed",
        pages_completed: pagesTotal,
        progress_percent: 100,
        result_json: JSON.stringify({
          invoices: finalMerged,
          warnings: nextResult.warnings,
          pagesProcessed: pagesTotal,
          documentText: nextResult.documentText,
          lineItemsExtracted: finalMerged.reduce((s, inv) => s + inv.items.length, 0),
        }),
        completed_at: new Date().toISOString(),
      });
    }

    return (await getJob(env.DB, jobId))!;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Batch processing failed";
    await env.DB.prepare(
      `UPDATE document_batch_runs SET status = 'failed', error_message = ?, duration_ms = ?, updated_at = datetime('now') WHERE idempotency_key = ?`,
    )
      .bind(msg, Date.now() - started, idempotencyKey)
      .run();

    const retries = (job.retry_count || 0) + 1;
    const failHard = retries >= cfg.maxRetries;
    await updateJob(env.DB, jobId, {
      status: failHard ? "failed" : "ocr_processing",
      retry_count: retries,
      error_code: failHard ? "BATCH_FAILED" : "BATCH_RETRY",
      error_message: failHard
        ? `Processing stopped while reading pages ${fromPage}–${toPage}. Pages already completed were preserved. Retry from the failed page.`
        : msg,
      current_stage: `Failed pages ${fromPage}–${toPage}`,
      completed_at: failHard ? new Date().toISOString() : null,
    });
    return (await getJob(env.DB, jobId))!;
  }
}

export function publicJobView(job: DocumentJobRow) {
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(job.warnings_json || "[]");
  } catch {
    warnings = [];
  }
  let result: AccumulatedResult | null = null;
  try {
    result = job.result_json ? (JSON.parse(job.result_json) as AccumulatedResult) : null;
  } catch {
    result = null;
  }

  return {
    success: true,
    jobId: job.id,
    documentId: job.document_id,
    status: job.status,
    currentStage: job.current_stage,
    pagesTotal: job.pages_total,
    pagesCompleted: job.pages_completed,
    progressPercent: job.progress_percent,
    batchSize: job.batch_size,
    currentBatch: job.current_batch,
    retryCount: job.retry_count,
    warnings,
    error: job.error_message
      ? { code: job.error_code, message: job.error_message }
      : null,
    invoices: result?.invoices ?? null,
    lineItemsExtracted: result
      ? result.invoices.reduce((s, inv) => s + inv.items.length, 0)
      : 0,
    originalFilename: job.original_filename,
  };
}
