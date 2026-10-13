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
