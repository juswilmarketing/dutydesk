import type { Context } from "hono";
import type { Env, AppVariables } from "../env";

export const SESSION_COOKIE = "pas_session";

export async function audit(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  action: string,
) {
  const v = c.var;
  await c.env.DB.prepare(
    "INSERT INTO audit_log (user_id, username, action) VALUES (?, ?, ?)",
  )
    .bind(v.userId ?? null, v.username ?? null, action)
    .run();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [k, ...rest] = part.trim().split("=");
      return [k, decodeURIComponent(rest.join("="))];
    }),
  );
}

export function setSessionCookie(sessionId: string, maxAgeSec: number): string {
  const secure = "Secure; ";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; ${secure}SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
