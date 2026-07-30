import { describe, expect, it } from "vitest";
import { parseEvidenceDescription } from "@pas/product-intelligence";

describe("evidence product description parser", () => {
  it("separates a supplier code, product line and product word", () => {
    const parsed = parseEvidenceDescription("FL-ACT FLEXLAG ACTIVATOR");
    expect(parsed.possibleProductCode).toBe("FL-ACT");
    expect(parsed.possibleBrand).toBe("Flex-Lag");
    expect(parsed.possibleManufacturer).toBe("Flexco");
    expect(parsed.productWords).toEqual(["Activator"]);
    expect(parsed.unresolvedTokens).toEqual([]);
  });

  it("uses safe colour abbreviations but leaves ambiguous SP unresolved", () => {
    const parsed = parseEvidenceDescription("SP CAP WHT");
    expect(parsed.possibleProductCode).toBe("");
    expect(parsed.productWords).toEqual(["Cap"]);
    expect(parsed.attributes.colour).toBe("WHITE");
    expect(parsed.unresolvedTokens).toEqual(["SP"]);
  });

  it("preserves product codes, fractional dimensions and colour attributes", () => {
    const parsed = parseEvidenceDescription("PM922-754 1/16 EURO GOLD BLACK");
    expect(parsed.possibleProductCode).toBe("PM922-754");
    expect(parsed.attributes.dimensions).toBe("1/16");
    expect(parsed.attributes.colour).toBe("GOLD/BLACK");
    expect(parsed.unresolvedTokens).toEqual(["EURO"]);
  });

  it("does not infer a product identity from a vague code", () => {
    const parsed = parseEvidenceDescription("PM922-754");
    expect(parsed.possibleProductCode).toBe("PM922-754");
    expect(parsed.productWords).toEqual([]);
    expect(parsed.coreDescription).toBe("");
  });

  it("normalizes common product abbreviations without resolving ambiguous ACT alone", () => {
    expect(parseEvidenceDescription("KIT ASSY").productWords).toEqual(["Kit", "Assembly"]);
    expect(parseEvidenceDescription("ACT").unresolvedTokens).toEqual(["ACT"]);
    expect(parseEvidenceDescription("RUBBER ACT").productWords).toContain("Activator");
  });
});
