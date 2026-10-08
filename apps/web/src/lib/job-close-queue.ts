import type { DutyDeskJobType } from "@pas/shared-types";

/** Survives logout on purpose: a sent job must be closed on the server even if the clerk signs out first. */
export const PENDING_JOB_CLOSE_KEY = "dutydesk-pending-job-close";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PendingJobClose =
  | { jobId: string; status: "sent"; jobType: DutyDeskJobType; worksheetNum: string }
  | { jobId: string; status: "abandoned" };

export function readPendingCloses(storage: KeyValueStorage): PendingJobClose[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PENDING_JOB_CLOSE_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as PendingJobClose[]) : [];
  } catch {
    return [];
  }
}

function write(storage: KeyValueStorage, entries: PendingJobClose[]) {
  storage.setItem(PENDING_JOB_CLOSE_KEY, JSON.stringify(entries));
}

export function enqueuePendingClose(storage: KeyValueStorage, entry: PendingJobClose) {
  const entries = readPendingCloses(storage);
  const index = entries.findIndex((e) => e.jobId === entry.jobId);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  write(storage, entries);
}

export function removePendingClose(storage: KeyValueStorage, jobId: string) {
  write(storage, readPendingCloses(storage).filter((e) => e.jobId !== jobId));
}
