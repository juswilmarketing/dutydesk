import { describe, expect, it } from "vitest";
import {
  resolveCommonProduct,
  buildProductClassificationProfile,
  classifyHierarchically,
} from "./index";

describe("resolveCommonProduct fast path", () => {
  it("REFRIGERATOR → refrigeration / 8418", () => {
    const hit = resolveCommonProduct("REFRIGERATOR");
    expect(hit?.fastPath).toBe(true);
    expect(hit?.canonicalProduct).toBe("refrigerator");
    expect(hit?.productFamily).toBe("refrigeration equipment");
    expect(hit?.likelyChapters).toEqual(["84"]);
    expect(hit?.likelyHeadings).toContain("8418");
    expect(hit?.hardHeadingGate).toBe(true);
    expect(hit?.productFamilyConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it("CHEST FREEZER → 8418", () => {
    const hit = resolveCommonProduct("CHEST FREEZER 200L");
    expect(hit?.productFamily).toBe("refrigeration equipment");
    expect(hit?.preferredHeadings).toContain("8418");
  });

  it("ELECTRIC STOVE → chapter 85 / 8516", () => {
    const hit = resolveCommonProduct("ELECTRIC STOVE");
    expect(hit?.productFamily).toBe("cooking appliance");
    expect(hit?.likelyChapters).toContain("85");
    expect(hit?.preferredHeadings).toContain("8516");
    expect(hit?.hardHeadingGate).toBe(true);
    expect(hit?.missingCriticalAttributes).not.toContain("energy source");
  });

  it("GAS STOVE → chapter 73 / 7321", () => {
    const hit = resolveCommonProduct("GAS STOVE");
    expect(hit?.likelyChapters).toContain("73");
    expect(hit?.preferredHeadings).toContain("7321");
    expect(hit?.hardHeadingGate).toBe(true);
  });

  it("plain STOVE asks energy source", () => {
    const hit = resolveCommonProduct("STOVE");
    expect(hit?.missingCriticalAttributes).toContain("energy source");
    expect(hit?.hardHeadingGate).toBe(false);
  });

  it("MICROWAVE OVEN → 8516", () => {
    const hit = resolveCommonProduct("MICROWAVE OVEN");
    expect(hit?.productFamily).toBe("microwave cooking appliance");
    expect(hit?.likelyChapters).toEqual(["85"]);
    expect(hit?.preferredHeadings).toContain("8516");
  });

  it("WASHING MACHINE → 8450", () => {
    const hit = resolveCommonProduct("WASHING MACHINE");
    expect(hit?.likelyChapters).toEqual(["84"]);
    expect(hit?.preferredHeadings).toContain("8450");
  });

  it("AIR CONDITIONER → 8415", () => {
    const hit = resolveCommonProduct("SPLIT AC UNIT");
    expect(hit?.productFamily).toBe("air conditioning equipment");
    expect(hit?.preferredHeadings).toContain("8415");
  });

  it("SMART TV → 8528", () => {
    const hit = resolveCommonProduct("SMART TV 55 INCH");
    expect(hit?.productFamily).toBe("television equipment");
    expect(hit?.likelyChapters).toEqual(["85"]);
    expect(hit?.preferredHeadings).toContain("8528");
  });
});

describe("common product hierarchical classification", () => {
  it("refrigerator retrieves only chapter 84 / 8418 candidates", () => {
    const profile = buildProductClassificationProfile("REFRIGERATOR", null, {
      consignee: "Persad Cocoa Foods Ltd",
    });
    expect(profile.knownAttributes.commonProductFastPath).toBe(true);
    expect(profile.productFamily.toLowerCase()).toMatch(/refrigeration/);
    expect(profile.likelyChapters).toContain("84");
    expect(profile.preferredHeadings).toContain("8418");
    // Consignee food industry must not override product noun
    expect(profile.industry).toBe("appliances");

    const result = classifyHierarchically("REFRIGERATOR", null, {
      consignee: "Persad Cocoa Foods Ltd",
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.chapter === "84")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("8418"))).toBe(true);
    expect(result.candidates.every((c) => !["39", "94", "87", "20"].includes(c.chapter))).toBe(true);
    expect(["strong", "likely", "provisional"]).toContain(result.recommendationStatus);
  });

  it("chest freezer stays under 8418", () => {
    const result = classifyHierarchically("CHEST FREEZER");
    expect(result.profile.productFamily.toLowerCase()).toMatch(/refrigeration/);
    expect(result.candidates.every((c) => c.heading.startsWith("8418"))).toBe(true);
  });

  it("electric stove → 85 family, not food/textile", () => {
    const result = classifyHierarchically("ELECTRIC STOVE");
    expect(result.profile.productFamily.toLowerCase()).toMatch(/cooking/);
    expect(result.chapters.every((c) => c.chapter === "85")).toBe(true);
    expect(result.candidates.every((c) => c.chapter === "85")).toBe(true);
    expect(result.candidates.every((c) => !["20", "63", "87", "94"].includes(c.chapter))).toBe(true);
  });

  it("gas stove → 73 family", () => {
    const result = classifyHierarchically("GAS COOKER");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.chapter === "73")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("7321"))).toBe(true);
  });

  it("stove without energy asks What powers this stove?", () => {
    const result = classifyHierarchically("STOVE");
    expect(result.criticalQuestion?.id).toBe("energy_source");
    expect(result.criticalQuestion?.options).toContain("Electric");
    expect(result.criticalQuestion?.options).toContain("Gas");
    expect(result.recommendationStatus).toBe("provisional");
  });

  it("stove energy clarification routes electric", () => {
    const result = classifyHierarchically("STOVE", {
      id: "energy_source",
      value: "Electric",
    });
    expect(result.profile.missingCriticalAttributes).not.toContain("energy source");
    expect(result.candidates.every((c) => c.chapter === "85")).toBe(true);
  });

  it("microwave oven → 8516, not refrigeration", () => {
    const result = classifyHierarchically("MICROWAVE OVEN");
    expect(result.profile.productFamily.toLowerCase()).toMatch(/microwave/);
    expect(result.candidates.every((c) => c.chapter === "85")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("8516"))).toBe(true);
  });

  it("washing machine → 8450", () => {
    const result = classifyHierarchically("WASHING MACHINE 8KG");
    expect(result.candidates.every((c) => c.chapter === "84")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("8450"))).toBe(true);
  });

  it("air conditioner → 8415 not 8418", () => {
    const result = classifyHierarchically("AIR CONDITIONER");
    expect(result.profile.productFamily.toLowerCase()).toMatch(/air conditioning/);
    expect(result.candidates.every((c) => c.heading.startsWith("8415"))).toBe(true);
  });

  it("smart TV → 8528", () => {
    const result = classifyHierarchically("SMART TV");
    expect(result.profile.productFamily.toLowerCase()).toMatch(/television|display/);
    expect(result.candidates.every((c) => c.chapter === "85")).toBe(true);
    expect(result.candidates.every((c) => c.heading.startsWith("8528"))).toBe(true);
  });
});
