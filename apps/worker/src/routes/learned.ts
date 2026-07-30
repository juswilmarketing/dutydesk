import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";
import { normalizeDesc } from "@pas/tariff-data";

const learned = new Hono<{ Bindings: Env; Variables: AppVariables }>();

learned.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT normalized_desc, tariff_code, duty_rate, category, uses, learned_at, updated_by FROM learned ORDER BY uses DESC",
  ).all<{
    normalized_desc: string;
    tariff_code: string;
    duty_rate: string;
    category: string;
    uses: number;
    learned_at: string;
    updated_by: string;
  }>();
  return c.json({ entries: rows.results || [] });
});

learned.post("/", async (c) => {
  const body = await c.req.json<{
    desc?: string;
    tariff_code?: string;
    duty_rate?: string;
    category?: string;
  }>();
  const norm = normalizeDesc(body.desc || "");
  if (!norm || !body.tariff_code) return c.json({ error: "desc and tariff_code required" }, 400);

  const existing = await c.env.DB.prepare("SELECT uses FROM learned WHERE normalized_desc = ?")
    .bind(norm)
    .first<{ uses: number }>();

  const uses = (existing?.uses || 0) + 1;
  await c.env.DB.prepare(
    `INSERT INTO learned (normalized_desc, tariff_code, duty_rate, category, uses, learned_at, updated_by)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(normalized_desc) DO UPDATE SET
       tariff_code = excluded.tariff_code,
       duty_rate = excluded.duty_rate,
       category = excluded.category,
       uses = excluded.uses,
       learned_at = excluded.learned_at,
       updated_by = excluded.updated_by`,
  )
    .bind(norm, body.tariff_code, body.duty_rate || "", body.category || "", uses, c.var.name)
    .run();

  await audit(c, "learned_save");
  return c.json({ ok: true });
});

learned.delete("/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  await c.env.DB.prepare("DELETE FROM learned WHERE normalized_desc = ?").bind(key).run();
  await audit(c, "learned_delete");
  return c.json({ ok: true });
});

learned.delete("/", async (c) => {
  await c.env.DB.prepare("DELETE FROM learned").run();
  await audit(c, "learned_clear_all");
  return c.json({ ok: true });
});

export default learned;
