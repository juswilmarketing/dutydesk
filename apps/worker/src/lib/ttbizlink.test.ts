import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCandidateWithTtbizlink } from "./ttbizlink";

const candidate = {
  code: "6302.60.00",
  description: "Cotton towels",
  chapter: "63",
  dutyRate: 10,
  vatRate: 12.5,
  reason: "Product identity and material match.",
  source: "ai" as const,
};

const emptyCacheDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      run: async () => ({ success: true, meta: {} }),
    }),
  }),
} as unknown as D1Database;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TTBizLink final tariff verification", () => {
  it("uses the local snapshot without an online request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cachedDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            code: "6302.60.00",
            normalized_code: "63026000",
            description: "Cached towel tariff",
            duty_rate: "15%",
            statistical_description: "",
            source: "bundled_snapshot",
            verified_at: null,
            fetched_at: "2026-07-21T00:00:00.000Z",
          }),
          run: async () => ({ success: true, meta: {} }),
        }),
      }),
    } as unknown as D1Database;

    const result = await verifyCandidateWithTtbizlink(cachedDb, candidate);
    expect(result.dutyRate).toBe(15);
    expect(result.officialVerification?.status).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the official description and rate for an exact code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        commodityByCommodityCode: {
          commodityCode: "6302.60.00",
          description: "Toilet linen and kitchen linen, of terry towelling",
          rate: "20%",
        },
      },
    }), { status: 200 })));

    const result = await verifyCandidateWithTtbizlink(emptyCacheDb, candidate);
    expect(result.dutyRate).toBe(20);
    expect(result.description).toContain("terry towelling");
    expect(result.officialVerification?.status).toBe("verified");
  });

  it("marks a code not found without treating it as verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { commodityByCommodityCode: null },
    }), { status: 200 })));

    const result = await verifyCandidateWithTtbizlink(emptyCacheDb, candidate);
    expect(result.officialVerification?.status).toBe("not_found");
  });

  it("keeps the internal candidate when the official service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const result = await verifyCandidateWithTtbizlink(emptyCacheDb, candidate);
    expect(result.dutyRate).toBe(candidate.dutyRate);
    expect(result.officialVerification?.status).toBe("unavailable");
  });
});
