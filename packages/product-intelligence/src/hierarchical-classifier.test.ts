import { describe, expect, it } from "vitest";
import { buildProductClassificationProfile } from "./classification-profile";
import { classifyHierarchically, constrainAiSelection } from "./hierarchical-classifier";
import { getNationalLine, buildTariffHealthReport, parseTariffCode } from "@pas/tariff-data";

describe("tariff health (phase 1)", () => {
  it("reports a healthy national-line catalogue", () => {
    const report = buildTariffHealthReport();
    expect(report.totalLines).toBe(6101);
    expect(report.validFormatCount).toBe(report.totalLines);
    expect(report.chapterCount).toBeGreaterThan(90);
  });
});

describe("product classification profile", () => {
  it("expands B TOWELS to bath towels in chapter 63", () => {
    const p = buildProductClassificationProfile("B TOWELS");
    expect(p.canonicalProduct).toMatch(/bath towels?/i);
    expect(p.likelyChapters).toContain("63");
    expect(p.excludedChapters).toEqual(expect.arrayContaining(["20", "34"]));
    expect(p.missingCriticalAttributes).toContain("material");
  });

  it("routes paper towels to chapter 48", () => {
    const p = buildProductClassificationProfile("PAPER TOWELS");
    expect(p.likelyChapters).toContain("48");
    expect(p.excludedChapters).toContain("63");
  });

  it("profiles shower caps with material question", () => {
    const p = buildProductClassificationProfile("SHOWER CAPS");
    expect(p.canonicalProduct).toMatch(/shower caps?/i);
    expect(p.likelyChapters.some((c) => ["39", "65", "63"].includes(c))).toBe(true);
    expect(p.missingCriticalAttributes).toContain("material");
  });

  it("profiles Flex-Lag activator as industrial chemical", () => {
    const p = buildProductClassificationProfile("FL-ACT FLEXLAG ACTIVATOR");
    expect(p.productNoun).toMatch(/activator/i);
    expect(p.likelyChapters.some((c) => ["38", "35", "34"].includes(c))).toBe(true);
    expect(p.excludedChapters).toEqual(expect.arrayContaining(["01", "20", "63"]));
  });

  it("profiles metal restorer into chapter 34", () => {
    const p = buildProductClassificationProfile("3M METAL RESTORER AND POLISH");
    expect(p.likelyChapters).toContain("34");
    expect(p.excludedChapters).toEqual(expect.arrayContaining(["20"]));
  });
});

describe("hierarchical classifier golden cases", () => {
  it("TEST A — B TOWELS retrieves chapter 63 candidates and asks material", () => {
    const result = classifyHierarchically("B TOWELS");
    expect(result.chapters.some((c) => c.chapter === "63")).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
    expect(result.candidates.every((c) => !["01", "02", "20", "34", "84"].includes(c.chapter))).toBe(true);
    expect(result.criticalQuestion?.id).toBe("material");
    expect(result.recommendationStatus).toMatch(/provisional|likely|strong/);
  });

  it("TEST B — SHOWER CAPS asks material and returns DB codes", () => {
    const result = classifyHierarchically("SHOWER CAPS");
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
    expect(result.criticalQuestion?.id).toBe("material");
    const after = classifyHierarchically("SHOWER CAPS", { id: "material", value: "Plastic film" });
    expect(after.profile.material.toLowerCase()).toMatch(/plastic/);
    expect(after.candidates.length).toBeGreaterThan(0);
  });

  it("TEST C — FL-ACT FLEXLAG ACTIVATOR stays in chemical chapters", () => {
    const result = classifyHierarchically("FL-ACT FLEXLAG ACTIVATOR");
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
    expect(result.candidates.every((c) => !["20", "63", "64"].includes(c.chapter))).toBe(true);
    expect(result.recommendationStatus).toMatch(/provisional|insufficient|likely/);
    expect(result.criticalQuestion?.id).toMatch(/primary_function|material/);
  });

  it("TEST D — 3M METAL RESTORER AND POLISH prefers chapter 34, rejects food", () => {
    const result = classifyHierarchically("3M METAL RESTORER AND POLISH");
    expect(result.chapters[0]?.chapter).toBe("34");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.chapter !== "20")).toBe(true);
    expect(result.candidates.some((c) => c.chapter === "34")).toBe(true);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
  });

  it("TEST E — invented AI codes are rejected", () => {
    const result = classifyHierarchically("BATH TOWELS");
    const invented = constrainAiSelection("9999.99.99", result.candidates);
    expect(invented).toBeNull();
    if (result.candidates[0]) {
      const ok = constrainAiSelection(result.candidates[0].code, result.candidates);
      expect(ok?.code).toBe(result.candidates[0].code);
    }
  });

  it("never returns a code absent from the tariff database", () => {
    for (const desc of [
      "B TOWELS",
      "SHOWER CAPS",
      "FL-ACT FLEXLAG ACTIVATOR",
      "3M METAL RESTORER AND POLISH",
      "LADIES SANDALS",
      "LED DRIVER",
    ]) {
      const result = classifyHierarchically(desc);
      for (const c of result.candidates) {
        expect(getNationalLine(c.code)).toBeTruthy();
        expect(parseTariffCode(c.code).validFormat).toBe(true);
      }
    }
  });
});

describe("heading routing narrowed by description facts", () => {
  it("routes canned/diced tomatoes to chapter 20 and never to fresh 0702", () => {
    const r = classifyHierarchically("Diced tomatoes canned");
    expect(r.profile.likelyChapters).toEqual(["20"]);
    expect(r.profile.likelyHeadings).toEqual(["2002"]);
    expect(r.candidates.every((c) => c.heading === "2002")).toBe(true);
  });

  it("routes fresh tomatoes to chapter 07", () => {
    const r = classifyHierarchically("Fresh tomatoes");
    expect(r.profile.likelyChapters).toEqual(["07"]);
    expect(r.profile.likelyHeadings).toEqual(["0702"]);
    expect(r.candidates.every((c) => c.heading === "0702")).toBe(true);
  });

  it("keeps tomato ketchup on the sauces chapter", () => {
    const r = classifyHierarchically("Tomato ketchup");
    expect(r.profile.likelyChapters).toContain("21");
  });

  it("routes LED drivers to static converters (8504), never switching apparatus (8536)", () => {
    const r = classifyHierarchically("LED driver 24V");
    expect(r.profile.likelyHeadings).toEqual(["8504"]);
    expect(r.candidates.some((c) => c.heading === "8536")).toBe(false);
  });

  it("keeps voltage protectors on switching/protecting apparatus (8535/8536)", () => {
    const r = classifyHierarchically("VOLTAGE PROTECTOR");
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => ["8535", "8536"].includes(c.heading))).toBe(true);
  });

  it("routes plastic shower caps to 3926, not textile headgear 6505", () => {
    const r = classifyHierarchically("PLASTIC SHOWER CAPS");
    expect(r.profile.likelyChapters).toEqual(["39"]);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.heading === "3926")).toBe(true);
  });

  it("keeps non-plastic shower caps on textile headings", () => {
    const r = classifyHierarchically("NONWOVEN SHOWER CAPS");
    expect(r.profile.likelyChapters).toEqual(expect.arrayContaining(["63", "65"]));
  });
});

describe("narrowing is scoped to the product it was written for", () => {
  it("does not route fresh edible mushrooms to fresh tomatoes (0702)", () => {
    const r = classifyHierarchically("Fresh edible mushrooms");
    expect(r.profile.likelyHeadings).not.toEqual(["0702"]);
    expect(r.candidates.some((c) => c.heading === "0702")).toBe(false);
  });

  it("does not hard-gate non-tomato food preparations to 2002", () => {
    const r = classifyHierarchically("Food preparation for infants");
    expect(r.profile.likelyHeadings).not.toEqual(["2002"]);
    expect(r.profile.likelyChapters).toEqual(expect.arrayContaining(["20", "21"]));
  });

  it("does not hard-gate edible coconut oil to 2002", () => {
    const r = classifyHierarchically("Edible coconut oil");
    expect(r.profile.likelyHeadings).not.toEqual(["2002"]);
  });

  it("keeps hair nets (6505, any material) eligible even when plastic", () => {
    const r = classifyHierarchically("Hair nets plastic");
    expect(r.profile.likelyChapters).toContain("65");
    expect(r.profile.likelyHeadings).toContain("6505");
  });
});
