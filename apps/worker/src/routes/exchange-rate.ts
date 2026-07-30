import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";

const exchangeRate = new Hono<{ Bindings: Env; Variables: AppVariables }>();

exchangeRate.get("/", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT rate, updated_by, updated_at FROM exchange_rate WHERE id = 1",
  ).first<{ rate: number; updated_by: string; updated_at: string }>();
  return c.json(row || { rate: 6.75, updated_by: "System", updated_at: new Date().toISOString() });
});

exchangeRate.put("/", async (c) => {
  const body = await c.req.json<{ rate?: number; updatedBy?: string }>();
  const raw = body.rate;
  if (!(typeof raw === "number") || !Number.isFinite(raw) || raw <= 0) {
    return c.json({ error: "Valid rate required" }, 400);
  }
  const rate = Math.round(raw * 100000) / 100000;
  if (!rate || rate <= 0) return c.json({ error: "Valid rate required" }, 400);
  const updatedBy = body.updatedBy || c.var.name;
  const updatedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO exchange_rate (id, rate, updated_by, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET rate = excluded.rate, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(rate, updatedBy, updatedAt)
    .run();
  await audit(c, "exchange_rate_update");
  return c.json({ rate, updated_by: updatedBy, updated_at: updatedAt });
});

export default exchangeRate;
