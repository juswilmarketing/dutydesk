import { describe, expect, it } from "vitest";
import { classifyHierarchically, buildProductClassificationProfile } from "./index";
import { getNationalLine } from "@pas/tariff-data";

describe("US Ophthalmic HVS-1 regression", () => {
  it("vision screener → 9018.50 ophthalmic instruments, not plastics/chemicals", () => {
    const desc = "HVS-1 Vision Screener Huvitz (Serial Numbers: 1HV00025E0018, 1HV00024H0029)";
    const profile = buildProductClassificationProfile(desc, null, { supplier: "US Ophthalmic" });
    expect(profile.pluginId).toBe("medical_instruments");
    expect(profile.canonicalProduct).toMatch(/ophthalmic|vision screener/i);
    expect(profile.likelyChapters).toContain("90");

    const result = classifyHierarchically(desc, null, { supplier: "US Ophthalmic" });
    expect(result.chapters.some((c) => c.chapter === "90")).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].code.startsWith("9018")).toBe(true);
    expect(result.candidates[0].code.startsWith("9018.50") || result.candidates.some((c) => c.code.startsWith("9018.50"))).toBe(true);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
    expect(result.candidates.every((c) => !["39", "38", "34", "63"].includes(c.chapter))).toBe(true);
  });

  it("HVS-1 printer → 8443 printers, not malaria reagents or chapter 90", () => {
    const desc = "HVS-1 Printer - Printer for HVS-1 (Serial Numbers: MHT2502070002, MHT2502070009)";
    const profile = buildProductClassificationProfile(desc, null, { supplier: "US Ophthalmic" });
    expect(profile.pluginId).toBe("printers");
    expect(profile.canonicalProduct).toMatch(/printer/i);

    const result = classifyHierarchically(desc, null, { supplier: "US Ophthalmic" });
    expect(result.chapters.some((c) => c.chapter === "84")).toBe(true);
    expect(result.candidates[0].code.startsWith("8443")).toBe(true);
    expect(result.candidates.every((c) => !c.code.startsWith("3822"))).toBe(true);
    expect(result.candidates.every((c) => !c.code.startsWith("3808"))).toBe(true);
    expect(result.candidates.every((c) => Boolean(getNationalLine(c.code)))).toBe(true);
  });
});
