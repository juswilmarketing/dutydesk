import { describe, expect, it } from "vitest";
import type { ClassificationGolden } from "@pas/product-intelligence";
import {
  caseFromGolden,
  caseFromRow,
  isAcceptable,
  simulateTopPick,
  strongPrecision,
  type PrecisionCase,
  type TestCaseRow,
} from "./strong-precision";

const row = (over: Partial<TestCaseRow> = {}): TestCaseRow => ({
  id: 7,
  raw_description: "LED DRIVER",
  supplier: null,
  expected_chapter: "85",
  expected_heading: "8504",
  expected_tariff: "8504.40.90",
  acceptable_alternatives_json: "[]",
  prohibited_chapters_json: '["20"]',
  source: "clerk_correction",
  ...over,
});

describe("caseFromRow", () => {
  it("accepts only the exact tariff (plus alternatives) when a tariff is given", () => {
    const c = caseFromRow(row({ acceptable_alternatives_json: '["8504.40.10"]' }));
    expect(c).toEqual({
      id: "db-7",
      description: "LED DRIVER",
      supplier: null,
      acceptable: ["85044090", "85044010"],
      prohibitedChapters: ["20"],
    });
  });

  it("falls back to heading, then alternatives, then chapter", () => {
    expect(caseFromRow(row({ expected_tariff: null })).acceptable).toEqual(["8504"]);
    expect(caseFromRow(row({ expected_tariff: null, expected_heading: null, acceptable_alternatives_json: '["8504","8537"]' })).acceptable)
      .toEqual(["8504", "8537"]);
    expect(caseFromRow(row({ expected_tariff: null, expected_heading: null })).acceptable).toEqual(["85"]);
  });

  it("tolerates malformed JSON lists", () => {
    const c = caseFromRow(row({ acceptable_alternatives_json: "nope", prohibited_chapters_json: "nope" }));
    expect(c.acceptable).toEqual(["85044090"]);
    expect(c.prohibitedChapters).toEqual([]);
  });
});

describe("caseFromGolden", () => {
  const golden: ClassificationGolden = {
    id: "fridge",
    description: "REFRIGERATOR",
    expectedProduct: /fridge/,
    expectedFamily: /refrigeration/,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8418",
    prohibitedChapters: ["20"],
    consignee: "X Ltd",
  };

  it("uses the heading prefix when present, else the chapters", () => {
    expect(caseFromGolden(golden)).toEqual({
      id: "golden-fridge",
      description: "REFRIGERATOR",
      clarification: null,
      consignee: "X Ltd",
      acceptable: ["8418"],
      prohibitedChapters: ["20"],
    });
    expect(caseFromGolden({ ...golden, expectedHeadingPrefix: undefined }).acceptable).toEqual(["84"]);
  });
});

describe("isAcceptable", () => {
  const c: PrecisionCase = { id: "x", description: "x", acceptable: ["8504"], prohibitedChapters: ["20"] };
  it("matches by digit prefix", () => {
    expect(isAcceptable("8504.40.90", c)).toBe(true);
    expect(isAcceptable("8536.30.00", c)).toBe(false);
  });
  it("rejects prohibited chapters even when a prefix matches", () => {
    expect(isAcceptable("2002.10.00", { ...c, acceptable: ["20"] })).toBe(false);
  });
});

describe("strongPrecision", () => {
  const cases: PrecisionCase[] = [
    { id: "a", description: "a", acceptable: ["8418"], prohibitedChapters: [] },
    { id: "b", description: "b", acceptable: ["8504"], prohibitedChapters: [] },
    { id: "c", description: "c", acceptable: ["6302"], prohibitedChapters: [] },
  ];
  const picks: Record<string, { code: string | null; label: "Strong Match" | "Likely Match" | null }> = {
    a: { code: "8418.30.00", label: "Strong Match" },
    b: { code: "8536.30.00", label: "Strong Match" },
    c: { code: "6302.60.00", label: "Likely Match" },
  };

  it("counts only Strong picks and lists the wrong ones", () => {
    const r = strongPrecision(cases, (c) => picks[c.id]);
    expect(r).toEqual({
      total: 3,
      strong: 2,
      correct: 1,
      precision: 0.5,
      misses: [{ id: "b", description: "b", code: "8536.30.00", acceptable: ["8504"] }],
    });
  });

  it("treats zero Strong picks as full precision", () => {
    expect(strongPrecision(cases, () => ({ code: null, label: null })).precision).toBe(1);
  });
});

describe("simulateTopPick (real classifier)", () => {
  it("rates an unambiguous appliance Strong in the worst case", () => {
    const pick = simulateTopPick({ id: "f", description: "REFRIGERATOR", acceptable: ["8418"], prohibitedChapters: [] });
    expect(pick.label).toBe("Strong Match");
    expect(pick.code?.startsWith("8418")).toBe(true);
  });

  it("never rates a line that needs a clarifying question Strong", () => {
    const pick = simulateTopPick({ id: "s", description: "STOVE", acceptable: ["85", "73"], prohibitedChapters: [] });
    expect(pick.label).not.toBe("Strong Match");
  });
});
