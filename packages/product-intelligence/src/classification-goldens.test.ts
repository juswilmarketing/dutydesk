import { describe, expect, it } from "vitest";
import { classifyHierarchically, routeProductFamily, scoreCandidateCompatibility } from "./index";
import { CLASSIFICATION_GOLDENS } from "./fixtures/classification-goldens";

function matchText(expected: string | RegExp, actual: string): boolean {
  if (typeof expected === "string") return actual.toLowerCase().includes(expected.toLowerCase());
  return expected.test(actual);
}

describe("golden classification dataset (family → retrieval)", () => {
  for (const g of CLASSIFICATION_GOLDENS) {
    it(g.id, () => {
      const result = classifyHierarchically(g.description, g.clarification || null, {
        consignee: g.consignee || null,
      });
      const profile = result.profile;

      expect(
        matchText(g.expectedProduct, `${profile.canonicalProduct} ${profile.productNoun}`),
        `product: ${profile.canonicalProduct} / ${profile.productNoun}`,
      ).toBe(true);
      expect(
        matchText(g.expectedFamily, `${profile.productFamily} ${profile.industry} ${profile.canonicalProduct}`),
        `family: ${profile.productFamily}`,
      ).toBe(true);

      if (g.criticalQuestionId) {
        expect(result.criticalQuestion?.id || profile.missingCriticalAttributes.join(" ")).toMatch(
          new RegExp(g.criticalQuestionId.replace(/_/g, "[_ ]?"), "i"),
        );
      }

      // Chapter gate from family
      for (const ch of profile.likelyChapters) {
        expect(g.expectedChapters).toContain(ch.padStart(2, "0"));
      }

      // No prohibited chapters among candidates (critical acceptance rule)
      for (const c of result.candidates) {
        expect(g.prohibitedChapters).not.toContain(c.chapter);
        if (g.prohibitedHeadingPrefixes) {
          for (const bad of g.prohibitedHeadingPrefixes) {
            expect(c.heading.startsWith(bad) || c.code.replace(/\D/g, "").startsWith(bad)).toBe(false);
          }
        }
        if (g.expectedHeadingPrefix && result.candidates.length) {
          // At least one candidate under expected heading when we have results
        }
      }

      if (g.expectedHeadingPrefix && result.candidates.length > 0) {
        expect(result.candidates.every((c) => c.heading.startsWith(g.expectedHeadingPrefix!))).toBe(true);
      }

      // Compatibility: invented wrong domains must fail
      if (g.prohibitedHeadingPrefixes?.includes("8501")) {
        const bad = scoreCandidateCompatibility(profile, {
          code: "8501.10.00",
          description: "Electric motors of an output not exceeding 37.5 W",
          chapter: "85",
          heading: "8501",
        });
        expect(bad.compatible).toBe(false);
      }
    });
  }
});

describe("product family router", () => {
  it("routes interactive display away from motors", () => {
    const route = routeProductFamily("I3 Technologies Interactive Flat Panel Display 75");
    expect(route.productFamily).toMatch(/display/i);
    expect(route.likelyHeadings).toContain("8528");
    expect(route.excludedHeadings.some((h) => h.startsWith("8501"))).toBe(true);
    expect(route.hardHeadingGate).toBe(true);
  });

  it("routes empty glass bottle away from food", () => {
    const route = routeProductFamily("5 oz Sauce Woozy Bottle Flint");
    expect(route.productNoun).toMatch(/bottle/i);
    expect(route.likelyHeadings).toContain("7010");
    expect(route.excludedChapters).toEqual(expect.arrayContaining(["20", "21"]));
  });
});
