import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
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
    const itemCurrent = isActive ? (active?.child ? "true" : "page") : undefined;
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
          <Link
            to={item.to}
            title={rail ? item.label : tip}
            aria-current={itemCurrent}
            className={cn("dd-side-link", isActive && "dd-side-link-active")}
          >
            {content}
            {rail && <span className="sr-only">{item.label}</span>}
          </Link>
        )}
        {!rail && isActive && item.children && item.children.length > 0 && (
          <ul className="dd-side-children">
            {item.children.map((child) => (
              <li key={child.to}>
                <Link
                  to={child.to}
                  aria-current={active?.child === child ? "page" : undefined}
                  className={cn("dd-side-child", active?.child === child && "dd-side-child-active")}
                >
                  {child.label}
                </Link>
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
        <img
          src={DUTY_DESK_LOGO_SRC}
          alt=""
          aria-hidden
          className="h-9 w-[34px] shrink-0 object-cover object-left"
        />
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
