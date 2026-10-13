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
