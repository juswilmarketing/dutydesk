import { describe, expect, it } from "vitest";
import { extractAttributes } from "./attribute-extract";
import { buildProductClassificationProfile } from "./classification-profile";
import { classifyHierarchically } from "./hierarchical-classifier";
import { buildProductProfile } from "./profile-builder";
import { loadSeedDictionaries } from "./dictionaries";

describe("poly rayon pants description", () => {
  const desc = "1901 SOLID SLIM POLY RAYON PANTS";
  const dicts = loadSeedDictionaries();

  it("must not classify as footwear from upload-time attribute extraction", () => {
    const attrs = extractAttributes(desc);
    expect(attrs.flags.footwear).toBe(false);
    expect(attrs.flags.textile).toBe(true);
    const { profile } = buildProductProfile({ description: desc, dictionaries: dicts });
    expect(profile.footwear).toBe(false);
    expect(String(profile.productType || "").toLowerCase()).not.toBe("footwear");
  });

  it("must not classify as footwear from hierarchical profile", () => {
    const p = buildProductClassificationProfile(desc);
    const h = classifyHierarchically(desc);
    expect(p.canonicalProduct.toLowerCase()).not.toBe("footwear");
    expect(h.profile.canonicalProduct.toLowerCase()).not.toBe("footwear");
    expect(h.profile.productFamily).not.toBe("footwear");
  });

  it("recognizes pants/trousers as apparel for retrieval", () => {
    const p = buildProductClassificationProfile(desc);
    expect(p.productNoun).toBe("pants");
    expect(p.likelyChapters).toEqual(expect.arrayContaining(["61", "62"]));
    expect(p.primaryFunction).toBe("clothing");
    expect(p.sku).toBe("");
  });

  it("ignores conflicting supplier footwear label when the line says pants", () => {
    const p = buildProductClassificationProfile(desc, null, {
      productEvidence: {
        canonicalProduct: "footwear",
        primaryFunction: "wear on feet",
      },
    });
    expect(p.productNoun).toBe("pants");
    expect(p.canonicalProduct.toLowerCase()).not.toBe("footwear");
    expect(p.primaryFunction).toBe("clothing");
    const h = classifyHierarchically(desc, null, {
      productEvidence: { canonicalProduct: "footwear", primaryFunction: "wear on feet" },
    });
    expect(h.profile.productNoun).toBe("pants");
    expect(h.warnings.some((w) => /ignored supplier/i.test(w))).toBe(true);
  });
});
