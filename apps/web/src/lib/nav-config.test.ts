import { describe, expect, it } from "vitest";
import { BROKERAGE_LINKS, CLERK_TABS, activeTabFor, isBrokeragePath } from "./nav-config";

describe("nav config", () => {
  it("lists the job steps in order, then secondary tabs", () => {
    expect(CLERK_TABS.map((t) => t.label)).toEqual([
      "Dashboard", "Upload", "Classify", "Duties & Taxes", "Worksheet & Send", "Manual", "Brokerage",
    ]);
  });

  it("keeps FlowBoard and ASYCUDA under Brokerage", () => {
    expect(CLERK_TABS.some((t) => t.to === "/flowboard" || t.to === "/asycuda")).toBe(false);
    expect(BROKERAGE_LINKS.map((l) => l.to)).toEqual(["/brokerage", "/flowboard", "/asycuda"]);
    expect(activeTabFor("/flowboard", CLERK_TABS)?.to).toBe("/brokerage");
    expect(activeTabFor("/asycuda/123", CLERK_TABS)?.to).toBe("/brokerage");
    expect(isBrokeragePath("/flowboard")).toBe(true);
    expect(isBrokeragePath("/worksheet")).toBe(false);
  });

  it("matches ordinary tabs by prefix", () => {
    expect(activeTabFor("/classification", CLERK_TABS)?.label).toBe("Classify");
    expect(activeTabFor("/nowhere", CLERK_TABS)).toBeUndefined();
  });
});
