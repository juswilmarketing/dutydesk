import { describe, expect, it } from "vitest";
import {
  buildProductClassificationProfile,
  classifyHierarchically,
  detectInvoiceLineType,
  isNonMerchandiseLine,
  needsSupplierSearch,
  buildSupplierSearchQueries,
  getSupplierProfile,
  isPackagingContainerDescription,
} from "./index";
import { getNationalLine } from "@pas/tariff-data";

describe("packaging / empty container product-noun priority", () => {
  it("Test A — sauce woozy bottle with cocoa consignee is empty glass packaging, not food", () => {
    const desc = "5 oz Sauce Woozy Bottle, Flint, 24-414";
    expect(isPackagingContainerDescription(desc)).toBe(true);

    const profile = buildProductClassificationProfile(desc, null, {
      supplier: "K.G. International, Inc.",
      consignee: "Persad's Cocoa and Chocolate",
    });
    expect(profile.canonicalProduct).toMatch(/empty glass bottle/i);
    expect(profile.productNoun).toBe("bottle");
    expect(profile.industry).toBe("packaging");
    expect(profile.material).toMatch(/glass/i);
    expect(profile.likelyChapters).toContain("70");
    expect(profile.excludedChapters).toEqual(expect.arrayContaining(["18", "20", "21", "22"]));
    expect(profile.technicalSpecifications?.intendedContents).toMatch(/sauce/i);
    expect(profile.technicalSpecifications?.suppliedEmpty).toBe(true);
    expect(Number(profile.knownAttributes.customerIndustryWeight)).toBeLessThanOrEqual(3);

    const result = classifyHierarchically(desc, null, {
      supplier: "K.G. International, Inc.",
      consignee: "Persad's Cocoa and Chocolate",
    });
    expect(result.chapters.some((c) => c.chapter === "70")).toBe(true);
    expect(result.chapters.every((c) => Number(c.chapter) > 24)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].heading.startsWith("7010")).toBe(true);
    expect(result.candidates.every((c) => !["18", "20", "21", "22"].includes(c.chapter))).toBe(true);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
  });

  it("Test B — filled with pepper sauce must not assume empty packaging", () => {
    const desc = "5 oz Woozy Bottle filled with pepper sauce";
    const profile = buildProductClassificationProfile(desc);
    // Must not lock to empty glass packaging
    expect(profile.canonicalProduct).not.toMatch(/^empty glass bottle$/i);
    expect(profile.technicalSpecifications?.suppliedEmpty).not.toBe(true);
  });

  it("Test C — empty glass beverage bottle is packaging, not beverage", () => {
    const result = classifyHierarchically("Empty 12 oz glass beverage bottle");
    expect(result.profile.canonicalProduct).toMatch(/empty glass bottle|glass/i);
    expect(result.profile.industry).toBe("packaging");
    expect(result.chapters.some((c) => c.chapter === "70")).toBe(true);
    expect(result.candidates.every((c) => c.chapter !== "22")).toBe(true);
  });

  it("Test D — plastic sauce bottle empty is plastic packaging, not sauce", () => {
    const result = classifyHierarchically("Plastic sauce bottle, empty");
    expect(result.profile.canonicalProduct).toMatch(/empty plastic bottle/i);
    expect(result.profile.material).toMatch(/plastic/i);
    expect(result.chapters.some((c) => c.chapter === "39")).toBe(true);
    expect(result.candidates.every((c) => !["18", "20", "21"].includes(c.chapter))).toBe(true);
  });

  it("Test E — approved supplier/SKU skips web search", () => {
    expect(
      needsSupplierSearch({
        description: "5 oz Sauce Woozy Bottle",
        sku: "102071",
        hasExactSkuMatch: true,
        profileConfidence: 0.5,
      }),
    ).toBe(false);

    const queries = buildSupplierSearchQueries({
      supplier: "K.G. International, Inc.",
      sku: "102071",
      description: "5 oz Sauce Woozy Bottle Flint 24-414",
    });
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries.some((q) => /102071/.test(q))).toBe(true);
    expect(queries.every((q) => !/Persad|Cocoa/i.test(q))).toBe(true);

    const profile = getSupplierProfile("K.G. International, Inc.");
    expect(profile?.officialDomain).toBe("kgint.com");
    expect(profile?.primaryIndustries).toContain("packaging");
  });
});

describe("non-merchandise delivery / documents", () => {
  it("excludes Delivery Charges and Documents from merchandise", () => {
    expect(isNonMerchandiseLine("Delivery Charges")).toBe(true);
    expect(detectInvoiceLineType("Delivery Charges").lineType).toBe("freight");
    expect(isNonMerchandiseLine("Documents")).toBe(true);
    expect(detectInvoiceLineType("Documents").excludeFromMerchandise).toBe(true);
  });
});
