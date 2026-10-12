import { describe, expect, it } from "vitest";
import { historyCodeChanged, historyWording, nextSupplierUsageCount, nextUses } from "./history-confirmations";

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

describe("historyCodeChanged (admin edit)", () => {
  it("is true for a different code", () => {
    expect(historyCodeChanged("7318.15.00", "7318.16.00")).toBe(true);
  });

  it("ignores spaces, dots and case", () => {
    expect(historyCodeChanged("7318.15.00", " 7318 1500 ")).toBe(false);
    expect(historyCodeChanged("ab12.00", "AB1200")).toBe(false);
  });
});

describe("historyWording", () => {
  it("uses approved wording once the code was hand-applied twice", () => {
    expect(historyWording(2)).toEqual({
      reason: "Approved for this item before.",
      warning: "Suggested from approved history for this item.",
    });
  });

  it("is honest about a code applied only once", () => {
    expect(historyWording(1)).toEqual({
      reason: "Applied once before for this item — confirm.",
      warning: "Suggested from a code applied once before for this item.",
    });
  });
});