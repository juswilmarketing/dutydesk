import { describe, it, expect } from "vitest";
import { calculateTaxes, parseDutyPct, cesFeeFromContainer, formatContainerCesLabel } from "./index";

describe("tax-engine", () => {
  it("parses duty percentages", () => {
    expect(parseDutyPct("15%")).toBe(0.15);
    expect(parseDutyPct("Free")).toBe(0);
    expect(parseDutyPct(null)).toBe(0);
  });

  it("calculates CIF and taxes", () => {
    const result = calculateTaxes(
      [{ id: 1, desc: "Test", tariff_code: "1234.56.78", duty_rate: "10%", qty: 2, price: 50 }],
      { freight: "100", insurance: "0", otherCharges: "0", exchangeRate: "", containerSize: "none", userFee: false, vatExempt: false, combineAll: false },
      6.75,
    );
    expect(result.invoiceTotal).toBe(100);
    expect(result.cifUSD).toBe(200);
    expect(result.cifTTD).toBe(1350);
    expect(result.totalDuty).toBeCloseTo(135);
    expect(result.totalVAT).toBeCloseTo(185.625);
  });

  it("multiplies CES fee by container count", () => {
    expect(cesFeeFromContainer("20ft", 1)).toBe(750);
    expect(cesFeeFromContainer("20ft", 3)).toBe(2250);
    expect(cesFeeFromContainer("40ft", 2)).toBe(2100);
    expect(cesFeeFromContainer("none", 5)).toBe(0);
    expect(formatContainerCesLabel("20ft", 2)).toBe("2 × 20ft");
  });

  it("uses applied VAT and levy rates when provided", () => {
    const result = calculateTaxes(
      [{
        id: 2,
        desc: "Applied recommendation",
        tariff_code: "6302.60.00",
        duty_rate: "10%",
        vat_rate: "15%",
        levy_rate: "2%",
        qty: 1,
        price: 100,
      }],
      { freight: "0", insurance: "0", otherCharges: "0", exchangeRate: "", containerSize: "none", userFee: false, vatExempt: false, combineAll: false },
      1,
    );
    expect(result.totalDuty).toBeCloseTo(10);
    expect(result.totalLevy).toBeCloseTo(2);
    expect(result.totalVAT).toBeCloseTo(16.8);
    expect(result.grandTotal).toBeCloseTo(28.8);
  });
});
