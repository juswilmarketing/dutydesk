import { describe, expect, it } from "vitest";
import { findHistoryCode, type HistoryDb } from "./classification-history";

type Row = Record<string, unknown>;

function fakeDb(rows: { history?: Row[]; learned?: Row[] }): HistoryDb & { queries: string[]; binds: unknown[][] } {
  const queries: string[] = [];
  const binds: unknown[][] = [];
  return {
    queries,
    binds,
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind(...args: unknown[]) {
          binds.push(args);
          return {
            async first<T>() {
              if (sql.includes("supplier_classification_history")) {
                return (rows.history?.find((r) => r.normalized_supplier_name === args[0] && r.normalized_description === args[1]) ?? null) as T | null;
              }
              if (sql.includes("FROM learned")) {
                return (rows.learned?.find((r) => r.normalized_desc === args[0]) ?? null) as T | null;
              }
              return null;
            },
          };
        },
      };
    },
  } as unknown as HistoryDb & { queries: string[]; binds: unknown[][] };
}

describe("findHistoryCode", () => {
  it("prefers approved supplier history over learned pairs", async () => {
    const db = fakeDb({
      history: [{ normalized_supplier_name: "acme", normalized_description: "steel bolts m8", hs_code: "7318.15.00", usage_count: 3 }],
      learned: [{ normalized_desc: "steel bolts m8", tariff_code: "7318.16.00", uses: 2 }],
    });
    await expect(findHistoryCode(db, "ACME Ltd.", "Steel Bolts, M8")).resolves.toEqual({
      code: "7318.15.00",
      source: "supplier_history",
      confirmations: 3,
    });
  });

  it("only reads approved, enabled history rows", async () => {
    const db = fakeDb({});
    await findHistoryCode(db, "Acme", "bolts");
    expect(db.queries[0]).toMatch(/approved_by_clerk\s*=\s*1/);
    expect(db.queries[0]).toMatch(/disabled\s*=\s*0/);
  });

  it("falls back to a learned pair when there is no supplier history", async () => {
    const db = fakeDb({ learned: [{ normalized_desc: "steel bolts m8", tariff_code: "7318.16.00", uses: 2 }] });
    await expect(findHistoryCode(db, "Unknown Co", "Steel Bolts, M8")).resolves.toEqual({
      code: "7318.16.00",
      source: "learned",
      confirmations: 2,
    });
  });

  it("defaults confirmations to 1 when the stored count is missing", async () => {
    const db = fakeDb({
      history: [{ normalized_supplier_name: "acme", normalized_description: "bolts", hs_code: "7318.15.00", usage_count: null }],
      learned: [{ normalized_desc: "nuts", tariff_code: "7318.16.00", uses: null }],
    });
    await expect(findHistoryCode(db, "Acme", "bolts")).resolves.toMatchObject({ confirmations: 1 });
    await expect(findHistoryCode(db, "", "nuts")).resolves.toMatchObject({ confirmations: 1 });
  });

  it("skips the supplier query when there is no supplier", async () => {
    const db = fakeDb({ learned: [{ normalized_desc: "bolts", tariff_code: "7318.16.00", uses: 1 }] });
    await expect(findHistoryCode(db, "", "Bolts")).resolves.toEqual({
      code: "7318.16.00",
      source: "learned",
      confirmations: 1,
    });
    expect(db.queries.some((q) => q.includes("supplier_classification_history"))).toBe(false);
  });

  it("returns null when nothing matches or the description is empty", async () => {
    await expect(findHistoryCode(fakeDb({}), "Acme", "bolts")).resolves.toBeNull();
    await expect(findHistoryCode(fakeDb({}), "Acme", "   ")).resolves.toBeNull();
  });
});
