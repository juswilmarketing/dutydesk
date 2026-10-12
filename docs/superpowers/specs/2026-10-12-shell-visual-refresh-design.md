# Shell and Visual Refresh — Design

Date: 2026-10-12
Status: Approved in brainstorming; awaiting spec review

## Context

The "Premium Dashboard Redesign" brief was split into four sub-projects, each with its own spec, plan and build:

1. **Shell and visual refresh** (this spec): sidebar, header, palette, shared component styling. No new data.
2. Dashboard on existing data: summary cards, items-needing-attention table, classification donut, quick actions.
3. Job history and activity: jobs list endpoint, saved last-reviewed line, audit-based activity feed, recent-invoices and activity widgets.
4. Global search and notifications.

The brief's reference image is illustrative only. Colors below are a proposal, to be tuned against the image when it is supplied. No names, counts, dates or codes from the image are used.

## Goals

- Replace the horizontal tab bar with a collapsible, role-aware navy sidebar.
- Replace the header with a greeting, an Upload Invoice button, the theme toggle and a user menu.
- Make light the default theme and refresh both themes to a premium SaaS look.
- Keep every route, URL, route guard, workflow, classification rule, tariff data and saved job unchanged.

## Non-goals

- Dashboard content changes (sub-project 2).
- Global search box and notifications bell. They are not rendered until sub-project 4 builds them, so no dead UI ships.
- Per-page redesigns. Pages pick up the new palette through shared variables and classes only.
- New dependencies. `lucide-react` is already installed.

## Navigation

### Structure

Two groups in the sidebar.

**Workspace**

| Item | Route | Who |
|---|---|---|
| Dashboard | `/dashboard` | All |
| Classify Invoices | `/classification` (disabled with tooltip when no invoice is loaded, as today) | All |
| Tariff Search | `/manual` | All |
| Product Memory | `/learned` | All (clerks see Learning Rules only) |
| Reports | `/reports` | All |
| Suppliers | `/admin/supplier-history` | Admin |
| Settings | `/users` | Admin |

**Current job**

| Item | Route | Matches |
|---|---|---|
| Upload | `/upload` | |
| Duties & Taxes | `/duties-taxes` | |
| Worksheet & Send | `/worksheet` | |
| Brokerage | `/brokerage` | `/flowboard`, `/asycuda` |

Classify is not repeated in this group because Classify Invoices already opens `/classification`. The existing Brokerage sub-nav (Brokerage calculator, FlowBoard, ASYCUDA) stays above page content on brokerage paths.

### Admin sub-items

Sub-items appear indented under their section, shown only to admins. The section expands automatically when one of its routes is active.

- **Product Memory:** Learning Rules `/learned`, Products `/admin/product-dictionary`, Profiles `/admin/product-profiles`, Industries `/admin/industry-dictionary`, Brands `/admin/brand-dictionary`, Attribute Library `/admin/attribute-library`, Liquid Composition `/admin/liquid-composition`, Abbreviations `/admin/abbreviations`, Learning Stats `/admin/learning-stats`.
- **Suppliers:** History `/admin/supplier-history`, Catalogue `/admin/supplier-catalogue`, Intelligence `/admin/supplier-intelligence`.
- **Settings:** Users `/users`, Integrations `/admin/integrations`, Questions `/admin/question-rules`, Chapter Rules `/admin/chapter-rules`.

Every admin page that has a tab today keeps a nav entry.

### Behaviour

- Icons are Lucide icons, replacing emoji.
- Active item: orange left bar plus a subtle highlight. Active matching uses the item route plus its `matches` prefixes. On a sub-route the section and the sub-item are both marked.
- Badges are kept: the Classify Invoices invoice count, the Brokerage FlowBoard count, and the Reports tax-log count.
- **Desktop, 1024px and wider:** expanded sidebar about 248px wide. A collapse button shrinks it to a 72px icon rail with tooltips. The collapsed state is remembered per browser.
- **Tablet, 768 to 1023px:** starts as the icon rail and can be expanded.
- **Phone, under 768px:** the sidebar becomes a slide-out drawer opened from a menu button in the header. The drawer closes on navigation, on Escape and on backdrop click. The bottom phone bar is removed.
- **Keyboard:** all items are focusable links. The collapse button and the drawer have accessible names. Focus is trapped in the open drawer and returned to the menu button on close. A skip-to-content link is added.

## Header

The header sits at the top of the content area, next to the sidebar.

- Left: a greeting by time of day plus the user's first name ("Good afternoon, P2"). Below it, a muted line with the tariff entry count and the invoice count, which replaces today's header pill.
- Right: the **Upload Invoice** primary button (navigates to `/upload`), the theme toggle, and a user menu showing the name and role with Sign out.
- Phone: the menu button, compact logo, Upload icon button and user menu.

`JobSaveIndicator` stays at the top of `<main>`. The footer is removed; its tariff count moves to the header line.

## Visual system

### Light theme (default)

| Token | Value |
|---|---|
| Page background | `#F4F6FA` |
| Card surface | `#FFFFFF`, 1px `#E4E8EF` border, soft shadow, 12px radius |
| Text | `#0F1B2D` |
| Muted text | `#5B6B82` |
| Sidebar | `#0B1A33`, light text, active item with orange bar |

### Dark theme

The same structure: dark navy page, slightly lighter card surface, the same navy sidebar, softer borders and shadows.

### Status colors

Used consistently everywhere and mapped onto existing variables, so current pages follow along:

| Meaning | Variable | Light value |
|---|---|---|
| Primary action | `--accent2` | `#F26B1D` |
| In progress | `--accent` | blue |
| Completed / approved | `--green` | green |
| Needs review | `--gold` | amber |
| Genuine error | `--red` | red |

Orange is reserved for primary actions.

### Typography

Geist stays. Page title 24px semibold, card title 14px semibold, body 14px, table text 13 to 14px. Codes and amounts use tabular numbers.

### Shared components

These are restyled once and pages inherit the changes:

- metric cards (`dd-metric-card*`);
- status badges (pill style);
- buttons: primary orange, secondary outline, ghost;
- inputs;
- tables: sticky header, row hover, no zebra striping;
- banners: quieter, with a thin left accent instead of a full color fill.

### Accessibility

Visible focus rings on every interactive control, text contrast of at least 4.5:1 in both themes, and the skip-to-content link.

## Architecture

- `apps/web/src/lib/nav-config.ts`: `NAV_SECTIONS` replaces `CLERK_TABS` and the `adminTabs` list in `AppShell.tsx`. Each item has route, label, Lucide icon, `adminOnly`, optional badge, optional `requiresInvoices`, optional `matches`, and optional `children`. Pure helpers:
  - `visibleNav(role)` filters by role, including children;
  - `activeNavFor(pathname, sections)` returns the active item and its parent section.
- `apps/web/src/components/layout/Sidebar.tsx`: renders the sections and handles collapse, the drawer and tooltips.
- `apps/web/src/components/layout/AppHeader.tsx`: greeting, counts line, Upload button, theme toggle, user menu.
- `apps/web/src/app/AppShell.tsx`: a thin layout combining Sidebar, AppHeader, the Brokerage sub-nav and `<main>`. `ScrollableTabNav` and the bottom phone bar are deleted if nothing else uses them.
- `apps/web/src/stores/theme-store.ts`: default theme becomes `light` for users with no saved choice, and it gains a persisted `sidebarCollapsed`.
- `apps/web/src/styles/globals.css`: updated light and dark variables, plus sidebar, header and refreshed shared `dd-*` classes.
- `apps/web/src/lib/nav-tips.ts`: tooltips keyed by the new routes where useful.

Route guards in `App.tsx` are unchanged. The sidebar hides admin items, but the guards remain the real permission check.

### Product Memory permissions

Clerks get read-only Learning Rules.

- `LearnedPage.tsx` hides the per-row Delete and the Clear all button for non-admins.
- `apps/worker/src/routes/learned.ts` rejects `DELETE /:key` and `DELETE /` with 403 for non-admins, using the existing admin check from the worker auth middleware.
- `POST /` stays open to all roles, because classification saves learned rules on a clerk's behalf.

## Error handling and edge cases

- With no invoices loaded, Classify Invoices is disabled with the existing "upload an invoice first" tooltip.
- A user whose saved theme is dark keeps dark.
- If the saved sidebar state is missing or invalid, it falls back to expanded on desktop.
- An unknown route still redirects to `/dashboard`, as today.

## Testing

- **Unit (vitest):**
  - `visibleNav` gives clerks no admin items or children and gives admins everything.
  - `activeNavFor` handles `/flowboard` and `/asycuda/...` (Brokerage), `/admin/product-profiles` (Product Memory and Profiles), `/learned`, and an unknown path.
  - Every nav route exists in `App.tsx`'s route list. A shared route list is exported if needed.
  - The theme store defaults to light when nothing is saved.
  - In the worker, a clerk gets 403 on the learned DELETE routes and an admin gets success.
- **Existing suites:** the web, worker and package tests, plus `npm run typecheck`.
- **Browser pass, local:** desktop 1280px, tablet 900px and phone 390px, in both themes, signed in as clerk and as admin. Covers collapse and expand, the drawer, every nav item reaching its page, keyboard-only navigation and focus visibility. Brokerage, FlowBoard and ASYCUDA sends are not exercised.

## Success criteria

- Every page in the app is reachable from the sidebar by the roles that can reach it today.
- Clerks never see Suppliers, Settings or admin sub-items.
- Light is the default and dark works. Both pass the contrast and focus checks.
- No change to classification, tariff data, saved jobs or route guards. The one intended permission change is that clerks can no longer delete learned rules. The existing tests pass.
