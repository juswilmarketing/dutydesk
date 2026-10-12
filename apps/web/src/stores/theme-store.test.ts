import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryStorage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
});

import { sanitizePersistedTheme, useThemeStore } from "./theme-store";

describe("theme store", () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: "light", sidebarCollapsed: null });
    memoryStorage.clear();
  });

  it("defaults to light with an automatic sidebar", () => {
    const initial = useThemeStore.getInitialState();
    expect(initial.theme).toBe("light");
    expect(initial.sidebarCollapsed).toBeNull();
  });

  it("remembers an explicit sidebar choice", () => {
    useThemeStore.getState().setSidebarCollapsed(true);
    expect(useThemeStore.getState().sidebarCollapsed).toBe(true);
  });

  it("saves the sidebar choice under the dutydesk-theme key", () => {
    useThemeStore.getState().setSidebarCollapsed(true);
    expect(memoryStorage.getItem("dutydesk-theme")).toContain('"sidebarCollapsed":true');
  });

  it("keeps a saved theme but drops an invalid sidebar choice on load", async () => {
    memoryStorage.setItem(
      "dutydesk-theme",
      JSON.stringify({ state: { theme: "dark", sidebarCollapsed: "false" }, version: 0 }),
    );
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(useThemeStore.getState().sidebarCollapsed).toBeNull();
  });
});

describe("sanitizePersistedTheme", () => {
  it("keeps a saved boolean sidebar choice", () => {
    expect(sanitizePersistedTheme({ sidebarCollapsed: true }).sidebarCollapsed).toBe(true);
    expect(sanitizePersistedTheme({ sidebarCollapsed: false }).sidebarCollapsed).toBe(false);
  });

  it("falls back to automatic when the saved sidebar choice is not a boolean", () => {
    expect(sanitizePersistedTheme({ sidebarCollapsed: "false" }).sidebarCollapsed).toBeNull();
    expect(sanitizePersistedTheme({ sidebarCollapsed: 0 }).sidebarCollapsed).toBeNull();
    expect(sanitizePersistedTheme({ sidebarCollapsed: {} }).sidebarCollapsed).toBeNull();
  });

  it("keeps a saved dark or light theme", () => {
    expect(sanitizePersistedTheme({ theme: "dark" }).theme).toBe("dark");
    expect(sanitizePersistedTheme({ theme: "light" }).theme).toBe("light");
  });

  it("ignores an unknown or missing theme", () => {
    expect(sanitizePersistedTheme({ theme: "blue" })).not.toHaveProperty("theme");
    expect(sanitizePersistedTheme({ sidebarCollapsed: true })).not.toHaveProperty("theme");
  });

  it("returns no overrides when nothing usable was saved", () => {
    expect(sanitizePersistedTheme(null)).toEqual({});
    expect(sanitizePersistedTheme(undefined)).toEqual({});
    expect(sanitizePersistedTheme("dark")).toEqual({});
    expect(sanitizePersistedTheme(42)).toEqual({});
  });
});
