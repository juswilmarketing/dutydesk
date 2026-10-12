import { describe, expect, it } from "vitest";
import { useThemeStore } from "./theme-store";

describe("theme store", () => {
  it("defaults to light with an automatic sidebar", () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe("light");
    expect(state.sidebarCollapsed).toBeNull();
  });

  it("remembers an explicit sidebar choice", () => {
    useThemeStore.getState().setSidebarCollapsed(true);
    expect(useThemeStore.getState().sidebarCollapsed).toBe(true);
  });
});
