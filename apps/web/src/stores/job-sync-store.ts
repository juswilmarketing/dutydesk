import { create } from "zustand";

export type JobSaveState = "idle" | "saving" | "saved" | "error" | "closed";

interface JobSyncState {
  saveState: JobSaveState;
  error: string;
  setSaveState: (saveState: JobSaveState, error?: string) => void;
}

export const useJobSyncStore = create<JobSyncState>((set) => ({
  saveState: "idle",
  error: "",
  setSaveState: (saveState, error = "") => set({ saveState, error }),
}));
