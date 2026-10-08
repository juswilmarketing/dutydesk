import { describe, expect, it } from "vitest";
import { extractJsonFromModelText } from "./extract-json";

describe("extractJsonFromModelText", () => {
  it("parses clean JSON", () => {
    expect(extractJsonFromModelText('{"selectedCode":"6302.60.00"}')).toEqual({
      selectedCode: "6302.60.00",
    });
  });

  it("recovers JSON embedded in prose", () => {
    const text = `Looking at the candidates, the best fit is towels.\n{"selectedCode":"6302.60.00","confidence":0.6,"reason":"Terry towels"}`;
    expect(extractJsonFromModelText(text)).toEqual({
      selectedCode: "6302.60.00",
      confidence: 0.6,
      reason: "Terry towels",
    });
  });

  it("returns null for prose with no JSON", () => {
    expect(extractJsonFromModelText("Looking at the product profile, I think chapter 63.")).toBeNull();
  });
});
