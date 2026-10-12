import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  /** null = choose by screen width (expanded on desktop, rail on tablet). */
  sidebarCollapsed: boolean | null;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

type PersistedTheme = Partial<Pick<ThemeState, 'theme' | 'sidebarCollapsed'>>;

export function sanitizePersistedTheme(persisted: unknown): PersistedTheme {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const saved = persisted as Record<string, unknown>;
  const result: PersistedTheme = {
    sidebarCollapsed: typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : null,
  };
  if (saved.theme === 'dark' || saved.theme === 'light') result.theme = saved.theme;
  return result;
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
    {
      name: 'dutydesk-theme',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedTheme(persisted) }),
    },
  ),
);
