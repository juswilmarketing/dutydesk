import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { adminMiddleware, authMiddleware } from "../middleware/auth";
import { hashPassword } from "../lib/crypto";

const users = new Hono<{ Bindings: Env; Variables: AppVariables }>();

users.use("*", authMiddleware, adminMiddleware);

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;

type UserRow = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "clerk";
  created_at: string;
};

function sanitizeUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  };
}

users.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, username, name, role, created_at FROM users ORDER BY name COLLATE NOCASE",
  ).all<UserRow>();
  return c.json({ users: (rows.results || []).map(sanitizeUser) });
});

users.post("/", async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    name?: string;
    role?: string;
  }>();

  const username = body.username?.trim() || "";
  const password = body.password || "";
  const name = body.name?.trim() || "";
  const role = body.role === "admin" ? "admin" : "clerk";

  if (!USERNAME_RE.test(username)) {
    return c.json({ error: "Username must be 2–32 characters (letters, numbers, . _ -)" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }
  if (!name) return c.json({ error: "Display name is required" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: number }>();
  if (existing) return c.json({ error: "Username already exists" }, 409);

  const passwordHash = await hashPassword(password);
  const result = await c.env.DB.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?) RETURNING id, username, name, role, created_at",
  )
    .bind(username, passwordHash, name, role)
    .first<UserRow>();

  if (!result) return c.json({ error: "Failed to create user" }, 500);
  return c.json({ user: sanitizeUser(result) }, 201);
});

users.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid user id" }, 400);

  const body = await c.req.json<{
    name?: string;
    role?: string;
    password?: string;
  }>();

  const target = await c.env.DB.prepare("SELECT id, username, role FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: number; username: string; role: "admin" | "clerk" }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  const name = body.name?.trim();
  const role = body.role === "admin" ? "admin" : body.role === "clerk" ? "clerk" : undefined;
  const password = body.password;

  if (role && role !== target.role && target.role === "admin") {
    const adminCount = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      .first<{ n: number }>();
    if ((adminCount?.n || 0) <= 1) {
      return c.json({ error: "Cannot demote the last admin" }, 400);
    }
  }

  if (id === c.var.userId && role === "clerk") {
    return c.json({ error: "You cannot demote your own admin account" }, 400);
  }

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (name) {
    updates.push("name = ?");
    binds.push(name);
  }
  if (role) {
    updates.push("role = ?");
    binds.push(role);
  }
  if (password) {
    if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
    updates.push("password_hash = ?");
    binds.push(await hashPassword(password));
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT id, username, name, role, created_at FROM users WHERE id = ?",
  )
    .bind(id)
    .first<UserRow>();

  return c.json({ user: sanitizeUser(updated!) });
});

users.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid user id" }, 400);

  if (id === c.var.userId) {
    return c.json({ error: "You cannot delete your own account while logged in" }, 400);
  }

  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: number; role: "admin" | "clerk" }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  if (target.role === "admin") {
    const adminCount = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      .first<{ n: number }>();
    if ((adminCount?.n || 0) <= 1) {
      return c.json({ error: "Cannot delete the last admin" }, 400);
    }
  }

  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();

  return c.json({ ok: true });
});

export default users;
