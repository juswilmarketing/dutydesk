import { Hono } from "hono";
import type { Env } from "../env";
import { flowboardFetch, flowboardWorksheetSentPath, trimWorksheetPayloadForWebhook } from "../lib/flowboard-fetch";

const flowboard = new Hono<{ Bindings: Env }>();

async function hmacSign(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function integrationSecret(env: Env) {
  return env.TARIFF_CLASSIFIER_WEBHOOK_SECRET || env.FLOWBOARD_INTEGRATION_SECRET;
}

function authorizeIntegration(c: { env: Env; req: { header: (n: string) => string | undefined } }) {
  const secret = integrationSecret(c.env);
  if (!secret) return { ok: false as const, status: 503, error: "Integration not configured" };
  const headerSecret = c.req.header("X-Flowboard-Secret");
  if (headerSecret && headerSecret === secret) return { ok: true as const };
  return { ok: false as const, status: 401, error: "Unauthorized" };
}

type ClassificationRow = {
  desc?: string;
  itemDescription?: string;
  tariff_code?: string | null;
  hsCode?: string;
  duty_rate?: string | null;
  dutyRate?: string;
  vat_rate?: string;
  vatRate?: string;
  taxAmount?: number;
  itemCif?: number;
};

export type FlowboardWorksheetSendBody = {
  entry: Record<string, unknown>;
  documentType?: string;
  jobType?: string;
  worksheetPdfBase64?: string;
  breakdownPdfBase64?: string;
  quotePdfBase64?: string;
  itemizedReportPdfBase64?: string;
  jobId?: string;
  idempotencyKey?: string;
  jobPackage?: Record<string, unknown>;
  workflowInstructions?: Record<string, unknown>;
  sentToCustomerVia?: Array<"email" | "whatsapp" | "portal">;
  notes?: string;
  customerVisibleNote?: boolean;
  classificationRows?: ClassificationRow[];
  taxBreakdown?: Record<string, unknown>;
};

function mapClassificationRows(rows: ClassificationRow[] | undefined) {
  return (rows ?? []).map((row) => ({
    itemDescription: row.itemDescription || row.desc || "",
    hsCode: row.hsCode || row.tariff_code || "",
    dutyRate: row.dutyRate || row.duty_rate || "",
    vatRate: row.vatRate || row.vat_rate || "12.5%",
    taxAmount: typeof row.taxAmount === "number" ? row.taxAmount : 0,
  }));
}

function buildTariffClassifierPayload(body: FlowboardWorksheetSendBody) {
  const entry = body.entry;
  const worksheetNumber = String(entry.worksheetNum || "");
  const reference = String(entry.billOfLading || entry.worksheetNum || "").trim() || worksheetNumber;
  const customerName = String(entry.consigneeName || "Customer").trim() || "Customer";
  const sentAt = entry.sentAt ? String(entry.sentAt) : new Date().toISOString();
  const sentVia = body.sentToCustomerVia?.length ? body.sentToCustomerVia : (["portal"] as const);

  const grandTotal = Number(entry.grandTotal ?? 0);
  const totalDuty = Number(entry.totalDuty ?? 0);
  const totalVAT = Number(entry.totalVAT ?? 0);
  const otherFees = Number(entry.depositFee ?? 0) + Number(entry.cesFee ?? 0) + Number(entry.userFeeAmt ?? 0);

  const pdfBase64 =
    body.worksheetPdfBase64 ||
    body.quotePdfBase64 ||
    undefined;

  const notes =
    body.customerVisibleNote === false
      ? undefined
      : body.notes?.trim() || undefined;

  return {
    jobId: body.jobId || (entry.flowboardJobId ? String(entry.flowboardJobId) : undefined) || (entry.taskId ? String(entry.taskId) : undefined),
    reference,
    customerEmail: entry.customerEmail ? String(entry.customerEmail) : undefined,
    customerName,
    worksheetNumber,
    worksheetStatus: "sent" as const,
    billOfLading: entry.billOfLading ? String(entry.billOfLading) : undefined,
    classificationSummary: mapClassificationRows(body.classificationRows),
    totals: {
      customsDuty: totalDuty,
      vat: totalVAT,
      otherFees,
      totalTaxes: grandTotal,
    },
    worksheetPdfBase64: pdfBase64,
    sentToCustomerVia: [...sentVia],
    sentAt,
    notes: notes || undefined,
    // Complete job package + FlowBoard import instructions (idempotent create/update).
    jobType: body.jobType || (entry.jobType ? String(entry.jobType) : undefined),
    idempotencyKey:
      body.idempotencyKey ||
      (entry.idempotencyKey ? String(entry.idempotencyKey) : undefined) ||
      (body.jobId ? `dutydesk:${body.jobId}` : `dutydesk:${worksheetNumber}`),
    jobPackage: body.jobPackage,
    workflowInstructions: body.workflowInstructions,
  };
}

/** Flowboard manual sync — GET worksheet status from tax log */
flowboard.get("/worksheet/:worksheetNum", async (c) => {
  const auth = authorizeIntegration(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status as 401 | 503);

  const worksheetNum = decodeURIComponent(c.req.param("worksheetNum"));
  const taskId = c.req.query("taskId");

  const rows = await c.env.DB.prepare(
    "SELECT id, payload, sent_at AS sentAt FROM tax_log ORDER BY sent_at DESC LIMIT 1000",
  ).all<{ id: string; payload: string; sentAt: string }>();

  for (const row of rows.results ?? []) {
    try {
      const entry = JSON.parse(row.payload) as Record<string, unknown>;
      const num = entry.worksheetNum ? String(entry.worksheetNum) : "";
      if (num.toLowerCase() !== worksheetNum.toLowerCase()) continue;
      if (taskId && entry.taskId && String(entry.taskId) !== taskId) continue;
      const sentAt = entry.sentAt ? String(entry.sentAt) : row.sentAt;
      return c.json({
        status: sentAt ? "sent" : "draft",
        dutydeskLogId: row.id,
        sentAt,
        billOfLading: entry.billOfLading ? String(entry.billOfLading) : undefined,
        consigneeName: entry.consigneeName ? String(entry.consigneeName) : undefined,
        sentTo: entry.sentTo ? String(entry.sentTo) : undefined,
        flowboardJobId: entry.flowboardJobId ? String(entry.flowboardJobId) : undefined,
        metadata: {
          consigneeName: entry.consigneeName,
          billOfLading: entry.billOfLading,
          sentTo: entry.sentTo,
          flowboardJobId: entry.flowboardJobId,
        },
      });
    } catch { /* skip bad row */ }
  }

  return c.json({ status: "draft", worksheetNum });
});

flowboard.post("/worksheet-status", async (c) => {
  const secret = integrationSecret(c.env);
  if (!secret) return c.json({ error: "Integration not configured" }, 503);

  const raw = await c.req.text();
  const sig = c.req.header("X-Flowboard-Signature");
  const expected = await hmacSign(secret, raw);
  if (sig !== expected) return c.json({ error: "Invalid signature" }, 401);

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return c.json({ ok: true, received: payload.worksheetNum });
});

flowboard.get("/jobs/search", async (c) => {
  const secret = integrationSecret(c.env);
  if (!secret) return c.json({ success: false, error: "Integration not configured" }, 503);

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
      { success: false, error: (data as { error?: string }).error || `FlowBoard search failed (${res.status})` },
      502,
    );
  }
  return c.json(data);
});

/** Integration diagnostics — confirms service binding vs public fetch to flowboardtt */
flowboard.get("/connectivity", async (c) => {
  const secret = integrationSecret(c.env);
  const health = await flowboardFetch(c.env, "/api/integrations/tariff-classifier/health", {
    headers: secret ? { "X-API-Key": secret } : undefined,
  });
  const healthText = await health.text();

  const dryRun = await flowboardFetch(c.env, flowboardWorksheetSentPath(c.env), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-API-Key": secret } : {}) },
    body: "{}",
  });
  const dryRunText = await dryRun.text();

  return c.json({
    ok: health.ok && dryRun.status !== 404,
    health: { status: health.status, body: healthText.slice(0, 200) },
    worksheetRoute: { status: dryRun.status, body: dryRunText.slice(0, 200) },
    usesServiceBinding: Boolean(c.env.FLOWBOARD_SERVICE),
    secretConfigured: Boolean(secret),
  });
});

export type FlowboardWorksheetSentResult = {
  jobId?: string;
  worksheetId?: string;
  flowboardJobUrl?: string;
  message?: string;
  matched?: boolean;
  created?: boolean;
  ambiguous?: boolean;
  candidateJobIds?: string[];
};

export async function notifyFlowboardWorksheetSent(
  env: Env,
  body: FlowboardWorksheetSendBody,
): Promise<FlowboardWorksheetSentResult> {
  const secret = integrationSecret(env);
  if (!secret) throw new Error("FlowBoard integration secret not configured");

  const entry = body.entry;
  const worksheetNum = entry.worksheetNum ? String(entry.worksheetNum) : "";
  if (!worksheetNum) throw new Error("Worksheet number is required");

  const payload = trimWorksheetPayloadForWebhook(buildTariffClassifierPayload(body));
  const raw = JSON.stringify(payload);
  const signature = await hmacSign(secret, raw);

  const apiPath = flowboardWorksheetSentPath(env);
  const res = await flowboardFetch(env, apiPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tariff-Classifier-Signature": signature,
      "X-API-Key": secret,
    },
    body: raw,
  });

  const responseText = await res.text();
  let data: {
    success?: boolean;
    error?: string;
    jobId?: string;
    worksheetId?: string;
    flowboardJobUrl?: string;
    message?: string;
    matched?: boolean;
    created?: boolean;
    ambiguous?: boolean;
    candidateJobIds?: string[];
  } = {};
  try {
    data = JSON.parse(responseText) as typeof data;
  } catch {
    /* non-JSON body (e.g. Cloudflare 1042 HTML) */
  }

  if (!res.ok || data.success === false) {
    const detail = data.error || responseText;
    const via = env.FLOWBOARD_SERVICE ? "service-binding" : "missing-binding";
    throw new Error(
      `FlowBoard webhook failed (${res.status}, ${via})${detail ? `: ${String(detail).slice(0, 300)}` : ""}`,
    );
  }

  if (data.ambiguous) {
    throw new Error(
      `Multiple FlowBoard jobs match this worksheet. Link a specific job in DutyDesk before sending.${
        data.candidateJobIds?.length ? ` (${data.candidateJobIds.length} candidates)` : ""
      }`,
    );
  }

  return {
    jobId: data.jobId,
    worksheetId: data.worksheetId,
    flowboardJobUrl: data.flowboardJobUrl,
    message: data.message,
    matched: data.matched,
    created: data.created,
  };
}

/** @deprecated Legacy wrapper — prefer notifyFlowboardWorksheetSent with full body */
export async function notifyFlowboardWorksheetSentLegacy(
  env: Env,
  entry: {
    worksheetNum?: string;
    taskId?: string;
    id: string;
    sentAt?: string;
    billOfLading?: string;
    consigneeName?: string;
    sentTo?: string;
    flowboardReference?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return notifyFlowboardWorksheetSent(env, {
    entry: {
      ...entry,
      flowboardJobId: entry.taskId,
    },
    jobId: entry.taskId,
    sentToCustomerVia: ["portal"],
  });
}

export default flowboard;
