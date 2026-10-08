import type { D1Database, KVNamespace, Fetcher, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  DOCUMENTS: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  GOOGLE_SCRIPT_URL?: string;
  GOOGLE_SCRIPT_SECRET?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_FROM?: string;
  ENVIRONMENT: string;
  SESSION_TTL_HOURS: string;
  FLOWBOARD_INTEGRATION_SECRET?: string;
  TARIFF_CLASSIFIER_WEBHOOK_SECRET?: string;
  FLOWBOARD_API_BASE_URL?: string;
  FLOWBOARD_OPS_URL?: string;
  FLOWBOARD_WEBHOOK_URL?: string;
  /** Service binding to flowboardtt — avoids CF 1042 on worker-to-worker fetch */
  FLOWBOARD_SERVICE?: Fetcher;
  TAX_ADVICE_SHARE_TTL_DAYS?: string;
  /** Branded origin for customer-facing share links (e.g. https://advice.pastrinidad.com). */
  TAX_ADVICE_SHARE_BASE_URL?: string;
  DOC_OCR_BATCH_SIZE?: string;
  DOC_AI_LINE_BATCH_SIZE?: string;
  DOC_MAX_PAGES?: string;
  DOC_MAX_RETRIES?: string;
  PRODUCT_LOOKUP_URL?: string;
  PRODUCT_LOOKUP_TOKEN?: string;
}

export interface AppVariables {
  userId: number;
  username: string;
  name: string;
  role: "admin" | "clerk";
  sessionId: string;
}
