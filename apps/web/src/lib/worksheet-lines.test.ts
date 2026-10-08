import { describe, expect, it } from "vitest";
import { mergeSourceLines } from "./worksheet-lines";
import type { WorksheetSourceLine } from "@pas/shared-types";

function line( partial: Partial<WorksheetSourceLine> & Pick<WorksheetSourceLine, "id">): WorksheetSourceLine {
  return {
    source_line_number: 1,
    original_description: "Item",
    worksheet_description: "Item",
    hs_code: "4011.90.00",
    duty_rate: "20%",
    vat_rate: "12.5%",
    quantity: 1,
    value: 100,
    duty_amount: 20,
    vat_amount: 15,
    group_id: null,
    reviewed_status: "pending",
    ...partial,
  };
}

describe("mergeSourceLines", () => {
  it("refreshes hs_code and duty_rate when classification changes", () => {
    const existing = [line({ id: 1, hs_code: "4011.90.00", duty_rate: "20%", duty_amount: 20 })];
    const fresh = [line({ id: 1, hs_code: "8708.70.90", duty_rate: "40%", duty_amount: 40 })];
    const merged = mergeSourceLines(existing, fresh);
    expect(merged[0].hs_code).toBe("8708.70.90");
    expect(merged[0].duty_rate).toBe("40%");
    expect(merged[0].duty_amount).toBe(40);
  });

  it("preserves clerk-edited worksheet description", () => {
    const existing = [line({
      id: 1,
      original_description: "275/50R19",
      worksheet_description: "Passenger tyre 275/50R19",
    })];
    const fresh = [line({
      id: 1,
      original_description: "275/50R19",
      worksheet_description: "275/50R19",
      hs_code: "4011.90.00",
      duty_rate: "25%",
    })];
    const merged = mergeSourceLines(existing, fresh);
    expect(merged[0].worksheet_description).toBe("Passenger tyre 275/50R19");
    expect(merged[0].duty_rate).toBe("25%");
  });
});
