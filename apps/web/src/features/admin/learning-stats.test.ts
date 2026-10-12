import { describe, expect, it } from "vitest";
import { overrideRateText } from "./learning-stats";

describe("overrideRateText", () => {
  it("shows a dash before any Strong applies", () => {
    expect(overrideRateText(0, 0)).toBe("—");
  });

  it("formats the share of Strong applies later changed, one decimal", () => {
    expect(overrideRateText(200, 3)).toBe("1.5%");
    expect(overrideRateText(3, 0)).toBe("0.0%");
  });
});
