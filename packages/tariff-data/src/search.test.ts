import { describe, it, expect } from "vitest";
import {
  searchTariff,
  similarCodes,
  catFromCode,
  getTariffCount,
  hasTokenMatch,
} from "./search";

describe("tariff-data", () => {
  it("loads full T&T tariff dataset", () => {
    expect(getTariffCount()).toBe(6101);
  });

  it("searches tariff descriptions", () => {
    const results = searchTariff("monkey", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].desc.toLowerCase()).toMatch(/monkey/);
  });

  it("maps chapter to category", () => {
    expect(catFromCode("0106.11.10")).toBe("Live Animals");
  });
});

describe("token-boundary search regressions", () => {
  it("does not match rack inside track or racket", () => {
    expect(hasTokenMatch("track laying", "rack")).toBe(false);
    expect(hasTokenMatch("tennis rackets", "rack")).toBe(false);
    expect(hasTokenMatch("storage rack", "rack")).toBe(true);
  });

  it("does not match tyre inside styrene", () => {
    expect(hasTokenMatch("styrene", "tyre")).toBe(false);
    expect(hasTokenMatch("pneumatic tyre", "tyre")).toBe(true);
    expect(hasTokenMatch("pneumatic tyres", "tyres")).toBe(true);
  });

  it("tire rack must not return track-laying / racket / styrene false friends", () => {
    const results = searchTariff("tire rack", 8);
    const blob = results.map((r) => `${r.code} ${r.desc}`.toLowerCase()).join(" | ");
    expect(blob).not.toMatch(/track laying/);
    expect(blob).not.toMatch(/racket/);
    expect(blob).not.toMatch(/styrene/);
  });

  it("preferred chapter alone must not surface zero-overlap rubber rows", () => {
    const results = similarCodes("zzzznonexistentproductxyz", null, 6, {
      preferredChapters: ["40"],
      excludeFoodChapters: true,
    });
    expect(results).toHaveLength(0);
  });

  it("expands tire/tyre synonym for pneumatic tyre headings", () => {
    const tireHits = searchTariff("pneumatic tire", 5);
    const tyreHits = searchTariff("pneumatic tyre", 5);
    expect(tireHits.length + tyreHits.length).toBeGreaterThan(0);
  });
});
