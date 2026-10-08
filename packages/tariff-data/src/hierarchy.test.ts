import { describe, expect, it } from "vitest";
import {
  buildTariffHealthReport,
  getNationalLine,
  parseTariffCode,
  searchHeadingsInChapters,
  scoreChapter,
} from "./index";

describe("tariff hierarchy", () => {
  it("parses national codes", () => {
    const p = parseTariffCode("6302.60.00");
    expect(p.chapter).toBe("63");
    expect(p.heading).toBe("6302");
    expect(p.validFormat).toBe(true);
    expect(getNationalLine("6302.60.00")?.desc).toMatch(/toilet linen|terry/i);
  });

  it("scores chapter 34 for metal polish query", () => {
    const s = scoreChapter("34", "metal polish restorer", 4);
    expect(s.score).toBeGreaterThan(0);
  });

  it("retrieves headings inside chapter 63 for toilet linen", () => {
    const hits = searchHeadingsInChapters("toilet linen terry cotton towels", ["63"], 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chapter).toBe("63");
  });

  it("health report has no malformed codes", () => {
    const report = buildTariffHealthReport();
    expect(report.orphanedByFormat).toBe(0);
  });
});
