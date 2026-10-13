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

export const BROKERAGE_LINKS = [
  { to: "/brokerage", label: "Brokerage calculator" },
  { to: "/flowboard", label: "FlowBoard" },
  { to: "/asycuda", label: "ASYCUDA" },
] as const;

export function isBrokeragePath(pathname: string): boolean {
  return BROKERAGE_LINKS.some((l) => pathname.startsWith(l.to));
}

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
