import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { notifyFlowboardWorksheetSent } from "./flowboard";
import { flowboardFetch } from "../lib/flowboard-fetch";

const workflow = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workflow.get("/consignees", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, code, name, email, phone, address, updated_at AS updatedAt FROM consignees ORDER BY name",
  ).all<{ id: string; code: string; name: string; email: string; phone: string; address: string; updatedAt: string }>();
  return c.json({ consignees: rows.results || [] });
});

workflow.put("/consignees", async (c) => {
  const { consignees } = await c.req.json<{
    consignees: Array<{ id: string; code: string; name: string; email: string; phone: string; address: string }>;
  }>();
  if (!Array.isArray(consignees)) return c.json({ error: "Invalid payload" }, 400);
  for (const entry of consignees) {
    await c.env.DB.prepare(
      `INSERT INTO consignees (id, code, name, email, phone, address, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, email=excluded.email, phone=excluded.phone, address=excluded.address, updated_at=datetime('now')`,
    )
      .bind(entry.id, entry.code || "", entry.name, entry.email || "", entry.phone || "", entry.address || "")
      .run();
  }
  return c.json({ ok: true });
});

workflow.get("/tax-log", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT payload FROM tax_log ORDER BY sent_at DESC LIMIT 500",
  ).all<{ payload: string }>();
  const entries = (rows.results || []).map((r) => JSON.parse(r.payload));
  return c.json({ entries });
});

workflow.post("/tax-log", async (c) => {
  const entry = await c.req.json<Record<string, unknown>>();
  if (!entry?.id) return c.json({ error: "Missing id" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO tax_log (id, payload, sent_at, sent_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(String(entry.id), JSON.stringify(entry), String(entry.sentAt || new Date().toISOString()), String(entry.sentBy || ""))
    .run();

  const method = String(entry.method || "");
  if (method === "FlowBoard" || method.includes("FlowBoard")) {
    try {
      await notifyFlowboardWorksheetSent(c.env, {
        entry,
        sentToCustomerVia: ["portal"],
      });
    } catch {
      /* best-effort for legacy tax-log replay */
    }
  }

  return c.json({ ok: true });
});

workflow.get("/flowboard/jobs/search", async (c) => {
  const secret = c.env.TARIFF_CLASSIFIER_WEBHOOK_SECRET || c.env.FLOWBOARD_INTEGRATION_SECRET;
  if (!secret) return c.json({ success: false, error: "FlowBoard integration not configured" }, 503);

  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ success: true, jobs: [] });

  const res = await flowboardFetch(
    c.env,
    `/api/integrations/tariff-classifier/jobs/search?q=${encodeURIComponent(q)}`,
    { headers: { "X-API-Key": secret } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return c.json(
      { success: false, error: (data as { error?: string }).error || `Search failed (${res.status})` },
      502,
    );
  }
  return c.json(data);
});

workflow.post("/flowboard/send", async (c) => {
  const body = await c.req.json<{
    entry: Record<string, unknown>;
    documentType?: string;
    jobType?: string;
    worksheetPdfBase64?: string;
    breakdownPdfBase64?: string;
    quotePdfBase64?: string;
    itemizedReportPdfBase64?: string;
    includeItemizedReport?: boolean;
    taxBreakdown?: Record<string, unknown>;
    quoteData?: Record<string, unknown>;
    classificationRows?: unknown[];
    invoiceFilenames?: string[];
    jobId?: string;
    idempotencyKey?: string;
    jobPackage?: Record<string, unknown>;
    workflowInstructions?: Record<string, unknown>;
    sentToCustomerVia?: Array<"email" | "whatsapp" | "portal">;
    notes?: string;
    customerVisibleNote?: boolean;
  }>();
  const entry = body.entry;
  if (!entry?.id || !entry.worksheetNum) return c.json({ error: "Invalid payload" }, 400);

  const documentType = String(body.documentType || entry.documentType || "worksheet");
  const jobType = body.jobType ? String(body.jobType) : entry.jobType ? String(entry.jobType) : undefined;
  const method = String(entry.method || (documentType === "worksheet" ? "FlowBoard" : "FlowBoard Quote"));

  const enriched: Record<string, unknown> = {
    ...entry,
    method,
    documentType,
    jobType,
    idempotencyKey: body.idempotencyKey,
    metadata: {
      flowboardReference: entry.flowboardReference,
      documentType,
      jobType,
      idempotencyKey: body.idempotencyKey,
      attachments: [
        ...(body.quotePdfBase64 ? [`${documentType}.pdf`] : []),
        ...(body.worksheetPdfBase64 ? ["worksheet.pdf"] : []),
        ...(body.breakdownPdfBase64 ? ["tax-breakdown.pdf"] : []),
        ...(body.itemizedReportPdfBase64 ? ["itemized-report.pdf"] : []),
        ...(body.invoiceFilenames || []).map((f) => `invoice:${f}`),
      ],
      taxBreakdown: body.taxBreakdown,
      quoteData: body.quoteData,
      classificationRows: body.classificationRows,
      jobPackage: body.jobPackage,
      workflowInstructions: body.workflowInstructions,
      worksheetPdfIncluded: !!body.worksheetPdfBase64,
      breakdownPdfIncluded: !!body.breakdownPdfBase64,
      itemizedReportIncluded: !!body.itemizedReportPdfBase64,
      quotePdfIncluded: !!body.quotePdfBase64,
      sentToCustomerVia: body.sentToCustomerVia,
      notes: body.notes,
    },
  };

  try {
    const result = await notifyFlowboardWorksheetSent(c.env, {
      entry: enriched,
      documentType,
      jobType,
      worksheetPdfBase64: body.worksheetPdfBase64,
      breakdownPdfBase64: body.breakdownPdfBase64,
      quotePdfBase64: body.quotePdfBase64,
      itemizedReportPdfBase64: body.itemizedReportPdfBase64,
      jobId: body.jobId,
      idempotencyKey: body.idempotencyKey,
      jobPackage: body.jobPackage,
      workflowInstructions: body.workflowInstructions,
      sentToCustomerVia: body.sentToCustomerVia,
      notes: body.notes,
      customerVisibleNote: body.customerVisibleNote,
      classificationRows: body.classificationRows as Parameters<typeof notifyFlowboardWorksheetSent>[1]["classificationRows"],
      taxBreakdown: body.taxBreakdown,
    });

    const synced = {
      ...enriched,
      flowboardJobId: result.jobId,
      flowboardJobUrl: result.flowboardJobUrl,
      flowboardWorksheetId: result.worksheetId,
      flowboardStatus: "sent",
      lastSyncAt: new Date().toISOString(),
      syncError: undefined,
    };

    await c.env.DB.prepare(
      `INSERT INTO tax_log (id, payload, sent_at, sent_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, sent_at=excluded.sent_at`,
    )
      .bind(
        String(entry.id),
        JSON.stringify(synced),
        String(entry.sentAt || new Date().toISOString()),
        String(entry.sentBy || ""),
      )
      .run();

    return c.json({
      ok: true,
      flowboardReference: entry.flowboardReference ? String(entry.flowboardReference) : undefined,
      jobId: result.jobId,
      flowboardJobUrl: result.flowboardJobUrl,
      message: result.message || "Worksheet attached to Flowboard job",
      created: result.created,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "FlowBoard sync failed";
    const failed = { ...enriched, syncError: message, flowboardStatus: "failed" };
    await c.env.DB.prepare(
      `INSERT INTO tax_log (id, payload, sent_at, sent_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, sent_at=excluded.sent_at`,
    )
      .bind(
        String(entry.id),
        JSON.stringify(failed),
        String(entry.sentAt || new Date().toISOString()),
        String(entry.sentBy || ""),
      )
      .run();
    return c.json({ error: message }, 502);
  }
});

export default workflow;
