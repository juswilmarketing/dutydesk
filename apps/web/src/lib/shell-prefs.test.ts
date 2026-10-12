import { describe, expect, it } from "vitest";
import { effectiveCollapsed, greetingFor } from "./shell-prefs";

describe("effectiveCollapsed", () => {
  it("starts expanded on desktop and collapsed on tablet when the user never chose", () => {
    expect(effectiveCollapsed(null, true)).toBe(false);
    expect(effectiveCollapsed(null, false)).toBe(true);
  });

  it("respects an explicit choice on any width", () => {
    expect(effectiveCollapsed(true, true)).toBe(true);
    expect(effectiveCollapsed(false, false)).toBe(false);
  });
});

describe("greetingFor", () => {
  const at = (h: number) => new Date(2026, 9, 12, h, 0, 0);

  it("greets by time of day with the first name", () => {
    expect(greetingFor(at(8), "P2 Check")).toBe("Good morning, P2");
    expect(greetingFor(at(12), "Marc Wilson")).toBe("Good afternoon, Marc");
    expect(greetingFor(at(18), "Marc Wilson")).toBe("Good evening, Marc");
    expect(greetingFor(at(3), "Marc Wilson")).toBe("Good evening, Marc");
  });

  it("switches to morning at 5:00 and to evening at 17:00", () => {
    expect(greetingFor(at(5), "Marc Wilson")).toBe("Good morning, Marc");
    expect(greetingFor(at(17), "Marc Wilson")).toBe("Good evening, Marc");
  });

  it("drops the name when there is none", () => {
    expect(greetingFor(at(9), undefined)).toBe("Good morning");
    expect(greetingFor(at(9), "   ")).toBe("Good morning");
  });
});
