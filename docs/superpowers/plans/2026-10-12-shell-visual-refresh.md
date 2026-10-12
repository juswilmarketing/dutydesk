# Shell and Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Duty Desk's horizontal tab bar and header with a collapsible, role-aware navy sidebar and a new header. Make light the default theme, and refresh both themes to a premium SaaS look, without changing any routes, guards, workflows or saved data.

**Architecture:**
- The nav structure lives in one place: `lib/nav-config.ts` defines `NAV_SECTIONS`. The pure helpers `visibleNav` and `activeNavFor` work on it.
- `Sidebar` and `AppHeader` components render that structure inside a thin `AppShell`.
- The palette and shared component looks change through CSS variables and `dd-*` classes in `globals.css`, so existing pages follow along without edits.
- One permission fix: clerks can no longer delete learned rules. This is enforced on the server and hidden in the UI.

**Tech Stack:** React 18, react-router-dom 7, zustand 5 (persist), Tailwind 3 plus CSS variables, `lucide-react` 0.468 (already installed), and vitest. The worker is Hono on Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-10-12-shell-visual-refresh-design.md`

## Global Constraints

- No new npm dependencies.
- Do not change routes, URLs or `AdminRoute` guards in `apps/web/src/app/App.tsx`.
- Do not change classification logic, tariff data or saved-job (`job-sync`) behaviour.
- **Light theme (default):** page `#F4F6FA`, cards `#FFFFFF` with a 1px `#E4E8EF` border, soft shadow and 12px radius, text `#0F1B2D`, muted text `#5B6B82`, sidebar `#0B1A33`.
- **Status colors map onto the existing variables:**
  - primary action → `--accent2`
  - in progress → `--accent`
  - completed → `--green`
  - needs review → `--gold`
  - error → `--red`
- **Contrast exception:** brand orange `#F26B1D` gives only about 3:1 contrast against white button text, which fails the spec's 4.5:1 rule. So `--accent2` (button fill) is `#C2410C`, and `#F26B1D` is a new `--brand-orange` used only for non-text accents (the sidebar active bar and the wordmark on navy).
- Text contrast must be at least 4.5:1 in both themes. Every interactive control has a visible focus ring.
- The global search box and notifications bell are **not** rendered.
- The theme store key stays `dutydesk-theme`, so users' saved choice is kept.
- **Windows/PowerShell:**
  - `npm run typecheck` rewrites `apps/web/tsconfig.tsbuildinfo`. Always run `git checkout -- apps/web/tsconfig.tsbuildinfo` afterwards and never commit it.
- **Commands (from repo root):**
  - Web tests: `npm run test --workspace @pas/web`
  - Worker tests: `npm run test --workspace @pas/worker`
  - Typecheck: `npm run typecheck`
  - Build: `npm run build:web`

## File map

| File | Change | Responsibility |
|---|---|---|
| `apps/worker/src/routes/learned.ts` | Modify | Admin-only DELETE routes |
| `apps/worker/src/routes/learned.test.ts` | Create | Permission tests |
| `apps/web/src/features/learned/LearnedPage.tsx` | Modify | Hide Delete and Clear All for clerks |
| `apps/web/src/lib/nav-config.ts` | Rewrite | `NAV_SECTIONS`, `visibleNav`, `activeNavFor`, `BROKERAGE_LINKS`, `isBrokeragePath` |
| `apps/web/src/lib/nav-config.test.ts` | Rewrite | Nav helper tests, including a check that every nav route exists in `App.tsx` |
| `apps/web/src/lib/shell-prefs.ts` | Create | `effectiveCollapsed`, `greetingFor` (pure) |
| `apps/web/src/lib/shell-prefs.test.ts` | Create | Tests for the above |
| `apps/web/src/stores/theme-store.ts` | Modify | Default light; `sidebarCollapsed: boolean \| null` |
| `apps/web/src/stores/theme-store.test.ts` | Create | Default tests |
| `apps/web/src/hooks/useMediaQuery.ts` | Create | Media-query hook |
| `apps/web/src/styles/globals.css` | Modify | Palette, shared components, shell, sidebar and header styles; remove tab-bar and mobile-nav styles |
| `apps/web/src/components/layout/Sidebar.tsx` | Create | Sidebar, collapse rail, phone drawer |
| `apps/web/src/components/layout/AppHeader.tsx` | Create | Greeting, counts, Upload, theme toggle, user menu |
| `apps/web/src/app/AppShell.tsx` | Rewrite | Thin layout |
| `apps/web/src/components/layout/ScrollableTabNav.tsx` | Delete | No longer used |
| `apps/web/src/lib/nav-tips.ts` | Modify | Drop the "(admin)" suffix on `/learned` and `/reports`, since clerks see them now |

---

### Task 1: Clerks can't delete learned rules

**Files:**
- Modify: `apps/worker/src/routes/learned.ts:57-68`
- Create: `apps/worker/src/routes/learned.test.ts`
- Modify: `apps/web/src/features/learned/LearnedPage.tsx`

**Interfaces:**
- Consumes: `adminMiddleware` from `apps/worker/src/middleware/auth.ts`, which returns 403 `{ error: "Forbidden" }` when `c.var.role !== "admin"`.
- Produces: `DELETE /api/learned/:key` and `DELETE /api/learned` return 403 for clerks. `GET` and `POST` are unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/routes/learned.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppVariables, Env } from "../env";
import learned from "./learned";

function fakeDb() {
  const executed: string[] = [];
  const statement = (sql: string) => ({
    bind: () => ({
      run: async () => {
        executed.push(sql);
        return {};
      },
    }),
    run: async () => {
      executed.push(sql);
      return {};
    },
  });
  return { executed, db: { prepare: (sql: string) => statement(sql) } };
}

function appAs(role: AppVariables["role"]) {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", 1);
    c.set("username", "tester");
    c.set("name", "Tester");
    c.set("role", role);
    c.set("sessionId", "s");
    await next();
  });
  app.route("/learned", learned);
  return app;
}

async function send(role: AppVariables["role"], path: string) {
  const { executed, db } = fakeDb();
  const res = await appAs(role).request(path, { method: "DELETE" }, { DB: db } as unknown as Env);
  return { res, deletes: executed.filter((sql) => sql.startsWith("DELETE")) };
}

describe("learned rule deletion permissions", () => {
  it("refuses a clerk deleting one rule", async () => {
    const { res, deletes } = await send("clerk", "/learned/cotton%20shirt");
    expect(res.status).toBe(403);
    expect(deletes).toEqual([]);
  });

  it("refuses a clerk clearing all rules", async () => {
    const { res, deletes } = await send("clerk", "/learned");
    expect(res.status).toBe(403);
    expect(deletes).toEqual([]);
  });

  it("lets an admin delete one rule", async () => {
    const { res, deletes } = await send("admin", "/learned/cotton%20shirt");
    expect(res.status).toBe(200);
    expect(deletes).toEqual(["DELETE FROM learned WHERE normalized_desc = ?"]);
  });

  it("lets an admin clear all rules", async () => {
    const { res, deletes } = await send("admin", "/learned");
    expect(res.status).toBe(200);
    expect(deletes).toEqual(["DELETE FROM learned"]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test --workspace @pas/worker -- learned.test`
Expected: the two clerk tests FAIL (status 200, not 403). The two admin tests pass.

- [ ] **Step 3: Guard the DELETE routes**

In `apps/worker/src/routes/learned.ts`, add the import below the existing imports:

```ts
import { adminMiddleware } from "../middleware/auth";
```

Replace the two delete handlers with:

```ts
learned.delete("/:key", adminMiddleware, async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  await c.env.DB.prepare("DELETE FROM learned WHERE normalized_desc = ?").bind(key).run();
  await audit(c, "learned_delete");
  return c.json({ ok: true });
});

learned.delete("/", adminMiddleware, async (c) => {
  await c.env.DB.prepare("DELETE FROM learned").run();
  await audit(c, "learned_clear_all");
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test --workspace @pas/worker -- learned.test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Hide the controls for clerks in `LearnedPage.tsx`**

Add the import:

```ts
import { useAuthStore } from "@/stores/auth-store";
```

At the top of `LearnedPage()`, after `const setLearnedMap = ...`:

```ts
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
```

Change the Clear All condition from `{entries.length > 0 && (` (the one wrapping the `🗑 Clear All` button) to:

```tsx
            {isAdmin && entries.length > 0 && (
```

Change the column headings array to drop the last (delete) column for clerks:

```tsx
                  {["Item Description", "Tariff Code", "Duty Rate", "Category", "Used", "Learned On", ...(isAdmin ? [""] : [])].map((h) => (
```

Wrap the delete cell (the `<td>` containing the `✕` button) so it renders only for admins:

```tsx
                    {isAdmin && (
                      <td>
                        <button
                          type="button"
                          onClick={() => deleteEntry(val.normalized_desc)}
                          aria-label={`Delete learned rule for ${val.normalized_desc}`}
                          className="border-none bg-transparent dd-text-muted hover:opacity-70"
                        >
                          ✕
                        </button>
                      </td>
                    )}
```

In the bottom `InfoBanner`, replace the sentence ` Delete any entry to stop using it.` with:

```tsx
          {isAdmin ? " Delete any entry to stop using it." : " Ask an admin to remove an entry."}
```

- [ ] **Step 6: Typecheck and run the full worker suite**

Run: `npm run typecheck; git checkout -- apps/web/tsconfig.tsbuildinfo; npm run test --workspace @pas/worker`
Expected: typecheck exits 0. The worker suite passes.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/learned.ts apps/worker/src/routes/learned.test.ts apps/web/src/features/learned/LearnedPage.tsx
git commit -m "fix: only admins can delete or clear learned rules"
```

---

### Task 2: Sidebar navigation config

**Files:**
- Modify: `apps/web/src/lib/nav-config.ts`. Add new exports and keep the old `CLERK_TABS`, `TabDef` and `activeTabFor` until Task 5 removes them.
- Modify: `apps/web/src/lib/nav-config.test.ts`. Add new tests and keep the old ones until Task 5.
- Modify: `apps/web/src/lib/nav-tips.ts`

**Interfaces:**
- Produces:

```ts
export type NavBadge = "invoices" | "flowboard" | "reports";
export type NavChild = { to: string; label: string };
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  badge?: NavBadge;
  requiresInvoices?: boolean;
  matches?: readonly string[];
  /** Admin-only sub-pages; removed entirely for non-admins. */
  children?: readonly NavChild[];
};
export type NavSection = { id: "workspace" | "job"; label: string; items: readonly NavItem[] };
export type NavRole = "admin" | "clerk";
export const NAV_SECTIONS: readonly NavSection[];
export function visibleNav(role: NavRole | undefined): NavSection[];
export function activeNavFor(pathname: string, sections: readonly NavSection[]):
  { section: NavSection; item: NavItem; child?: NavChild } | undefined;
export const BROKERAGE_LINKS; // unchanged
export function isBrokeragePath(pathname: string): boolean; // unchanged
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/nav-config.test.ts`. Keep the existing imports and tests, and add a second import line:

```ts
import appSource from "../app/App.tsx?raw";
import { NAV_SECTIONS, activeNavFor, visibleNav } from "./nav-config";

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

  it("keeps badges and the invoice requirement", () => {
    const items = NAV_SECTIONS.flatMap((s) => s.items);
    const byLabel = (l: string) => items.find((i) => i.label === l);
    expect(byLabel("Classify Invoices")).toMatchObject({ badge: "invoices", requiresInvoices: true });
    expect(byLabel("Brokerage")?.badge).toBe("flowboard");
    expect(byLabel("Reports")?.badge).toBe("reports");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test --workspace @pas/web -- nav-config`
Expected: FAIL with `NAV_SECTIONS` / `visibleNav` / `activeNavFor` not exported.

- [ ] **Step 3: Implement the new exports**

In `apps/web/src/lib/nav-config.ts`, add this import at the top:

```ts
import {
  Anchor,
  Brain,
  Calculator,
  ChartBar,
  Factory,
  FileText,
  LayoutDashboard,
  ListChecks,
  Search,
  Settings,
  Upload,
  type LucideIcon,
} from "lucide-react";
```

Append below the existing code (leave `TabDef`, `CLERK_TABS` and `activeTabFor` in place for now):

```ts
export type NavBadge = "invoices" | "flowboard" | "reports";
export type NavChild = { to: string; label: string };
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  badge?: NavBadge;
  requiresInvoices?: boolean;
  matches?: readonly string[];
  /** Admin-only sub-pages; removed entirely for non-admins. */
  children?: readonly NavChild[];
};
export type NavSection = { id: "workspace" | "job"; label: string; items: readonly NavItem[] };
export type NavRole = "admin" | "clerk";

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      {
        to: "/classification",
        label: "Classify Invoices",
        icon: ListChecks,
        badge: "invoices",
        requiresInvoices: true,
      },
      { to: "/manual", label: "Tariff Search", icon: Search },
      {
        to: "/learned",
        label: "Product Memory",
        icon: Brain,
        children: [
          { to: "/learned", label: "Learning Rules" },
          { to: "/admin/product-dictionary", label: "Products" },
          { to: "/admin/product-profiles", label: "Profiles" },
          { to: "/admin/industry-dictionary", label: "Industries" },
          { to: "/admin/brand-dictionary", label: "Brands" },
          { to: "/admin/attribute-library", label: "Attribute Library" },
          { to: "/admin/liquid-composition", label: "Liquid Composition" },
          { to: "/admin/abbreviations", label: "Abbreviations" },
          { to: "/admin/learning-stats", label: "Learning Stats" },
        ],
      },
      { to: "/reports", label: "Reports", icon: ChartBar, badge: "reports" },
      {
        to: "/admin/supplier-history",
        label: "Suppliers",
        icon: Factory,
        adminOnly: true,
        children: [
          { to: "/admin/supplier-history", label: "History" },
          { to: "/admin/supplier-catalogue", label: "Catalogue" },
          { to: "/admin/supplier-intelligence", label: "Intelligence" },
        ],
      },
      {
        to: "/users",
        label: "Settings",
        icon: Settings,
        adminOnly: true,
        children: [
          { to: "/users", label: "Users" },
          { to: "/admin/integrations", label: "Integrations" },
          { to: "/admin/question-rules", label: "Questions" },
          { to: "/admin/chapter-rules", label: "Chapter Rules" },
        ],
      },
    ],
  },
  {
    id: "job",
    label: "Current job",
    items: [
      { to: "/upload", label: "Upload", icon: Upload },
      { to: "/duties-taxes", label: "Duties & Taxes", icon: Calculator },
      { to: "/worksheet", label: "Worksheet & Send", icon: FileText },
      {
        to: "/brokerage",
        label: "Brokerage",
        icon: Anchor,
        badge: "flowboard",
        matches: BROKERAGE_LINKS.map((l) => l.to),
      },
    ],
  },
];

export function visibleNav(role: NavRole | undefined): NavSection[] {
  const isAdmin = role === "admin";
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => isAdmin || !item.adminOnly)
      .map((item) => (isAdmin ? item : { ...item, children: undefined })),
  }));
}

const isUnder = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`);

export function activeNavFor(
  pathname: string,
  sections: readonly NavSection[],
): { section: NavSection; item: NavItem; child?: NavChild } | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      const child = item.children?.find((c) => isUnder(pathname, c.to));
      if (child) return { section, item, child };
      if ([item.to, ...(item.matches ?? [])].some((route) => isUnder(pathname, route))) return { section, item };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm run test --workspace @pas/web -- nav-config`
Expected: PASS. The old and new `describe` blocks are both green.

- [ ] **Step 5: Update the nav tips**

In `apps/web/src/lib/nav-tips.ts`, change these two lines:

```ts
  "/learned": "Tariff codes the team has confirmed, reused automatically on similar items.",
  "/reports": "History of worksheets and tax advice, synced across the team.",
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/nav-config.ts apps/web/src/lib/nav-config.test.ts apps/web/src/lib/nav-tips.ts
git commit -m "feat(web): sidebar nav sections with role filtering and active matching"
```

---

### Task 3: Theme default, sidebar preference and shell helpers

**Files:**
- Modify: `apps/web/src/stores/theme-store.ts`
- Create: `apps/web/src/stores/theme-store.test.ts`
- Create: `apps/web/src/lib/shell-prefs.ts`
- Create: `apps/web/src/lib/shell-prefs.test.ts`
- Create: `apps/web/src/hooks/useMediaQuery.ts`

**Interfaces:**
- Produces:

```ts
// theme-store.ts
type Theme = "dark" | "light";
interface ThemeState {
  theme: Theme;                          // default "light"
  sidebarCollapsed: boolean | null;      // null = automatic by screen width
  setTheme(t: Theme): void;
  toggleTheme(): void;
  setSidebarCollapsed(v: boolean): void;
}
// shell-prefs.ts
export function effectiveCollapsed(pref: boolean | null, isDesktop: boolean): boolean;
export function greetingFor(date: Date, fullName: string | undefined): string;
// hooks/useMediaQuery.ts
export function useMediaQuery(query: string): boolean;
export const DESKTOP_QUERY = "(min-width: 1024px)";
export const PHONE_QUERY = "(max-width: 767px)";
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/shell-prefs.test.ts`:

```ts
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

  it("drops the name when there is none", () => {
    expect(greetingFor(at(9), undefined)).toBe("Good morning");
    expect(greetingFor(at(9), "   ")).toBe("Good morning");
  });
});
```

Create `apps/web/src/stores/theme-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test --workspace @pas/web -- shell-prefs theme-store`
Expected: FAIL. `./shell-prefs` doesn't exist, `theme` is `"dark"`, and `setSidebarCollapsed` isn't a function.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/shell-prefs.ts`:

```ts
export function effectiveCollapsed(pref: boolean | null, isDesktop: boolean): boolean {
  return pref ?? !isDesktop;
}

export function greetingFor(date: Date, fullName: string | undefined): string {
  const hour = date.getHours();
  const part = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}
```

Replace `apps/web/src/stores/theme-store.ts` with:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  /** null = choose by screen width (expanded on desktop, rail on tablet). */
  sidebarCollapsed: boolean | null;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      sidebarCollapsed: null,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    { name: 'dutydesk-theme' },
  ),
);
```

Users who saved a theme keep it, because persist merges the stored `theme` over the default.

Create `apps/web/src/hooks/useMediaQuery.ts`:

```ts
import { useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";
export const PHONE_QUERY = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm run test --workspace @pas/web -- shell-prefs theme-store`
Expected: PASS, 6 tests. A zustand warning that storage is unavailable in the test environment is fine.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/shell-prefs.ts apps/web/src/lib/shell-prefs.test.ts apps/web/src/stores/theme-store.ts apps/web/src/stores/theme-store.test.ts apps/web/src/hooks/useMediaQuery.ts
git commit -m "feat(web): light default theme, sidebar preference, greeting helper"
```

---

### Task 4: Palette and shared component styles

This is CSS only. Pages keep their markup and pick the changes up through variables and shared classes. It has no unit test; it is verified by build plus the browser pass in Task 6.

**Files:**
- Modify: `apps/web/src/styles/globals.css`
- Modify: `apps/web/src/components/ui/button.tsx`

**Interfaces:**
- Produces these CSS variables in both themes. The existing names are unchanged, so every page keeps working; the new ones are used by Task 5:
  - `--brand-orange`
  - `--sidebar-bg`
  - `--sidebar-text`
  - `--sidebar-muted`
  - `--sidebar-hover`
  - `--sidebar-active`
  - `--focus-ring`

- [ ] **Step 1: Replace the dark and light variable blocks**

In `globals.css`, replace everything from `  :root,` through the closing `}` of `[data-theme='light'] { ... color-scheme: light; }` (currently lines 8–65) with:

```css
  :root,
  [data-theme='light'] {
    --bg: #f4f6fa;
    --surface: #ffffff;
    --surface2: #f1f4f9;
    --border: #e4e8ef;
    --text: #0f1b2d;
    --text2: #5b6b82;
    --text3: #8a97ab;
    --accent: #1d4ed8;
    --accent-light: #e8f0fe;
    --accent2: #c2410c;
    --accent2-light: #fff1e8;
    --brand-orange: #f26b1d;
    --green: #15803d;
    --green-light: #e7f6ec;
    --red: #b91c1c;
    --red-light: #fdecec;
    --gold: #b45309;
    --gold-light: #fef3c7;
    --header-bg: #ffffff;
    --header-text: #0f1b2d;
    --header-muted: #5b6b82;
    --sidebar-bg: #0b1a33;
    --sidebar-text: #c9d3e3;
    --sidebar-muted: #7f8da6;
    --sidebar-hover: rgba(255, 255, 255, 0.06);
    --sidebar-active: rgba(255, 255, 255, 0.1);
    --focus-ring: #2563eb;
    --radius: 12px;
    --radius-sm: 8px;
    --shadow: 0 1px 2px rgba(15, 27, 45, 0.06), 0 4px 12px rgba(15, 27, 45, 0.05);
    --shadow-md: 0 4px 10px rgba(15, 27, 45, 0.08), 0 12px 32px rgba(15, 27, 45, 0.08);
    color-scheme: light;
  }

  [data-theme='dark'] {
    --bg: #0b1424;
    --surface: #121d31;
    --surface2: #0f192b;
    --border: #22304a;
    --text: #e6ecf5;
    --text2: #9aa8bf;
    --text3: #5d6c86;
    --accent: #60a5fa;
    --accent-light: #15294a;
    --accent2: #c2410c;
    --accent2-light: #2e1a0f;
    --brand-orange: #f26b1d;
    --green: #34d399;
    --green-light: #0f2e24;
    --red: #f87171;
    --red-light: #3a1616;
    --gold: #fbbf24;
    --gold-light: #2e2410;
    --header-bg: #121d31;
    --header-text: #e6ecf5;
    --header-muted: #9aa8bf;
    --sidebar-bg: #08111f;
    --sidebar-text: #c9d3e3;
    --sidebar-muted: #7f8da6;
    --sidebar-hover: rgba(255, 255, 255, 0.05);
    --sidebar-active: rgba(255, 255, 255, 0.09);
    --focus-ring: #93c5fd;
    --radius: 12px;
    --radius-sm: 8px;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 6px 24px rgba(0, 0, 0, 0.35);
    color-scheme: dark;
  }
```

`--nav-bg` and `--nav-active-bg` are dropped; Task 5 removes their only users (the `.dd-tabs` and `.dd-tab-active` rules).

- [ ] **Step 2: Base typography and focus rings**

In the `body { ... }` rule, change `font-size: 15px;` to `font-size: 14px;`.

Replace the rule

```css
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
  }
```

with:

```css
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
  }

  a:focus-visible,
  button:focus-visible,
  summary:focus-visible,
  [tabindex]:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tabular-nums,
  .code-chip,
  .data-table td {
    font-variant-numeric: tabular-nums;
  }
```

- [ ] **Step 3: Page title and section title**

Replace `.dd-page-title` and `.dd-section-title` with:

```css
  .dd-page-title {
    @apply text-xl font-semibold tracking-tight sm:text-2xl;
    color: var(--text);
  }
```

```css
  .dd-section-title {
    @apply mb-4 text-base font-semibold;
    color: var(--text);
  }
```

- [ ] **Step 4: Cards, metric cards, status badges, tables, banners**

Replace the `.dd-card` rule with:

```css
  .dd-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
```

Replace the `.dd-metric-card` rule and its four tone rules with:

```css
  .dd-metric-card {
    @apply rounded-xl border p-4;
    border-color: var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    border-top-width: 3px;
  }
  .dd-metric-card-blue { border-top-color: var(--accent); }
  .dd-metric-card-green { border-top-color: var(--green); }
  .dd-metric-card-gold { border-top-color: var(--gold); }
  .dd-metric-card-red { border-top-color: var(--red); }
```

Replace the `.dd-status-badge` rule (keep the five tone rules below it) with:

```css
  .dd-status-badge {
    @apply inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold;
  }
```

Replace the `.data-table` block (from `.data-table {` to `.data-table tbody tr:hover td { ... }`) with:

```css
  .data-table {
    @apply w-full border-collapse text-sm;
  }
  .data-table thead tr {
    background: var(--surface2);
  }
  .data-table th {
    @apply sticky top-0 z-[1] whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold;
    background: var(--surface2);
    color: var(--text2);
    border-bottom: 1px solid var(--border);
  }
  .data-table td {
    @apply px-4 py-3;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .data-table tbody tr:last-child td {
    border-bottom: none;
  }
  .data-table tbody tr:hover td {
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
```

Replace the three banner blocks (`.notif-info, .dd-notif-info`, `.notif-warn, .dd-notif-warn`, `.notif-error, .dd-notif-error`) with:

```css
  .notif-info,
  .dd-notif-info,
  .notif-warn,
  .dd-notif-warn,
  .notif-error,
  .dd-notif-error {
    @apply rounded-[10px] border px-4 py-3 text-sm leading-relaxed;
    background: var(--surface);
    border-color: var(--border);
    border-left-width: 3px;
    color: var(--text);
  }
  .notif-info,
  .dd-notif-info {
    border-left-color: var(--accent);
  }
  .notif-warn,
  .dd-notif-warn {
    border-left-color: var(--gold);
  }
  .notif-error,
  .dd-notif-error {
    border-left-color: var(--red);
  }
```

- [ ] **Step 5: Buttons**

In `apps/web/src/components/ui/button.tsx`, replace the base class string in `cn(` with:

```ts
        "inline-flex items-center justify-center gap-2 rounded-lg border border-transparent px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50",
```

Replace the `ghost` entry of `variantStyles` with:

```ts
  ghost: { color: "var(--text2)", boxShadow: "none" },
```

- [ ] **Step 6: Build**

Run: `npm run build:web`
Expected: `✓ built`, no CSS or TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/styles/globals.css apps/web/src/components/ui/button.tsx
git commit -m "feat(web): premium palette, light default tokens, quieter banners, refreshed cards and tables"
```

---

### Task 5: Sidebar, header and new shell

**Files:**
- Create: `apps/web/src/components/layout/Sidebar.tsx`
- Create: `apps/web/src/components/layout/AppHeader.tsx`
- Rewrite: `apps/web/src/app/AppShell.tsx`
- Delete: `apps/web/src/components/layout/ScrollableTabNav.tsx`
- Modify: `apps/web/src/lib/nav-config.ts` (remove `TabDef`, `CLERK_TABS`, `activeTabFor`)
- Modify: `apps/web/src/lib/nav-config.test.ts` (remove the old `describe("nav config")` block and its import of `CLERK_TABS` / `activeTabFor`; keep `BROKERAGE_LINKS` / `isBrokeragePath` assertions in a new test)
- Modify: `apps/web/src/styles/globals.css` (remove tab-bar and mobile-nav styles; add shell, sidebar and header styles)

**Interfaces:**
- Consumes:
  - from Task 2: `visibleNav`, `activeNavFor`, `NavSection`, `NavItem`, `BROKERAGE_LINKS`, `isBrokeragePath`;
  - from Task 3: `useThemeStore` (`theme`, `toggleTheme`, `sidebarCollapsed`, `setSidebarCollapsed`), `effectiveCollapsed`, `greetingFor`, `useMediaQuery`, `DESKTOP_QUERY`, `PHONE_QUERY`;
  - existing helpers: `dashboardMetrics(invoices, taxLog, taxInputs)` from `@/lib/workflow-pipeline`, `getTariffCount()` from `@pas/tariff-data`, `NAV_TAB_TIPS` from `@/lib/nav-tips`, `DUTY_DESK_LOGO_SRC` from `@/lib/brand`.
- Produces:
  - `<Sidebar collapsed drawerOpen onCloseDrawer onToggleCollapsed isPhone badges invoiceCount />`;
  - `<AppHeader onOpenMenu menuButtonRef isPhone />`;
  - `AppShell({ children })` (same signature as today).

- [ ] **Step 1: Replace the old nav tests**

In `apps/web/src/lib/nav-config.test.ts`:
1. Delete the old `describe("nav config", ...)` block.
2. Change the first import line to `import { BROKERAGE_LINKS, isBrokeragePath } from "./nav-config";`.
3. Add inside `describe("sidebar nav", ...)`:

```ts
  it("keeps FlowBoard and ASYCUDA under Brokerage", () => {
    expect(BROKERAGE_LINKS.map((l) => l.to)).toEqual(["/brokerage", "/flowboard", "/asycuda"]);
    expect(allRoutes(visibleNav("admin")).some((r) => r === "/flowboard" || r === "/asycuda")).toBe(false);
    expect(isBrokeragePath("/flowboard")).toBe(true);
    expect(isBrokeragePath("/worksheet")).toBe(false);
  });
```

Then in `apps/web/src/lib/nav-config.ts` delete the `TabDef` type, `CLERK_TABS` and `activeTabFor`.

Run: `npm run test --workspace @pas/web -- nav-config`
Expected: PASS.

- [ ] **Step 2: Create `Sidebar.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { NAV_TAB_TIPS } from "@/lib/nav-tips";
import { activeNavFor, type NavBadge, type NavItem, type NavSection } from "@/lib/nav-config";

type SidebarProps = {
  sections: NavSection[];
  collapsed: boolean;
  isPhone: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onToggleCollapsed: () => void;
  badges: Record<NavBadge, number>;
  invoiceCount: number;
};

export function Sidebar({
  sections,
  collapsed,
  isPhone,
  drawerOpen,
  onCloseDrawer,
  onToggleCollapsed,
  badges,
  invoiceCount,
}: SidebarProps) {
  const location = useLocation();
  const asideRef = useRef<HTMLElement>(null);
  const active = activeNavFor(location.pathname, sections);
  const rail = collapsed && !isPhone;

  useEffect(() => {
    if (isPhone && drawerOpen) onCloseDrawer();
  }, [location.pathname]);

  useEffect(() => {
    if (!isPhone || !drawerOpen) return;
    const aside = asideRef.current;
    aside?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseDrawer();
        return;
      }
      if (e.key !== "Tab" || !aside) return;
      const focusable = [...aside.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPhone, drawerOpen, onCloseDrawer]);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = active?.item === item;
    const badge = item.badge ? badges[item.badge] : 0;
    const disabled = item.requiresInvoices && invoiceCount === 0;
    const tip = disabled ? `${item.label} (upload an invoice first)` : NAV_TAB_TIPS[item.to] ?? item.label;
    const content = (
      <>
        <Icon size={18} aria-hidden className="shrink-0" />
        {!rail && <span className="truncate">{item.label}</span>}
        {!rail && badge > 0 && <span className="dd-side-badge">{badge}</span>}
        {rail && badge > 0 && <span className="dd-side-dot" aria-hidden />}
      </>
    );

    return (
      <li key={item.to}>
        {disabled ? (
          <span className="dd-side-link dd-side-link-disabled" title={tip} aria-disabled="true">
            {content}
            {rail && <span className="sr-only">{item.label}</span>}
          </span>
        ) : (
          <NavLink
            to={item.to}
            title={rail ? item.label : tip}
            aria-current={isActive ? "page" : undefined}
            className={cn("dd-side-link", isActive && "dd-side-link-active")}
          >
            {content}
            {rail && <span className="sr-only">{item.label}</span>}
          </NavLink>
        )}
        {!rail && isActive && item.children && item.children.length > 0 && (
          <ul className="dd-side-children">
            {item.children.map((child) => (
              <li key={child.to}>
                <NavLink
                  to={child.to}
                  aria-current={active?.child === child ? "page" : undefined}
                  className={cn("dd-side-child", active?.child === child && "dd-side-child-active")}
                >
                  {child.label}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      ref={asideRef}
      id="dd-sidebar"
      aria-label="Main navigation"
      className={cn(
        "dd-sidebar",
        rail && "dd-sidebar-rail",
        isPhone && "dd-sidebar-drawer",
        isPhone && drawerOpen && "dd-sidebar-drawer-open",
      )}
      aria-hidden={isPhone && !drawerOpen ? true : undefined}
    >
      <div className="dd-side-brand">
        <img src={DUTY_DESK_LOGO_SRC} alt="" aria-hidden className="h-9 w-auto shrink-0" />
        {!rail && <span className="dd-side-wordmark">Duty Desk</span>}
      </div>

      <nav className="dd-side-scroll">
        {sections.map((section) => (
          <div key={section.id} className="dd-side-section">
            {!rail && <div className="dd-side-heading">{section.label}</div>}
            <ul>{section.items.map(renderItem)}</ul>
          </div>
        ))}
      </nav>

      {!isPhone && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="dd-side-collapse"
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!rail}
          aria-controls="dd-sidebar"
        >
          {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!rail && <span>Collapse</span>}
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Create `AppHeader.tsx`**

```tsx
import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Menu, Moon, Sun, Upload } from "lucide-react";
import { getTariffCount } from "@pas/tariff-data";
import { useAuthStore } from "@/stores/auth-store";
import { useThemeStore } from "@/stores/theme-store";
import { useInvoiceStore } from "@/stores/invoice-store";
import { greetingFor } from "@/lib/shell-prefs";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { Button } from "@/components/ui/button";

type AppHeaderProps = {
  isPhone: boolean;
  drawerOpen: boolean;
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement>;
};

export function AppHeader({ isPhone, drawerOpen, onOpenMenu, menuButtonRef }: AppHeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const invoiceCount = useInvoiceStore((s) => s.invoices.length);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const counts = `${getTariffCount().toLocaleString()} tariff entries · ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} loaded`;

  return (
    <header className="dd-header">
      <div className="flex min-w-0 items-center gap-3">
        {isPhone && (
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onOpenMenu}
            className="dd-icon-btn"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="dd-sidebar"
          >
            <Menu size={20} />
          </button>
        )}
        {isPhone && <img src={DUTY_DESK_LOGO_SRC} alt="Duty Desk" className="h-8 w-auto" />}
        {!isPhone && (
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold" style={{ color: "var(--text)" }}>
              {greetingFor(new Date(), user?.name)}
            </div>
            <div className="truncate text-xs" style={{ color: "var(--text2)" }}>
              {counts}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isPhone ? (
          <button type="button" className="dd-icon-btn dd-icon-btn-primary" aria-label="Upload invoice" onClick={() => navigate("/upload")}>
            <Upload size={18} />
          </button>
        ) : (
          <Button onClick={() => navigate("/upload")}>
            <Upload size={16} aria-hidden />
            Upload Invoice
          </Button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="dd-icon-btn"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            className="dd-user-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="dd-avatar" aria-hidden>
              {(user?.name || user?.username || "?").trim().charAt(0).toUpperCase()}
            </span>
            {!isPhone && <span className="max-w-[160px] truncate text-sm">{user?.name}</span>}
            <ChevronDown size={14} aria-hidden />
          </button>
          {menuOpen && (
            <div className="dd-user-menu" role="menu">
              <div className="px-3 py-2">
                <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{user?.name}</div>
                <div className="text-xs capitalize" style={{ color: "var(--text2)" }}>{user?.role}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                className="dd-user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
              >
                <LogOut size={16} aria-hidden />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Rewrite `AppShell.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { useInvoiceStore } from '@/stores/invoice-store';
import { useWorkflowStore } from '@/stores/workflow-store';
import { dashboardMetrics } from '@/lib/workflow-pipeline';
import { BROKERAGE_LINKS, isBrokeragePath, visibleNav } from '@/lib/nav-config';
import { effectiveCollapsed } from '@/lib/shell-prefs';
import { DESKTOP_QUERY, PHONE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { Sidebar } from '@/components/layout/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { JobSaveIndicator } from '@/components/workflow/JobSaveIndicator';

export function AppShell({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  const invoices = useInvoiceStore((s) => s.invoices);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const theme = useThemeStore((s) => s.theme);
  const sidebarPref = useThemeStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useThemeStore((s) => s.setSidebarCollapsed);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isPhone) setDrawerOpen(false);
  }, [isPhone]);

  const collapsed = effectiveCollapsed(sidebarPref, isDesktop);
  const metrics = dashboardMetrics(invoices, taxLog, taxInputs);
  const badges = {
    invoices: invoices.length,
    flowboard: metrics.sentFlowboard + metrics.readyFlowboard,
    reports: taxLog.length,
  };

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  return (
    <div className={cn('dd-shell', !isPhone && (collapsed ? 'dd-shell-rail' : 'dd-shell-wide'))}>
      <a href="#dd-main" className="dd-skip-link">
        Skip to content
      </a>

      <Sidebar
        sections={visibleNav(role)}
        collapsed={collapsed}
        isPhone={isPhone}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
        onToggleCollapsed={() => setSidebarCollapsed(!collapsed)}
        badges={badges}
        invoiceCount={invoices.length}
      />
      {isPhone && drawerOpen && <div className="dd-sidebar-backdrop" onClick={closeDrawer} aria-hidden />}

      <div className="dd-shell-main">
        <AppHeader
          isPhone={isPhone}
          drawerOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <div className="dd-content">
          {isBrokeragePath(location.pathname) && (
            <nav className="dd-subnav" aria-label="Brokerage">
              {BROKERAGE_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => cn('dd-subnav-link no-underline', isActive && 'dd-subnav-link-active')}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )}
          <main id="dd-main" tabIndex={-1} className="min-w-0 outline-none">
            <JobSaveIndicator />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Delete the old tab bar**

Delete the file:

```bash
git rm apps/web/src/components/layout/ScrollableTabNav.tsx
```

- [ ] **Step 6: Swap the CSS**

In `globals.css`:
1. Delete every rule from `.dd-tabs-wrap {` through `.dd-tab-badge { ... }`. That covers all the `.dd-tabs*` and `.dd-tab*` rules. Keep `.dd-subnav*`.
2. Delete `.dd-app-header`, `.dd-header-brand`, `.dd-mobile-nav`, `.dd-mobile-nav::-webkit-scrollbar`, `.dd-mobile-tab` and `.dd-mobile-tab-active`.
3. Delete the whole `@media (max-width: 640px) { ... }` block that hides `.dd-tabs-wrap` and pads `.main-wrap`.
4. Delete the `@media (min-width: 641px)` block and the `@media (max-width: 480px)` block that target `.header-user-name` and `.header-title-sub`.
5. In `.dd-sticky-actions`, keep `bottom: 1rem;`. No phone override is needed now that the bottom bar is gone.

Then add this block where the deleted tab rules were:

```css
  /* App shell */
  .dd-skip-link {
    @apply absolute left-3 top-3 z-[100] -translate-y-20 rounded-md px-3 py-2 text-sm font-semibold transition;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-md);
  }
  .dd-skip-link:focus {
    @apply translate-y-0;
  }

  .dd-shell {
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
  }
  .dd-shell-wide .dd-shell-main {
    margin-left: 248px;
  }
  .dd-shell-rail .dd-shell-main {
    margin-left: 72px;
  }
  .dd-shell-main {
    @apply min-w-0 transition-[margin] duration-200;
  }
  .dd-content {
    @apply mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6;
  }

  /* Header */
  .dd-header {
    @apply sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b px-4 sm:px-6;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(8px);
    border-color: var(--border);
    padding-top: env(safe-area-inset-top, 0);
  }
  .dd-icon-btn {
    @apply inline-flex h-9 w-9 items-center justify-center rounded-lg border transition;
    border-color: var(--border);
    background: var(--surface);
    color: var(--text2);
  }
  .dd-icon-btn:hover {
    color: var(--text);
    background: var(--surface2);
  }
  .dd-icon-btn-primary {
    border-color: transparent;
    background: var(--accent2);
    color: #fff;
  }
  .dd-icon-btn-primary:hover {
    background: var(--accent2);
    color: #fff;
    opacity: 0.9;
  }
  .dd-user-btn {
    @apply inline-flex h-9 items-center gap-2 rounded-lg border px-1.5 pr-2.5 transition;
    border-color: var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .dd-avatar {
    @apply inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white;
    background: var(--sidebar-bg);
  }
  .dd-user-menu {
    @apply absolute right-0 top-[calc(100%+6px)] z-50 w-52 overflow-hidden rounded-xl border py-1;
    background: var(--surface);
    border-color: var(--border);
    box-shadow: var(--shadow-md);
  }
  .dd-user-menu-item {
    @apply flex w-full items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-sm transition;
    color: var(--red);
  }
  .dd-user-menu-item:hover {
    background: var(--surface2);
  }

  /* Sidebar */
  .dd-sidebar {
    @apply fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col transition-[width,transform] duration-200;
    background: var(--sidebar-bg);
    color: var(--sidebar-text);
  }
  .dd-sidebar-rail {
    width: 72px;
  }
  .dd-sidebar-drawer {
    transform: translateX(-100%);
    visibility: hidden;
  }
  .dd-sidebar-drawer-open {
    transform: translateX(0);
    visibility: visible;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.35);
  }
  .dd-sidebar-backdrop {
    @apply fixed inset-0 z-40;
    background: rgba(5, 10, 20, 0.5);
  }
  .dd-side-brand {
    @apply flex h-16 shrink-0 items-center gap-2.5 px-4;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .dd-sidebar-rail .dd-side-brand {
    @apply justify-center px-0;
  }
  .dd-side-wordmark {
    @apply truncate text-lg font-bold tracking-tight;
    color: var(--brand-orange);
  }
  .dd-side-scroll {
    @apply flex-1 overflow-y-auto px-3 py-4;
  }
  .dd-side-section + .dd-side-section {
    @apply mt-5;
  }
  .dd-side-heading {
    @apply mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider;
    color: var(--sidebar-muted);
  }
  .dd-side-link {
    @apply relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-underline transition;
    color: var(--sidebar-text);
  }
  .dd-sidebar-rail .dd-side-link {
    @apply justify-center px-0;
  }
  .dd-side-link:hover {
    background: var(--sidebar-hover);
    color: #fff;
  }
  .dd-side-link-active {
    background: var(--sidebar-active);
    color: #fff;
  }
  .dd-side-link-active::before {
    content: '';
    @apply absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r;
    background: var(--brand-orange);
  }
  .dd-side-link-disabled {
    @apply cursor-not-allowed opacity-40;
  }
  .dd-side-link-disabled:hover {
    background: transparent;
    color: var(--sidebar-text);
  }
  .dd-side-badge {
    @apply ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold text-white;
    background: var(--accent2);
  }
  .dd-side-dot {
    @apply absolute right-3 top-1.5 h-2 w-2 rounded-full;
    background: var(--brand-orange);
  }
  .dd-side-children {
    @apply mb-1 ml-[1.375rem] mt-0.5 border-l pl-3;
    border-color: rgba(255, 255, 255, 0.1);
  }
  .dd-side-child {
    @apply block rounded-md px-2.5 py-1.5 text-[13px] no-underline transition;
    color: var(--sidebar-muted);
  }
  .dd-side-child:hover {
    color: #fff;
    background: var(--sidebar-hover);
  }
  .dd-side-child-active {
    color: #fff;
    font-weight: 600;
  }
  .dd-side-collapse {
    @apply m-3 flex items-center justify-center gap-2 rounded-lg border-none bg-transparent px-3 py-2 text-sm transition;
    color: var(--sidebar-muted);
  }
  .dd-side-collapse:hover {
    background: var(--sidebar-hover);
    color: #fff;
  }
```

- [ ] **Step 7: Typecheck, tests and build**

Run: `npm run typecheck; git checkout -- apps/web/tsconfig.tsbuildinfo; npm run test --workspace @pas/web; npm run build:web`
Expected:
- typecheck exits 0;
- all web tests pass;
- `✓ built`;
- `rg "ScrollableTabNav|CLERK_TABS|activeTabFor|dd-mobile-nav|dd-tabs" apps/web/src` returns nothing.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): navy sidebar, greeting header and new app shell replace the tab bar"
```

---

### Task 6: End-to-end browser verification

**Files:** none. This task is verification only; fix-ups go in small follow-up commits.

- [ ] **Step 1: Start local servers**

In two background shells from repo root, run `npm run dev:worker` (waits for "Ready on") and `npm run dev` (waits for "ready in"). Log in at `http://localhost:5173` as `p2check` / `p2check-pass` (role clerk).

- [ ] **Step 2: Clerk pass at desktop (1280×800, light theme)**

Check:
- the sidebar shows Workspace with Dashboard, Classify Invoices, Tariff Search, Product Memory, Reports, then Current job with Upload, Duties & Taxes, Worksheet & Send, Brokerage;
- there is no Suppliers or Settings;
- each link reaches its page;
- the active item has the orange bar;
- Classify Invoices is disabled with no invoices loaded;
- Product Memory opens Learning Rules with no ✕ column and no Clear All;
- the header shows the greeting, counts, Upload Invoice (goes to `/upload`), theme toggle, and user menu (role shows "clerk", Sign out works);
- collapse goes to the icon rail and back, and the choice survives a reload.

- [ ] **Step 3: Admin pass**

Temporarily set the user to admin:

```bash
npx wrangler d1 execute pas-trinidad --local --command "UPDATE users SET role='admin' WHERE username='p2check'"
```

Run it from `apps/worker`, then log out and in again. Check:
- Suppliers and Settings appear;
- Product Memory, Suppliers and Settings expand their sub-pages when active;
- every sub-page loads;
- `/flowboard` and `/asycuda` highlight Brokerage and show the Brokerage sub-nav.

Revert with `UPDATE users SET role='clerk' WHERE username='p2check'`.

- [ ] **Step 4: Tablet (900px) and phone (390px)**

Use `Emulation.setDeviceMetricsOverride` and clear it afterwards. Check:
- **Tablet:** starts as the icon rail; titles show on hover; expanding works.
- **Phone:**
  - the menu button opens the drawer;
  - the backdrop, Escape and navigating each close it;
  - focus returns to the menu button;
  - Tab cycles inside the drawer;
  - there is no bottom bar, and page content is not covered.

- [ ] **Step 5: Dark theme and keyboard**

Toggle dark and repeat a quick look at the Dashboard, Classify and Learning Rules pages. Then use the keyboard only: Tab from page load shows "Skip to content" first, every sidebar link and header control shows a visible focus ring, and Enter activates it. Do not exercise Brokerage, FlowBoard or ASYCUDA sends.

- [ ] **Step 6: Final suites and stop servers**

Run: `npm run typecheck; git checkout -- apps/web/tsconfig.tsbuildinfo; npm test`
Expected: everything passes. Stop only the dev-server processes you started (`taskkill /T /F /PID <pid>`).
