import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { getTariffCount } from '@pas/tariff-data';
import { useInvoiceStore } from '@/stores/invoice-store';
import { useWorkflowStore } from '@/stores/workflow-store';
import { DutyDeskLogo } from '@/components/brand/DutyDeskLogo';
import { NAV_TAB_TIPS } from '@/lib/nav-tips';
import { Tooltip } from '@/components/ui/Tooltip';
import { dashboardMetrics } from '@/lib/workflow-pipeline';
import { ScrollableTabNav } from '@/components/layout/ScrollableTabNav';
import { JobSaveIndicator } from '@/components/workflow/JobSaveIndicator';

type TabDef = {
  to: string;
  label: string;
  short: string;
  icon: string;
  badge?: 'invoices' | 'flowboard' | 'reports';
  requiresInvoices?: boolean;
  adminOnly?: boolean;
};

const clerkTabs: TabDef[] = [
  { to: '/dashboard', label: 'Dashboard', short: 'Home', icon: '📊' },
  { to: '/upload', label: 'Upload', short: 'Upload', icon: '📄' },
  { to: '/classification', label: 'Classification', short: 'Classify', icon: '📋', badge: 'invoices', requiresInvoices: true },
  { to: '/manual', label: 'Manual', short: 'Manual', icon: '✏️' },
  { to: '/duties-taxes', label: 'Duties & Taxes', short: 'Taxes', icon: '🧮' },
  { to: '/worksheet', label: 'Worksheet', short: 'Sheet', icon: '📝' },
  { to: '/brokerage', label: 'Brokerage', short: 'Broker', icon: '⚓' },
  { to: '/flowboard', label: 'FlowBoard', short: 'Flow', icon: '🔀', badge: 'flowboard' },
  { to: '/asycuda', label: 'ASYCUDA', short: 'ASYCUDA', icon: '🛃' },
];

const adminTabs: TabDef[] = [
  { to: '/reports', label: 'Reports', short: 'Reports', icon: '📊', badge: 'reports', adminOnly: true },
  { to: '/users', label: 'Admin', short: 'Admin', icon: '👥', adminOnly: true },
  { to: '/learned', label: 'Learning Rules', short: 'Rules', icon: '🧠', adminOnly: true },
  { to: '/admin/supplier-history', label: 'Supplier History', short: 'Suppliers', icon: '🏭', adminOnly: true },
  { to: '/admin/product-dictionary', label: 'Products', short: 'Products', icon: '📦', adminOnly: true },
  { to: '/admin/industry-dictionary', label: 'Industries', short: 'Industry', icon: '🏷', adminOnly: true },
  { to: '/admin/brand-dictionary', label: 'Brands', short: 'Brands', icon: '✨', adminOnly: true },
  { to: '/admin/supplier-intelligence', label: 'Supplier Intel', short: 'Intel', icon: '📡', adminOnly: true },
  { to: '/admin/product-profiles', label: 'Profiles', short: 'Profiles', icon: '🧬', adminOnly: true },
  { to: '/admin/question-rules', label: 'Questions', short: 'Q Rules', icon: '❓', adminOnly: true },
  { to: '/admin/chapter-rules', label: 'Chapter Rules', short: 'Chapters', icon: '📚', adminOnly: true },
  { to: '/admin/learning-stats', label: 'Learning Stats', short: 'Stats', icon: '📈', adminOnly: true },
  { to: '/admin/attribute-library', label: 'Attribute Library', short: 'Attrs', icon: '🧩', adminOnly: true },
  { to: '/admin/liquid-composition', label: 'Liquid Composition', short: 'Liquids', icon: '🧪', adminOnly: true },
  { to: '/admin/abbreviations', label: 'Abbreviations', short: 'Abbrev', icon: '🔤', adminOnly: true },
  { to: '/admin/supplier-catalogue', label: 'Supplier Catalogue', short: 'Catalogue', icon: '📇', adminOnly: true },
  { to: '/admin/integrations', label: 'Integrations', short: 'Integr.', icon: '⚙️', adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const invoiceCount = useInvoiceStore((s) => s.invoices.length);
  const invoices = useInvoiceStore((s) => s.invoices);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const location = useLocation();
  const isAdmin = user?.role === 'admin';
  const tabs: TabDef[] = isAdmin ? [...clerkTabs, ...adminTabs] : clerkTabs;
  const metrics = dashboardMetrics(invoices, taxLog, taxInputs);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const badgeFor = (tab: TabDef) => {
    if (tab.badge === 'invoices') return invoiceCount;
    if (tab.badge === 'flowboard') return metrics.sentFlowboard + metrics.readyFlowboard;
    if (tab.badge === 'reports') return taxLog.length;
    return 0;
  };

  const activeTab = tabs.find((t) => location.pathname.startsWith(t.to));

  const tabTip = (tab: TabDef, disabled?: boolean) => {
    const base = NAV_TAB_TIPS[tab.to] || tab.label;
    return disabled ? `${base} (upload an invoice first)` : base;
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header
        className="dd-app-header sticky top-0 z-50 border-b"
        style={{ background: 'var(--header-bg)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-3 px-3 sm:gap-4 sm:px-6">
          <div className="dd-header-brand">
            <DutyDeskLogo variant="header" />
          </div>

          <div className="flex items-center gap-2">
            <span
              className="header-stats hidden rounded-full border px-4 py-1.5 text-sm lg:inline"
              style={{ borderColor: 'var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}
            >
              {getTariffCount().toLocaleString()} entries · {invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''}
            </span>

            <div
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 sm:px-3"
              style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
            >
              <span className="header-user-name max-w-[140px] truncate text-sm sm:max-w-[180px]" style={{ color: 'var(--text2)' }}>
                {user?.name}
              </span>
              <Tooltip content={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex h-9 w-9 items-center justify-center rounded-md border-none transition hover:opacity-80"
                  style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </Tooltip>
              <Tooltip content="Sign out and clear your session data from this browser">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="flex h-9 w-9 items-center justify-center rounded-md border-none transition hover:opacity-80 sm:w-auto sm:px-3"
                  style={{ background: 'var(--red-light)', color: 'var(--red)' }}
                >
                  <LogOut size={18} />
                  <span className="hidden text-sm font-semibold sm:ml-1.5 sm:inline">Sign out</span>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </header>

      <div className="main-wrap mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
        <ScrollableTabNav activeKey={activeTab?.to}>
          {tabs.map((tab) => {
            const badgeCount = badgeFor(tab);
            const disabled = tab.requiresInvoices && invoiceCount === 0;
            const tip = tabTip(tab, disabled);

            if (disabled) {
              return (
                <Tooltip key={tab.to} content={tip} className="shrink-0">
                  <button type="button" disabled className="dd-tab" data-tab-key={tab.to}>
                    <span className="mr-1.5 text-base">{tab.icon}</span>
                    {tab.label}
                  </button>
                </Tooltip>
              );
            }

            return (
              <Tooltip key={tab.to} content={tip} wide className="shrink-0">
                <NavLink
                  to={tab.to}
                  data-tab-key={tab.to}
                  className={({ isActive }) => cn('dd-tab no-underline', isActive && 'dd-tab-active')}
                >
                  <span className="mr-1.5 text-base">{tab.icon}</span>
                  {tab.label}
                  {badgeCount > 0 && <span className="dd-tab-badge">{badgeCount}</span>}
                </NavLink>
              </Tooltip>
            );
          })}
        </ScrollableTabNav>

        <main className="min-w-0">
          <JobSaveIndicator />
          {children}
        </main>

        <footer className="dd-notif-info mt-6 text-center sm:text-left">
          <strong>Duty Desk</strong> — customs worksheet preparation · Customer delivery via{' '}
          <strong>FlowBoard</strong> · {getTariffCount().toLocaleString()} T&amp;T tariff entries
        </footer>
      </div>

      <nav className="dd-mobile-nav" aria-label="Mobile navigation">
        {tabs.map((tab) => {
          const badgeCount = badgeFor(tab);
          const disabled = tab.requiresInvoices && invoiceCount === 0;
          const isActive = activeTab?.to === tab.to;

          if (disabled) {
            return (
              <button key={tab.to} type="button" disabled className="dd-mobile-tab opacity-40" title={tabTip(tab, true)}>
                <span className="text-lg leading-none">{tab.icon}</span>
                <span>{tab.short}</span>
              </button>
            );
          }

          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              title={tabTip(tab)}
              className={cn('dd-mobile-tab', isActive && 'dd-mobile-tab-active')}
            >
              <span className="relative text-lg leading-none">
                {tab.icon}
                {badgeCount > 0 && (
                  <span
                    className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white"
                    style={{ background: 'var(--accent2)' }}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </span>
              <span className="max-w-[4.5rem] truncate text-center leading-tight">{tab.short}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
