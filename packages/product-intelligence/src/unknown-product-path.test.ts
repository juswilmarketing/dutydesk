import { describe, expect, it } from "vitest";
import {
  classifyHierarchically,
  buildProductClassificationProfile,
  matchProductNounLexicon,
} from "./index";

describe("unknown-product path (all items)", () => {
  it("lexicon seeds chapters for common nouns without a family plugin", () => {
    const hit = matchProductNounLexicon("Corrugated packing carton brown");
    expect(hit?.noun).toBe("carton");
    expect(hit?.likelyChapters).toContain("48");

    const profile = buildProductClassificationProfile("Corrugated packing carton brown");
    expect(profile.pluginId).toBeFalsy();
    expect(profile.knownAttributes.lexiconNoun).toBe("carton");
    expect(profile.likelyChapters).toContain("48");
    expect(profile.interpretationConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not invent Strong Match from fixed generic chapters for gibberish SKUs", () => {
    const result = classifyHierarchically("XYZ-99999 PART REF AB12", null, {
      supplier: "Unknown Supplier Co",
    });
    expect(result.recommendationStatus).toMatch(/insufficient|provisional/);
    expect(result.recommendationStatus).not.toBe("strong");
    expect(result.recommendationStatus).not.toBe("likely");
    if (!result.candidates.length) {
      expect(result.criticalQuestion?.id).toBe("product_type");
    }
  });

  it("product_type clarification seeds chapters instead of guessing", () => {
    const profile = buildProductClassificationProfile(
      "SKU-ALPHA-7 COMPONENT",
      { id: "product_type", value: "Medical / scientific instrument" },
    );
    expect(profile.likelyChapters).toContain("90");
    expect(profile.missingCriticalAttributes).not.toContain("product type");
  });

  it("printer lexicon/plugin still ranks chapter 84 without plastics/chemical seeds", () => {
    const result = classifyHierarchically("Label printer for warehouse use");
    expect(result.chapters.some((c) => c.chapter === "84")).toBe(true);
    expect(result.chapters.every((c) => !["39", "63", "34", "38"].includes(c.chapter))).toBe(true);
  });
});
