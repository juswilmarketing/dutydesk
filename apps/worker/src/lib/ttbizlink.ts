import type { ClassificationRecommendationCandidate } from "@pas/shared-types";

const GRAPHQL_URL = "https://info.ttbizlink.gov.tt/o/graphql";
export const TTBIZLINK_FINDER_URL = "https://info.ttbizlink.gov.tt/hs-code-tariff-finder#/";

type Commodity = {
  commodityCode: string;
  description: string;
  rate: string;
  statisticalDescription?: string;
};

type CachedCommodity = {
  code: string;
  normalized_code: string;
  description: string;
  duty_rate: string;
  statistical_description: string;
  source: string;
  verified_at: string | null;
  fetched_at: string;
};

function normalizeCode(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export async function lookupTtbizlinkCode(code: string): Promise<Commodity | null> {
  const safeCode = String(code || "").replace(/[^0-9.]/g, "");
  if (!safeCode) return null;
  const query = `{
    commodityByCommodityCode(commodityCode: ${JSON.stringify(safeCode)}) {
      commodityCode
      description
      rate
      statisticalDescription
    }
  }`;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DutyDesk/1.0 official-tariff-verification",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`TTBizLink returned ${response.status}`);
  const payload = await response.json<{
    data?: { commodityByCommodityCode?: Commodity | null };
    errors?: Array<{ message?: string }>;
  }>();
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || "TTBizLink lookup failed");
  }
  return payload.data?.commodityByCommodityCode || null;
}

async function readCachedCommodity(db: D1Database, code: string): Promise<CachedCommodity | null> {
  return db.prepare(
    `SELECT code, normalized_code, description, duty_rate, statistical_description,
            source, verified_at, fetched_at
     FROM ttbizlink_tariffs
     WHERE normalized_code = ? AND active = 1`,
  ).bind(normalizeCode(code)).first<CachedCommodity>();
}

async function saveOfficialCommodity(db: D1Database, commodity: Commodity): Promise<void> {
  await db.prepare(
    `INSERT INTO ttbizlink_tariffs
      (code, normalized_code, description, duty_rate, statistical_description,
       source, verified_at, fetched_at, last_error, active)
     VALUES (?, ?, ?, ?, ?, 'ttbizlink', datetime('now'), datetime('now'), NULL, 1)
     ON CONFLICT(code) DO UPDATE SET
       normalized_code = excluded.normalized_code,
       description = excluded.description,
       duty_rate = excluded.duty_rate,
       statistical_description = excluded.statistical_description,
       source = 'ttbizlink',
       verified_at = datetime('now'),
       fetched_at = datetime('now'),
       last_error = NULL,
       active = 1,
       updated_at = datetime('now')`,
  ).bind(
    commodity.commodityCode,
    normalizeCode(commodity.commodityCode),
    commodity.description,
    commodity.rate || "",
    commodity.statisticalDescription || "",
  ).run();
}

function candidateFromCommodity(
  candidate: ClassificationRecommendationCandidate,
  commodity: Pick<Commodity, "commodityCode" | "description" | "rate">,
  status: "verified" | "cached",
  lookedUpAt: string,
): ClassificationRecommendationCandidate {
  const parsedRate = Number.parseFloat(String(commodity.rate || "").replace("%", ""));
  return {
    ...candidate,
    description: commodity.description || candidate.description,
    dutyRate: Number.isFinite(parsedRate) ? parsedRate : candidate.dutyRate,
    officialVerification: {
      source: "ttbizlink",
      status,
      officialDescription: commodity.description,
      officialDutyRate: commodity.rate,
      lookedUpAt,
      url: `${TTBIZLINK_FINDER_URL}commodity/${encodeURIComponent(commodity.commodityCode)}`,
    },
  };
}

export async function verifyCandidateWithTtbizlink(
  db: D1Database,
  candidate: ClassificationRecommendationCandidate,
): Promise<ClassificationRecommendationCandidate> {
  const lookedUpAt = new Date().toISOString();
  const cached = await readCachedCommodity(db, candidate.code);
  if (cached) {
    await db.prepare(
      `UPDATE ttbizlink_tariffs SET lookup_count = lookup_count + 1,
       last_used_at = datetime('now') WHERE code = ?`,
    ).bind(cached.code).run();
    const verifiedAt = cached.verified_at ? Date.parse(cached.verified_at) : Number.NaN;
    const freshOfficial = cached.source === "ttbizlink"
      && Number.isFinite(verifiedAt)
      && Date.now() - verifiedAt < 90 * 24 * 60 * 60 * 1000;
    if (freshOfficial || cached.source !== "ttbizlink") {
      return candidateFromCommodity(
        candidate,
        {
          commodityCode: cached.code,
          description: cached.description,
          rate: cached.duty_rate,
        },
        freshOfficial ? "verified" : "cached",
        cached.verified_at || cached.fetched_at,
      );
    }
  }
  try {
    const commodity = await lookupTtbizlinkCode(candidate.code);
    const exact = commodity
      && normalizeCode(commodity.commodityCode) === normalizeCode(candidate.code);
    if (!commodity || !exact) {
      return {
        ...candidate,
        officialVerification: {
          source: "ttbizlink",
          status: "not_found",
          lookedUpAt,
          url: `${TTBIZLINK_FINDER_URL}search/${encodeURIComponent(candidate.code)}`,
        },
      };
    }
    await saveOfficialCommodity(db, commodity);
    return candidateFromCommodity(candidate, commodity, "verified", lookedUpAt);
  } catch {
    if (cached) {
      return candidateFromCommodity(
        candidate,
        {
          commodityCode: cached.code,
          description: cached.description,
          rate: cached.duty_rate,
        },
        "cached",
        cached.verified_at || cached.fetched_at,
      );
    }
    return {
      ...candidate,
      officialVerification: {
        source: "ttbizlink",
        status: "unavailable",
        lookedUpAt,
        url: `${TTBIZLINK_FINDER_URL}search/${encodeURIComponent(candidate.code)}`,
      },
    };
  }
}

export async function refreshTtbizlinkCacheBatch(
  db: D1Database,
  limit = 100,
  requestedBy = "scheduled",
): Promise<{ attempted: number; verified: number; failed: number }> {
  const inserted = await db.prepare(
    `INSERT INTO ttbizlink_sync_runs (status, requested_by) VALUES ('running', ?)`,
  ).bind(requestedBy).run();
  const runId = Number((inserted.meta as { last_row_id?: number }).last_row_id || 0);
  const rows = await db.prepare(
    `SELECT code FROM ttbizlink_tariffs
     WHERE active = 1
     ORDER BY CASE WHEN verified_at IS NULL THEN 0 ELSE 1 END,
              COALESCE(verified_at, updated_at) ASC
     LIMIT ?`,
  ).bind(Math.max(1, Math.min(250, limit))).all<{ code: string }>();
  let verified = 0;
  let failed = 0;
  const codes = (rows.results || []).map((row) => row.code);
  for (let offset = 0; offset < codes.length; offset += 10) {
    await Promise.all(codes.slice(offset, offset + 10).map(async (code) => {
      try {
        const commodity = await lookupTtbizlinkCode(code);
        if (!commodity || normalizeCode(commodity.commodityCode) !== normalizeCode(code)) {
          failed++;
          await db.prepare(
            `UPDATE ttbizlink_tariffs SET last_error = 'Code not found',
             updated_at = datetime('now') WHERE code = ?`,
          ).bind(code).run();
          return;
        }
        await saveOfficialCommodity(db, commodity);
        verified++;
      } catch (error) {
        failed++;
        await db.prepare(
          `UPDATE ttbizlink_tariffs SET last_error = ?,
           updated_at = datetime('now') WHERE code = ?`,
        ).bind(error instanceof Error ? error.message : "Lookup failed", code).run();
      }
    }));
  }
  await db.prepare(
    `UPDATE ttbizlink_sync_runs SET status = 'completed', rows_attempted = ?,
     rows_verified = ?, rows_failed = ?, completed_at = datetime('now') WHERE id = ?`,
  ).bind(codes.length, verified, failed, runId).run();
  return { attempted: codes.length, verified, failed };
}
