import { createMiddleware } from "hono/factory";
import type { Env, AppVariables } from "../env";
import { parseCookies, SESSION_COOKIE } from "../lib/utils";

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const cookies = parseCookies(c.req.header("Cookie"));
    const sessionId = cookies[SESSION_COOKIE];
    if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

    const session = await c.env.SESSIONS.get(`session:${sessionId}`, "json") as {
      userId: number;
      username: string;
      name: string;
      role: "admin" | "clerk";
      expiresAt: string;
    } | null;

    if (!session || new Date(session.expiresAt) < new Date()) {
      return c.json({ error: "Session expired" }, 401);
    }

    c.set("userId", session.userId);
    c.set("username", session.username);
    c.set("name", session.name);
    c.set("role", session.role);
    c.set("sessionId", sessionId);
    await next();
  },
);

export const adminMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    if (c.var.role !== "admin") return c.json({ error: "Forbidden" }, 403);
    await next();
  },
);
