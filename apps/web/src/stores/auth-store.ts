import { create } from "zustand";
import type { SessionUser } from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { clearLocalSessionData } from "@/lib/session-reset";
import { flushJobAutosave } from "@/lib/job-sync";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error: string;
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: "",
  checkSession: async () => {
    set({ loading: true, error: "" });
    try {
      const user = await api.me();
      set({ user, loading: false });
    } catch {
      clearLocalSessionData();
      set({ user: null, loading: false });
    }
  },
  login: async (username, password) => {
    set({ error: "" });
    try {
      clearLocalSessionData();
      const user = await api.login(username, password);
      set({ user });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Login failed" });
      return false;
    }
  },
  logout: async () => {
    try {
      await flushJobAutosave().catch(() => null);
      await api.logout();
    } finally {
      clearLocalSessionData();
      set({ user: null, error: "" });
    }
  },
}));
