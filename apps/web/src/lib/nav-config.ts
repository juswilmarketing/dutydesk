export type TabDef = {
  to: string;
  label: string;
  short: string;
  icon: string;
  badge?: "invoices" | "flowboard" | "reports";
  requiresInvoices?: boolean;
  adminOnly?: boolean;
  /** Extra path prefixes that highlight this tab. */
  matches?: readonly string[];
};

export const BROKERAGE_LINKS = [
  { to: "/brokerage", label: "Brokerage calculator" },
  { to: "/flowboard", label: "FlowBoard" },
  { to: "/asycuda", label: "ASYCUDA" },
] as const;

export const CLERK_TABS: TabDef[] = [
  { to: "/dashboard", label: "Dashboard", short: "Home", icon: "📊" },
  { to: "/upload", label: "Upload", short: "Upload", icon: "📄" },
  { to: "/classification", label: "Classify", short: "Classify", icon: "📋", badge: "invoices", requiresInvoices: true },
  { to: "/duties-taxes", label: "Duties & Taxes", short: "Taxes", icon: "🧮" },
  { to: "/worksheet", label: "Worksheet & Send", short: "Send", icon: "📝" },
  { to: "/manual", label: "Manual", short: "Manual", icon: "✏️" },
  {
    to: "/brokerage",
    label: "Brokerage",
    short: "Broker",
    icon: "⚓",
    badge: "flowboard",
    matches: BROKERAGE_LINKS.map((l) => l.to),
  },
];

export function isBrokeragePath(pathname: string): boolean {
  return BROKERAGE_LINKS.some((l) => pathname.startsWith(l.to));
}

export function activeTabFor(pathname: string, tabs: readonly TabDef[]): TabDef | undefined {
  return tabs.find((t) => [t.to, ...(t.matches || [])].some((p) => pathname.startsWith(p)));
}
