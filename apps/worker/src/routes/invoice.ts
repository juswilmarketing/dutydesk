import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { anthropicDocument } from "../lib/anthropic";
import { INVOICE_PROMPT, parseInvoicesFromModelText, type ParsedInvoice } from "../lib/invoice-parse";
import { audit } from "../lib/utils";

const invoice = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const MAX_BASE64_LENGTH = 14_000_000; // ~10MB file
const JOB_TTL_SECONDS = 15 * 60;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

type InvoiceJob =
  | { status: "pending"; created_at: number }
  | { status: "done"; created_at: number; invoices: ParsedInvoice[] }
  | { status: "error"; created_at: number; error: string };

function jobKey(id: string) {
  return `invoice-parse:${id}`;
}

async function putJob(kv: KVNamespace, id: string, job: InvoiceJob) {
  await kv.put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
}

async function getJob(kv: KVNamespace, id: string): Promise<InvoiceJob | null> {
  const raw = await kv.get(jobKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InvoiceJob;
  } catch {
    return null;
  }
}

/**
 * Stream NDJSON with heartbeats so Cloudflare does not return 524 while Anthropic
 * processes large PDFs. Result is also stored in KV for status polling recovery.
 */
invoice.post("/parse", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "AI service not configured" }, 503);
  }

  const body = await c.req.json<{ base64?: string; mediaType?: string }>();
  const base64 = body.base64;
  const mediaType = body.mediaType || "application/pdf";

  if (!base64) return c.json({ error: "File data required" }, 400);
  if (base64.length > MAX_BASE64_LENGTH) return c.json({ error: "File too large (max 10MB)" }, 413);
  if (!ALLOWED_TYPES.has(mediaType)) return c.json({ error: "Unsupported file type" }, 415);

  const jobId = crypto.randomUUID();
  const env = c.env;
  await putJob(env.SESSIONS, jobId, { status: "pending", created_at: Date.now() });
  await audit(c, "invoice_parse_started");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const ping = setInterval(() => {
        try {
          send({ type: "ping", job_id: jobId, t: Date.now() });
        } catch {
          /* stream closed */
        }
      }, 8_000);

      try {
        send({ type: "started", job_id: jobId });
        const text = await anthropicDocument(env.ANTHROPIC_API_KEY, base64, mediaType, INVOICE_PROMPT, 8000);
        const invoices = parseInvoicesFromModelText(text);
        await putJob(env.SESSIONS, jobId, { status: "done", created_at: Date.now(), invoices });
        send({ type: "done", job_id: jobId, invoices });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invoice parse failed";
        await putJob(env.SESSIONS, jobId, { status: "error", created_at: Date.now(), error: msg });
        try {
          send({ type: "error", job_id: jobId, error: msg });
        } catch {
          /* ignore */
        }
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Invoice-Job-Id": jobId,
    },
  });
});

invoice.get("/parse/status", async (c) => {
  const jobId = c.req.query("job_id")?.trim();
  if (!jobId) return c.json({ error: "job_id required" }, 400);

  const job = await getJob(c.env.SESSIONS, jobId);
  if (!job) return c.json({ error: "Job not found or expired. Please upload again." }, 404);

  if (job.status === "pending") {
    return c.json({ job_id: jobId, status: "pending" });
  }
  if (job.status === "error") {
    return c.json({ job_id: jobId, status: "error", error: job.error });
  }
  return c.json({ job_id: jobId, status: "done", invoices: job.invoices });
});

export default invoice;
