import { Hono } from "hono";
import type { Env, AppVariables } from "../env";

const email = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface SendBody {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string; mimeType?: string }>;
}

function emailIdentity(env: Env, body: SendBody) {
  return {
    fromName: body.fromName?.trim() || env.EMAIL_FROM_NAME?.trim() || env.EMAIL_FROM?.trim() || "PAS Trinidad Brokerage Department",
    fromAddress: body.fromAddress?.trim() || env.EMAIL_FROM_ADDRESS?.trim() || "brokerage@pastrinidad.com",
    replyTo: body.replyTo?.trim() || env.EMAIL_REPLY_TO?.trim() || env.EMAIL_FROM_ADDRESS?.trim() || "brokerage@pastrinidad.com",
  };
}

function isValidEmail(addr: string) {
  return EMAIL_RE.test(addr.trim());
}

/** Split comma / semicolon / whitespace-separated email lists. */
function parseEmailList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(part.trim());
  }
  return out;
}

function formatEmailList(emails: string[]): string {
  return emails.join(", ");
}

function estimateBase64Bytes(b64: string) {
  return Math.floor((b64.length * 3) / 4);
}

function mimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xml: "application/xml",
    txt: "text/plain",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

function normalizeScriptUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.endsWith("/dev")) return `${trimmed.slice(0, -4)}/exec`;
  return trimmed;
}

function parseScriptResponse(text: string): { ok?: boolean; error?: string; message?: string } {
  try {
    return JSON.parse(text) as { ok?: boolean; error?: string; message?: string };
  } catch {
    return {
      error: "Gmail script did not return JSON — redeploy Apps Script (Execute as: Me, Access: Anyone) and use the /exec URL",
    };
  }
}

/** Follow GET redirects to discover the googleusercontent.com URL that accepts POST. */
async function resolveGoogleScriptPostUrl(scriptUrl: string): Promise<string> {
  let current = normalizeScriptUrl(scriptUrl);
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, { method: "GET", redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("Location");
      if (!next) break;
      current = next;
      continue;
    }
    break;
  }
  return current;
}

/** POST via resolved googleusercontent URL — avoids GAS dropping POST body on redirect. */
async function callGoogleScript(scriptUrl: string, payload: Record<string, unknown>) {
  const postUrl = await resolveGoogleScriptPostUrl(scriptUrl);
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;

  const attempts: Array<{ label: string; init: RequestInit }> = [
    {
      label: "resolved-post",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "follow",
      },
    },
    {
      label: "exec-post-follow",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "follow",
      },
    },
  ];

  const urls = [postUrl, normalizeScriptUrl(scriptUrl)];
  let lastDetail = "";

  for (let i = 0; i < attempts.length; i++) {
    const res = await fetch(urls[i], attempts[i].init);
    const text = await res.text();
    lastDetail = text.replace(/\s+/g, " ").slice(0, 160);
    const result = parseScriptResponse(text);
    if (!result.error && result.ok === true) {
      return { ok: true as const };
    }
  }

  const result = parseScriptResponse(lastDetail);
  return {
    ok: false as const,
    error: result.error || result.message || "Gmail script rejected the request",
    detail: lastDetail,
  };
}

function validatePayload(body: SendBody) {
  const toList = parseEmailList(body.to);
  const ccList = parseEmailList(body.cc);
  const subject = body.subject?.trim();
  const html = body.html?.trim();

  if (!toList.length) return { error: "At least one recipient email is required" as const };
  if (toList.some((addr) => !isValidEmail(addr))) {
    return { error: "One or more To email addresses are invalid" as const };
  }
  if (ccList.some((addr) => !isValidEmail(addr))) {
    return { error: "One or more CC email addresses are invalid" as const };
  }
  if (!subject) return { error: "Subject is required" as const };
  if (!html) return { error: "Email body is required" as const };

  const attachments = body.attachments || [];
  let totalBytes = 0;
  for (const file of attachments) {
    if (!file.filename?.trim() || !file.content) {
      return { error: "Each attachment needs a filename and content" as const };
    }
    const size = estimateBase64Bytes(file.content);
    if (size > MAX_ATTACHMENT_BYTES) {
      return { error: `Attachment "${file.filename}" is too large (max 8 MB)` as const };
    }
    totalBytes += size;
  }
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { error: "Total attachment size exceeds 20 MB" as const };
  }

  return {
    to: formatEmailList(toList),
    cc: ccList.length ? formatEmailList(ccList) : undefined,
    subject,
    html,
    attachments: attachments.map((a) => ({
      filename: a.filename.trim(),
      content: a.content,
      mimeType: a.mimeType || mimeFromFilename(a.filename),
    })),
  };
}

email.get("/status", (c) => {
  const configured = Boolean(c.env.GOOGLE_SCRIPT_URL?.trim());
  const fromName = c.env.EMAIL_FROM_NAME?.trim() || c.env.EMAIL_FROM?.trim() || "PAS Trinidad Brokerage Department";
  const fromAddress = c.env.EMAIL_FROM_ADDRESS?.trim() || "brokerage@pastrinidad.com";
  return c.json({
    configured,
    provider: configured ? "gmail" : undefined,
    from: `${fromName} <${fromAddress}>`,
    fromName,
    fromAddress,
    replyTo: c.env.EMAIL_REPLY_TO?.trim() || fromAddress,
  });
});

email.get("/ping", async (c) => {
  const scriptUrl = c.env.GOOGLE_SCRIPT_URL?.trim();
  if (!scriptUrl) return c.json({ ok: false, error: "GOOGLE_SCRIPT_URL not set" });

  const url = normalizeScriptUrl(scriptUrl);
  const getRes = await fetch(url, { method: "GET", redirect: "follow" });
  const getText = await getRes.text();
  const getParsed = parseScriptResponse(getText);
  let scriptVersion: number | undefined;
  let sendAs: unknown;
  try {
    const meta = JSON.parse(getText) as { version?: number; sendAs?: unknown };
    scriptVersion = meta.version;
    sendAs = meta.sendAs;
  } catch {
    /* not JSON */
  }

  const postResult = await callGoogleScript(scriptUrl, {
    secret: c.env.GOOGLE_SCRIPT_SECRET || "",
    ping: true,
  });

  const resolvedUrl = await resolveGoogleScriptPostUrl(scriptUrl);
  const scriptStale = scriptVersion == null || scriptVersion < 4;

  return c.json({
    ok: getParsed.ok === true && postResult.ok && !scriptStale,
    urlEndsWithExec: url.endsWith("/exec"),
    scriptVersion: scriptVersion ?? null,
    scriptStale,
    staleHint: scriptStale
      ? "DutyDesk is calling an OLD Apps Script deployment. Redeploy v4 script and run: npx wrangler secret put GOOGLE_SCRIPT_URL"
      : undefined,
    sendAs,
    resolvedHost: (() => {
      try {
        return new URL(resolvedUrl).host;
      } catch {
        return "invalid";
      }
    })(),
    get: { ok: getParsed.ok === true, snippet: getText.replace(/\s+/g, " ").slice(0, 120) },
    post: postResult.ok ? { ok: true } : { ok: false, error: postResult.error, detail: postResult.detail },
    fromAddress: c.env.EMAIL_FROM_ADDRESS?.trim() || "brokerage@pastrinidad.com",
  });
});

email.post("/send", async (c) => {
  const scriptUrl = c.env.GOOGLE_SCRIPT_URL?.trim();
  if (!scriptUrl) {
    return c.json(
      { error: "Direct email is not configured. Deploy the Google Apps Script and add GOOGLE_SCRIPT_URL." },
      503,
    );
  }

  let body: SendBody;
  try {
    body = await c.req.json<SendBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validated = validatePayload(body);
  if ("error" in validated) return c.json({ error: validated.error }, 400);

  const identity = emailIdentity(c.env, body);

  const result = await callGoogleScript(scriptUrl, {
    secret: c.env.GOOGLE_SCRIPT_SECRET || "",
    fromName: identity.fromName,
    fromAddress: identity.fromAddress,
    replyTo: identity.replyTo,
    to: validated.to,
    cc: validated.cc,
    subject: validated.subject,
    html: validated.html,
    attachments: validated.attachments,
  });

  if (!result.ok) {
    return c.json({ error: result.error, detail: result.detail }, 502);
  }

  return c.json({ ok: true });
});

export default email;
