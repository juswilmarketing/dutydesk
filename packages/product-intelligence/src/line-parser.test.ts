import { describe, expect, it } from "vitest";
import { parseInvoiceLineDescription } from "./line-parser";
import { splitSkuVariant, identifiersMatch } from "./sku-normalize";
import { resolveProductIdentity } from "./identity-resolver";
import { extractAttributes } from "./attribute-extract";
import { detectProductDomain } from "./domain";
import { matchProduct, loadSeedDictionaries } from "./dictionaries";
import { normalizeKey } from "./normalize";
import { buildPrediction } from "./predict";
import { buildProductProfile } from "./profile-builder";

describe("line-parser PRINTMARK example", () => {
  const raw = `PRINTMARK 1/16" Euro Gold/Black PM922-754, QTR 12"x24" (PM922754-QTR)`;

  it("parses structured fields without inventing product type", () => {
    const p = parseInvoiceLineDescription(raw);
    expect(p.brandOrProductFamily).toBe("PRINTMARK");
    expect(p.thickness).toMatch(/1\/16/);
    expect(p.styleOrFinish).toMatch(/Gold\/Black/i);
    expect(p.colour).toEqual(expect.arrayContaining(["Gold", "Black"]));
    expect(p.partNumber).toMatch(/PM922/);
    expect(p.sku).toBe("PM922754-QTR");
    expect(p.variant).toBe("QTR");
    expect(p.dimensions?.width).toBe(12);
    expect(p.dimensions?.length).toBe(24);
    expect(p.productType).toBeNull();
    expect(p.identityStatus).toBe("unresolved");
  });

  it("blocks classification until identity resolved", () => {
    const r = resolveProductIdentity({ description: raw });
    expect(r.blockClassification).toBe(true);
    expect(r.suggestedHsCode).toBeNull();
    expect(r.parsed.suggestedQuestions.some((q) => q.field === "product_type")).toBe(true);
  });
});

describe("sku-normalize", () => {
  it("splits variant suffix", () => {
    const s = splitSkuVariant("PM922754-QTR");
    expect(s.basePartNumber).toBe("PM922754");
    expect(s.variantSuffix).toBe("QTR");
    expect(s.normalizedSku).toBe("PM922754QTR");
  });

  it("matches identifier variants", () => {
    expect(identifiersMatch("PM922-754", "PM922754")).toBe(true);
    expect(identifiersMatch("PM922 754", "PM-922-754")).toBe(true);
  });
});

describe("tire rack identity regressions", () => {
  it("parses TIRE RACK as a storage rack, not a tyre", () => {
    const p = parseInvoiceLineDescription("TIRE RACK");
    expect(p.productType).toBe("Storage Rack");
    expect(p.brandOrProductFamily).toBeNull();
    expect(p.identityStatus).not.toBe("unresolved");
  });

  it("does not treat tire rack as a vehicle article", () => {
    const attrs = extractAttributes("TIRE RACK");
    expect(attrs.flags.vehicle).toBe(false);
    expect(attrs.productType).toMatch(/rack|shelving/i);
  });

  it("domain opens furniture/metal chapters, not vehicles-only", () => {
    const signal = detectProductDomain("TIRE RACK", {
      productType: "Storage Rack",
      normalizedName: "Storage Rack · tire",
    });
    expect(signal.domain).toBe("furniture_misc");
    expect(signal.likelyChapters).toEqual(expect.arrayContaining(["94", "73"]));
    expect(signal.likelyChapters).not.toContain("87");
    expect(signal.excludedChapters).toEqual(expect.arrayContaining(["40", "87"]));
  });

  it("dictionary prefers Storage Rack over Tyre for tire rack", () => {
    const dicts = loadSeedDictionaries();
    const hit = matchProduct(normalizeKey("tire rack"), dicts.products);
    expect(hit?.canonical_name).toBe("Storage Rack");
    expect(hit?.typical_chapter).toBe("94");
  });

  it("prediction does not dump arbitrary chapter 40/87 headings for tire rack", () => {
    const dicts = loadSeedDictionaries();
    const { profile, dictionaryHit, brandHit } = buildProductProfile({
      description: "TIRE RACK",
      dictionaries: dicts,
    });
    const prediction = buildPrediction(profile, dicts.chapterRules, dictionaryHit, brandHit);
    expect(prediction.domain).toBe("furniture_misc");
    for (const h of prediction.headings) {
      const ch = h.hs_code.replace(/\D/g, "").slice(0, 2);
      expect(["40", "87"]).not.toContain(ch);
    }
  });
});
