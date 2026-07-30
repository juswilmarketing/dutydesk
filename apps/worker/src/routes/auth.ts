import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { hashPassword, verifyPassword, randomSessionId } from "../lib/crypto";
import { audit, setSessionCookie, clearSessionCookie } from "../lib/utils";
import { authMiddleware } from "../middleware/auth";

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);

  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash, name, role FROM users WHERE username = ?",
  )
    .bind(username)
    .first<{ id: number; username: string; password_hash: string; name: string; role: "admin" | "clerk" }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  const sessionId = randomSessionId();
  const ttlHours = parseInt(c.env.SESSION_TTL_HOURS || "24", 10);
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();

  await c.env.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      expiresAt,
    }),
    { expirationTtl: ttlHours * 3600 + 60 },
  );

  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, user.id, expiresAt)
    .run();

  c.header("Set-Cookie", setSessionCookie(sessionId, ttlHours * 3600));
  return c.json({ id: user.id, username: user.username, name: user.name, role: user.role });
});

auth.get("/me", authMiddleware, async (c) => {
  return c.json({
    id: c.var.userId,
    username: c.var.username,
    name: c.var.name,
    role: c.var.role,
  });
});

auth.post("/logout", authMiddleware, async (c) => {
  await c.env.SESSIONS.delete(`session:${c.var.sessionId}`);
  await audit(c, "logout");
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

auth.post("/seed", async (c) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "Not available in production" }, 403);
  }
  const body = await c.req.json<{ username?: string; password?: string; name?: string; role?: string }>();
  const username = body.username?.trim() || "admin";
  const password = body.password || "changeme";
  const name = body.name || "Admin";
  const role = body.role === "clerk" ? "clerk" : "admin";
  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role",
  )
    .bind(username, passwordHash, name, role)
    .run();
  return c.json({ ok: true, username, message: "User seeded. Change password after first login." });
});

export default auth;
