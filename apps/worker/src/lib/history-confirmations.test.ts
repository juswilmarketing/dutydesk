import { describe, expect, it } from "vitest";
import { nextSupplierUsageCount, nextUses } from "./history-confirmations";

describe("nextUses (learned)", () => {
  it("starts a new row at 1", () => {
    expect(nextUses(null, "6109.10.10")).toBe(1);
  });

  it("increments when the same code is applied again", () => {
    expect(nextUses({ tariff_code: "6109.10.10", uses: 1 }, "6109.10.10")).toBe(2);
  });

  it("compares codes ignoring spaces, dots and case", () => {
    expect(nextUses({ tariff_code: "6109.10.10", uses: 2 }, " 6109 1010 ")).toBe(3);
    expect(nextUses({ tariff_code: "ab12.00", uses: 1 }, "AB1200")).toBe(2);
  });

  it("resets to 1 when a different code is applied", () => {
    expect(nextUses({ tariff_code: "6109.10.10", uses: 5 }, "6205.20.00")).toBe(1);
  });

  it("treats a missing stored count as 0", () => {
    expect(nextUses({ tariff_code: "6109.10.10", uses: null }, "6109.10.10")).toBe(1);
  });
});

describe("nextSupplierUsageCount (supplier history)", () => {
  it("increments when the same hs_code is applied again", () => {
    expect(nextSupplierUsageCount({ hs_code: "7318.15.00", usage_count: 1 }, "7318.15.00")).toBe(2);
  });

  it("compares codes ignoring spaces, dots and case", () => {
    expect(nextSupplierUsageCount({ hs_code: "7318.15.00", usage_count: 3 }, "7318 1500")).toBe(4);
  });

  it("resets to 1 when the hs_code changes", () => {
    expect(nextSupplierUsageCount({ hs_code: "7318.15.00", usage_count: 4 }, "7318.16.00")).toBe(1);
  });
});
