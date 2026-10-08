import { describe, expect, it } from "vitest";
import { detectInvoiceLineType, isNonMerchandiseLine } from "./line-type";
import { groupInvoiceRows } from "./line-grouping";
import { buildProductClassificationProfile } from "./classification-profile";
import { classifyHierarchically } from "./hierarchical-classifier";
import { getNationalLine } from "@pas/tariff-data";

describe("line-type detection", () => {
  it("CASE 8 — FUEL SURCHARGE is surcharge, not merchandise", () => {
    const t = detectInvoiceLineType("FUEL SURCHARGE");
    expect(t.lineType).toBe("surcharge");
    expect(t.excludeFromMerchandise).toBe(true);
    expect(isNonMerchandiseLine("DF")).toBe(true);
    expect(isNonMerchandiseLine("VISA PAYMENT")).toBe(true);
    expect(isNonMerchandiseLine("INVOICE TOTAL")).toBe(true);
    expect(isNonMerchandiseLine("FREIGHT CHARGE")).toBe(true);
  });
});

describe("multiline grouping", () => {
  it("merges tyre continuation rows into one merchandise item", () => {
    const result = groupInvoiceRows([
      { description: "PART NUMBER:" },
      { description: "75VR9ASASXLN0" },
      { description: "012058" },
      { description: "DESCRIPTION:" },
      { description: "275/50R19 BS ALNZ SPT AS", qty: 2, unitPrice: 317.02, lineTotal: 634.04 },
      { description: "012058 112V XL" },
      { description: "Poland" },
      { description: "Rim Width Range 7.50 to 9.50" },
      { description: "FUEL SURCHARGE", qty: 1, unitPrice: 12, lineTotal: 12 },
    ]);
    expect(result.merchandise.length).toBeGreaterThanOrEqual(1);
    const tyre = result.merchandise.find((m) => /275\/50R19/i.test(m.rawDescription));
    expect(tyre).toBeTruthy();
    expect(tyre!.quantity).toBe(2);
    expect(
      tyre!.countryOfOrigin.toLowerCase() === "poland"
      || String(tyre!.specifications.countryOfOrigin || "").toLowerCase() === "poland"
      || /poland/i.test(tyre!.rawDescription),
    ).toBe(true);
    expect(result.charges.some((c) => /fuel|surcharge/i.test(c.description))).toBe(true);
    expect(result.merchandise.every((m) => !/^poland$/i.test(m.rawDescription))).toBe(true);
  });
});

describe("July 29 PAS Cargo regression cases", () => {
  it("CASE 1 — passenger tyre → chapter 40 / heading 4011", () => {
    const result = classifyHierarchically("275/50R19 BS ALNZ SPT AS 112V XL", null, {
      supplier: "Tire Rack",
    });
    expect(result.profile.canonicalProduct).toMatch(/pneumatic|tyre|tire/i);
    expect(result.chapters.some((c) => c.chapter === "40")).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].heading.startsWith("4011")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("4011"))).toBe(true);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
    expect(result.candidates.every((c) => !["87", "84", "63"].includes(c.chapter))).toBe(true);
    expect(result.candidates.every((c) => !c.heading.startsWith("4016"))).toBe(true);
  });

  it("CASE 2 — second tyre size also 4011", () => {
    const result = classifyHierarchically("245/45R20 BS TURANZA EV 103W XL");
    expect(result.candidates[0]?.heading.startsWith("4011")).toBe(true);
  });

  it("CASE 3 — VOSSO wheel → 8708.70", () => {
    const result = classifyHierarchically("VOSSO 20X9 5X120 74 BD 35MM");
    expect(result.profile.canonicalProduct).toMatch(/wheel|rim/i);
    expect(result.chapters.some((c) => c.chapter === "87")).toBe(true);
    expect(result.candidates.some((c) => c.code.startsWith("8708.70"))).toBe(true);
    expect(result.candidates.every((c) => !c.heading.startsWith("4011"))).toBe(true);
  });

  it("CASE 4 — hub ring set stays automotive, may ask material", () => {
    const result = classifyHierarchically("HUB RING SET 74 OD-64.10 ID (4PK)");
    expect(result.profile.canonicalProduct).toMatch(/hub/i);
    expect(result.profile.industry).toBe("automotive");
    expect(result.candidates.every((c) => !/bearing|jewellery|jewelry/i.test(c.description))).toBe(true);
    expect(result.criticalQuestion?.id === "material" || result.candidates.length > 0).toBe(true);
  });

  it("CASE 5 — lug nut kit compares 7318 / vehicle parts, provisional", () => {
    const result = classifyHierarchically("5LUG 14-1.50 SPLN WIK PASS BLK GOR");
    expect(result.profile.canonicalProduct).toMatch(/lug/i);
    expect(result.recommendationStatus).toMatch(/provisional|likely|insufficient/);
    const families = result.candidates.map((c) => c.heading.slice(0, 4));
    expect(families.some((h) => h === "7318" || h === "8708") || result.chapters.some((c) => ["73", "87"].includes(c.chapter))).toBe(true);
  });

  it("CASE 6 — smart wall switch → 8536.50", () => {
    const result = classifyHierarchically(
      "2.4GHz WiFi Smart Wall Touch Light Switch, 3 Gang",
    );
    expect(result.profile.primaryFunction).toMatch(/switching/i);
    expect(result.chapters.some((c) => c.chapter === "85")).toBe(true);
    expect(result.candidates.some((c) => c.code.startsWith("8536.50"))).toBe(true);
    expect(result.candidates.every((c) => !c.code.startsWith("8517"))).toBe(true);
    expect(result.candidates.every((c) => !c.code.startsWith("9405"))).toBe(true);
    expect(result.candidates.every((c) => !c.code.startsWith("7013"))).toBe(true);
  });

  it("CASE 7 — 1 gang switch same heading family", () => {
    const three = classifyHierarchically("2.4GHz WiFi Smart Wall Touch Light Switch, 3 Gang");
    const one = classifyHierarchically("2.4GHz WiFi Smart Wall Touch Light Switch, 1 Gang");
    expect(one.candidates[0]?.heading.slice(0, 4)).toBe(three.candidates[0]?.heading.slice(0, 4));
  });

  it("CASE 8 classification path returns no candidates for fuel surcharge", () => {
    const result = classifyHierarchically("FUEL SURCHARGE");
    expect(result.profile.nonMerchandise).toBe(true);
    expect(result.candidates).toEqual([]);
  });
});

describe("cross-category regressions still hold", () => {
  it("bath towels remain chapter 63", () => {
    const p = buildProductClassificationProfile("B TOWELS");
    expect(p.likelyChapters).toContain("63");
  });

  it("metal restorer remains chapter 34", () => {
    const p = buildProductClassificationProfile("3M METAL RESTORER AND POLISH");
    expect(p.likelyChapters).toContain("34");
  });
});
