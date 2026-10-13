import { describe, expect, it } from "vitest";
import {
  invoiceLineIdentity,
  lineIdentitiesConflict,
  supplierEvidenceConflictsWithDescription,
} from "./description-supplier-precedence";
import { matchProductNounLexicon } from "./product-noun-lexicon";

describe("supplierEvidenceConflictsWithDescription", () => {
  it("conflicts when invoice says pants but supplier label is footwear", () => {
    const lex = matchProductNounLexicon("1901 SOLID SLIM POLY RAYON PANTS");
    const line = invoiceLineIdentity({ common: null, plugin: null, rule: null, lexicon: lex });
    expect(
      supplierEvidenceConflictsWithDescription(
        "1901 SOLID SLIM POLY RAYON PANTS",
        line,
        "footwear",
      ),
    ).toBe(true);
  });

  it("conflicts when invoice says drill but supplier label is footwear", () => {
    const lex = matchProductNounLexicon("DEWALT CORDLESS DRILL 18V");
    const line = invoiceLineIdentity({ common: null, plugin: null, rule: null, lexicon: lex });
    expect(
      supplierEvidenceConflictsWithDescription(
        "DEWALT CORDLESS DRILL 18V",
        line,
        "footwear",
      ),
    ).toBe(true);
  });

  it("does not conflict when supplier label matches the same family", () => {
    const lex = matchProductNounLexicon("MENS COTTON T-SHIRT SIZE L");
    const line = invoiceLineIdentity({ common: null, plugin: null, rule: null, lexicon: lex });
    expect(
      supplierEvidenceConflictsWithDescription(
        "MENS COTTON T-SHIRT SIZE L",
        line,
        "apparel",
      ),
    ).toBe(false);
  });

  it("does not conflict when the invoice line has no confident identity", () => {
    expect(
      supplierEvidenceConflictsWithDescription("MISC PART REF 9912", null, "footwear"),
    ).toBe(false);
  });

  it("does not conflict when the supplier label text appears on the invoice", () => {
    const lex = matchProductNounLexicon("LEATHER SANDAL SIZE 9");
    const line = invoiceLineIdentity({ common: null, plugin: null, rule: null, lexicon: lex });
    expect(
      supplierEvidenceConflictsWithDescription("LEATHER SANDAL SIZE 9", line, "leather sandal"),
    ).toBe(false);
  });
});

describe("lineIdentitiesConflict", () => {
  it("detects chapter mismatch between chemical and apparel", () => {
    expect(
      lineIdentitiesConflict(
        {
          family: "apparel",
          industry: "apparel",
          canonical: "pants",
          noun: "pants",
          likelyChapters: ["61", "62"],
          confidence: 0.9,
        },
        {
          family: "cleaning preparations",
          industry: "chemicals",
          canonical: "cleaning preparation",
          noun: "cleaner",
          likelyChapters: ["34"],
          confidence: 0.8,
        },
      ),
    ).toBe(true);
  });
});
