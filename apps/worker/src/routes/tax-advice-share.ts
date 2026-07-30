import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { authMiddleware } from "../middleware/auth";
import { randomSessionId } from "../lib/crypto";

const share = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const KV_PREFIX = "advice-share:";
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const DEFAULT_TTL_DAYS = 30;

interface ShareRecord {
  worksheetNum: string;
  consigneeName: string;
  filename: string;
  pdfBase64: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
}

function shareTtlSeconds(env: Env): number {
  const days = parseInt(env.TAX_ADVICE_SHARE_TTL_DAYS || String(DEFAULT_TTL_DAYS), 10);
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : DEFAULT_TTL_DAYS;
  return safeDays * 24 * 60 * 60;
}

function estimateBase64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function shareUrl(c: { req: { url: string } }, token: string): string {
  const origin = new URL(c.req.url).origin;
  return `${origin}/api/tax-advice/share/${token}`;
}

share.post("/", authMiddleware, async (c) => {
  const body = await c.req.json<{
    pdfBase64?: string;
    worksheetNum?: string;
    consigneeName?: string;
    filename?: string;
  }>();

  const pdfBase64 = body.pdfBase64?.trim();
  if (!pdfBase64) return c.json({ error: "pdfBase64 is required" }, 400);
  if (estimateBase64Bytes(pdfBase64) > MAX_PDF_BYTES) {
    return c.json({ error: "PDF exceeds 8MB limit" }, 413);
  }

  const worksheetNum = (body.worksheetNum || "Assessment").trim().slice(0, 120);
  const consigneeName = (body.consigneeName || "").trim().slice(0, 200);
  const filename =
    (body.filename || `DutyDesk_Tax_Advice_${worksheetNum.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`)
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 180) || "DutyDesk_Tax_Advice.pdf";

  const token = randomSessionId();
  const createdAt = new Date().toISOString();
  const ttl = shareTtlSeconds(c.env);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const record: ShareRecord = {
    worksheetNum,
    consigneeName,
    filename,
    pdfBase64,
    createdAt,
    createdBy: c.get("name") || c.get("username") || "DutyDesk",
    expiresAt,
  };

  await c.env.SESSIONS.put(`${KV_PREFIX}${token}`, JSON.stringify(record), { expirationTtl: ttl });

  const viewUrl = shareUrl(c, token);
  return c.json({
    ok: true,
    token,
    viewUrl,
    viewerUrl: `${viewUrl}?view=1`,
    downloadUrl: `${viewUrl}?download=1`,
    expiresAt,
  });
});

share.get("/:token", async (c) => {
  const token = c.req.param("token")?.trim();
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return c.text("Invalid link", 400);
  }

  const raw = await c.env.SESSIONS.get(`${KV_PREFIX}${token}`);
  if (!raw) {
    return c.html(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Link expired</title>
<style>body{font-family:Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 20px;color:#333;text-align:center}
h1{color:#8B0000;font-size:22px}p{line-height:1.6;color:#555}</style></head>
<body><h1>Link unavailable</h1><p>This tax advice link has expired or was removed. Contact PAS Trinidad Brokerage for a new copy.</p></body></html>`,
      404,
    );
  }

  let record: ShareRecord;
  try {
    record = JSON.parse(raw) as ShareRecord;
  } catch {
    return c.text("Corrupt share record", 500);
  }

  const pdfBytes = Uint8Array.from(atob(record.pdfBase64), (ch) => ch.charCodeAt(0));
  const download = c.req.query("download") === "1";
  const view = c.req.query("view") === "1";

  if (view) {
    const safeWorksheet = record.worksheetNum.replace(/[<>&"]/g, "");
    const safeName = record.consigneeName.replace(/[<>&"]/g, "");
    const pdfUrl = `${shareUrl(c, token)}?raw=1`;
    const downloadUrl = `${shareUrl(c, token)}?download=1`;
    return c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DutyDesk Tax Advice${safeWorksheet ? ` — ${safeWorksheet}` : ""}</title>
<style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f4f5f8;color:#111}
  .bar{background:#0f1520;color:#fff;padding:14px 18px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
  .bar h1{margin:0;font-size:18px}.meta{font-size:12px;opacity:.85}
  .actions{display:flex;gap:10px;flex-wrap:wrap}
  .btn{display:inline-block;padding:10px 16px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px}
  .btn-primary{background:#8B0000;color:#fff}.btn-secondary{background:#fff;color:#0f1520}
  .frame-wrap{padding:12px;height:calc(100vh - 72px)}iframe{width:100%;height:100%;border:none;background:#fff}
  @media(max-width:640px){.frame-wrap{height:calc(100dvh - 96px)}}
</style></head><body>
<div class="bar">
  <div>
    <h1>Tax Advice${safeWorksheet ? ` · ${safeWorksheet}` : ""}</h1>
    <div class="meta">${safeName ? `Consignee: ${safeName} · ` : ""}PAS Trinidad Brokerage</div>
  </div>
  <div class="actions">
    <a class="btn btn-secondary" href="${downloadUrl}">Download PDF</a>
    <a class="btn btn-primary" href="${pdfUrl}" target="_blank" rel="noopener">Open PDF</a>
  </div>
</div>
<div class="frame-wrap"><iframe src="${pdfUrl}" title="Tax advice PDF"></iframe></div>
</body></html>`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${record.filename.replace(/"/g, "")}"`;
  } else {
    headers["Content-Disposition"] = `inline; filename="${record.filename.replace(/"/g, "")}"`;
  }

  return new Response(pdfBytes, { status: 200, headers });
});

export default share;
