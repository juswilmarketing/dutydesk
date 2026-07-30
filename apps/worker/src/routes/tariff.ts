import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { searchTariff } from "@pas/tariff-data";
import { audit } from "../lib/utils";
import { refreshTtbizlinkCacheBatch } from "../lib/ttbizlink";

const tariff = new Hono<{ Bindings: Env; Variables: AppVariables }>();

tariff.get("/search", async (c) => {
  const q = c.req.query("q") || "";
  const limit = Math.max(1, Math.min(50, parseInt(c.req.query("limit") || "8", 10)));
  if (q.trim().length < 2) return c.json({ results: [], source: "local_ttbizlink_cache" });
  const normalizedCode = q.replace(/[^0-9]/g, "");
  const cached = await c.env.DB.prepare(
    `SELECT code, description AS desc, duty_rate AS duty,
            CASE WHEN normalized_code = ? THEN 100 ELSE 10 END AS score
     FROM ttbizlink_tariffs
     WHERE active = 1
       AND (normalized_code LIKE ? OR lower(description) LIKE ?)
     ORDER BY score DESC, code
     LIMIT ?`,
  ).bind(
    normalizedCode,
    `%${normalizedCode}%`,
    `%${q.toLowerCase().trim()}%`,
    limit,
  ).all<{ code: string; desc: string; duty: string; score: number }>();
  const results = cached.results?.length ? cached.results : searchTariff(q, limit);
  await audit(c, "tariff_search");
  return c.json({ results, source: cached.results?.length ? "local_ttbizlink_cache" : "bundled_snapshot" });
});

tariff.get("/cache-status", async (c) => {
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN source = 'ttbizlink' THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN source <> 'ttbizlink' THEN 1 ELSE 0 END) AS snapshot
     FROM ttbizlink_tariffs WHERE active = 1`,
  ).first<{ total: number; verified: number; snapshot: number }>();
  const latest = await c.env.DB.prepare(
    `SELECT * FROM ttbizlink_sync_runs ORDER BY started_at DESC LIMIT 1`,
  ).first<Record<string, unknown>>();
  return c.json({ ...counts, latestSync: latest || null });
});

tariff.post("/refresh-cache", async (c) => {
  if (c.var.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  const body: { limit?: number } = await c.req.json<{ limit?: number }>().catch(() => ({}));
  const result = await refreshTtbizlinkCacheBatch(c.env.DB, body.limit || 100, c.var.username);
  await audit(c, "ttbizlink_cache_refresh");
  return c.json({ success: true, ...result });
});

export default tariff;
