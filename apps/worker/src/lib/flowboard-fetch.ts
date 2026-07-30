import type { Env } from "../env";

const DEFAULT_FLOWBOARD_API = "https://flowboardtt.mwilson-561.workers.dev";
/** Stay under typical subrequest limits when sending base64 PDFs */
const MAX_WEBHOOK_BYTES = 4 * 1024 * 1024;

export function flowboardApiBase(env: Env) {
  return (env.FLOWBOARD_API_BASE_URL || DEFAULT_FLOWBOARD_API).replace(/\/$/, "");
}

export function flowboardWorksheetSentPath(env: Env): string {
  if (env.FLOWBOARD_WEBHOOK_URL) {
    try {
      return new URL(env.FLOWBOARD_WEBHOOK_URL).pathname;
    } catch {
      /* use default */
    }
  }
  return "/api/integrations/tariff-classifier/worksheet-sent";
}

function resolveFlowboardPath(env: Env, apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (!env.FLOWBOARD_SERVICE) return path;
  if (path.startsWith("/api/integrations/tariff-classifier/")) {
    return path.replace("/api/integrations/", "/api/pas/integrations/");
  }
  return path;
}

export class FlowboardFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly via: "service-binding" | "missing-binding",
    readonly detail: string,
  ) {
    super(message);
    this.name = "FlowboardFetchError";
  }
}

/**
 * Call flowboardtt only through the FLOWBOARD_SERVICE binding.
 * Public fetch to *.workers.dev triggers Cloudflare error 1042 on the same account.
 */
export async function flowboardFetch(env: Env, apiPath: string, init?: RequestInit): Promise<Response> {
  const binding = env.FLOWBOARD_SERVICE;
  if (!binding) {
    throw new FlowboardFetchError(
      "FlowBoard service binding is not configured on this DutyDesk worker. Use https://dutydesk.mwilson-561.workers.dev (deployed), not local Vite dev without wrangler bindings.",
      0,
      "missing-binding",
      "FLOWBOARD_SERVICE binding missing",
    );
  }

  const path = resolveFlowboardPath(env, apiPath);
  const headers = new Headers(init?.headers as HeadersInit);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return binding.fetch(`https://flowboard.internal${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ?? null,
  });
}

/** Trim oversized PDF payloads so service-binding POST stays within limits. */
export function trimWorksheetPayloadForWebhook<T extends { worksheetPdfBase64?: string }>(payload: T): T {
  let raw = JSON.stringify(payload);
  if (raw.length <= MAX_WEBHOOK_BYTES) return payload;

  const trimmed = { ...payload, worksheetPdfBase64: undefined };
  raw = JSON.stringify(trimmed);
  if (raw.length <= MAX_WEBHOOK_BYTES) return trimmed;

  return trimmed;
}
