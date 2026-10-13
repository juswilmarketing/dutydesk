import { describe, expect, it } from "vitest";
import { BROKERAGE_LINKS, NAV_SECTIONS, activeNavFor, isBrokeragePath, visibleNav } from "./nav-config";
import appSource from "../app/App.tsx?raw";

const allRoutes = (sections: ReturnType<typeof visibleNav>) =>
  sections.flatMap((s) => s.items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]));

describe("sidebar nav", () => {
  it("lists the workspace and current-job groups in order", () => {
    const admin = visibleNav("admin");
    expect(admin.map((s) => s.label)).toEqual(["Workspace", "Current job"]);
    expect(admin[0].items.map((i) => i.label)).toEqual([
      "Dashboard", "Classify Invoices", "Tariff Search", "Product Memory", "Reports", "Suppliers", "Settings",
    ]);
    expect(admin[1].items.map((i) => i.label)).toEqual(["Upload", "Duties & Taxes", "Worksheet & Send", "Brokerage"]);
  });

  it("hides admin items and all sub-pages from clerks", () => {
    const clerk = visibleNav("clerk");
    expect(clerk[0].items.map((i) => i.label)).toEqual([
      "Dashboard", "Classify Invoices", "Tariff Search", "Product Memory", "Reports",
    ]);
    expect(clerk.flatMap((s) => s.items).some((i) => i.children && i.children.length > 0)).toBe(false);
    expect(allRoutes(clerk).some((r) => r.startsWith("/admin") || r === "/users")).toBe(false);
  });

  it("treats a missing role as a clerk", () => {
    expect(visibleNav(undefined)).toEqual(visibleNav("clerk"));
  });

  it("gives admins a nav entry for every admin page", () => {
    expect(allRoutes(visibleNav("admin"))).toEqual(expect.arrayContaining([
      "/learned", "/admin/product-dictionary", "/admin/product-profiles", "/admin/industry-dictionary",
      "/admin/brand-dictionary", "/admin/attribute-library", "/admin/liquid-composition", "/admin/abbreviations",
      "/admin/learning-stats", "/admin/supplier-history", "/admin/supplier-catalogue",
      "/admin/supplier-intelligence", "/users", "/admin/integrations", "/admin/question-rules",
      "/admin/chapter-rules",
    ]));
  });

  it("points every nav entry at a route that exists in App.tsx", () => {
    const declared = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
    for (const route of allRoutes(visibleNav("admin"))) expect(declared.has(route), route).toBe(true);
  });

  it("marks the active item and sub-page", () => {
    const admin = visibleNav("admin");
    expect(activeNavFor("/flowboard", admin)?.item.label).toBe("Brokerage");
    expect(activeNavFor("/asycuda/123", admin)?.item.label).toBe("Brokerage");
    const profiles = activeNavFor("/admin/product-profiles", admin);
    expect(profiles?.item.label).toBe("Product Memory");
    expect(profiles?.child?.label).toBe("Profiles");
    expect(profiles?.section.id).toBe("workspace");
    expect(activeNavFor("/learned", admin)?.child?.label).toBe("Learning Rules");
    expect(activeNavFor("/admin/integrations", admin)?.item.label).toBe("Settings");
    expect(activeNavFor("/classification", admin)?.item.label).toBe("Classify Invoices");
    expect(activeNavFor("/nowhere", admin)).toBeUndefined();
  });

  it("marks Product Memory without a sub-page for clerks", () => {
    const hit = activeNavFor("/learned", visibleNav("clerk"));
    expect(hit?.item.label).toBe("Product Memory");
    expect(hit?.child).toBeUndefined();
  });

  it("keeps FlowBoard and ASYCUDA under Brokerage", () => {
    expect(BROKERAGE_LINKS.map((l) => l.to)).toEqual(["/brokerage", "/flowboard", "/asycuda"]);
    expect(allRoutes(visibleNav("admin")).some((r) => r === "/flowboard" || r === "/asycuda")).toBe(false);
    expect(isBrokeragePath("/flowboard")).toBe(true);
    expect(isBrokeragePath("/worksheet")).toBe(false);
  });

  it("keeps badges and the invoice requirement", () => {
    const items = NAV_SECTIONS.flatMap((s) => s.items);
    const byLabel = (l: string) => items.find((i) => i.label === l);
    expect(byLabel("Classify Invoices")).toMatchObject({ badge: "invoices", requiresInvoices: true });
    expect(byLabel("Brokerage")?.badge).toBe("flowboard");
    expect(byLabel("Reports")?.badge).toBe("reports");
  });
});
