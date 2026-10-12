import { describe, expect, it } from "vitest";
import { CLASSIFICATION_GOLDENS } from "@pas/product-intelligence";
import { TEST_CASE_ROWS } from "./fixtures/test-cases.generated";
import { caseFromGolden, caseFromRow, formatReport, strongPrecision, STRONG_PRECISION_TARGET } from "./strong-precision";

describe("golden Strong precision gate", () => {
  it(`labels Strong only when right at least ${STRONG_PRECISION_TARGET * 100}% of the time`, () => {
    const cases = [...CLASSIFICATION_GOLDENS.map(caseFromGolden), ...TEST_CASE_ROWS.map(caseFromRow)];
    const report = strongPrecision(cases);
    console.log(formatReport(report));
    expect(report.precision, formatReport(report)).toBeGreaterThanOrEqual(STRONG_PRECISION_TARGET);
  }, 120_000);
});
