import type { Consignee, TaxLogEntry } from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { loadTaxLog, mergeTaxLogs } from "@/lib/tax-log";
import { useWorkflowStore } from "@/stores/workflow-store";

let consigneePushTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeConsignee(entry: Consignee): Consignee {
  return {
    ...entry,
    code: entry.code || "",
    email: entry.email || "",
    phone: entry.phone || "",
    address: entry.address || "",
    updatedAt: entry.updatedAt || "",
  };
}

export function mergeConsignees(local: Consignee[], remote: Consignee[]): Consignee[] {
  const map = new Map<string, Consignee>();
  for (const entry of [...remote, ...local].map(normalizeConsignee)) {
    const existing = map.get(entry.id);
    if (!existing) {
      map.set(entry.id, entry);
      continue;
    }
    const existingAt = existing.updatedAt || "";
    const entryAt = entry.updatedAt || "";
    map.set(entry.id, entryAt >= existingAt ? entry : existing);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function pushMissingTaxLogEntries(merged: TaxLogEntry[], remote: TaxLogEntry[]) {
  const remoteIds = new Set(remote.map((e) => e.id));
  const missing = merged.filter((e) => !remoteIds.has(e.id));
  await Promise.all(missing.map((entry) => api.appendTaxLogRemote(entry).catch(() => null)));
}

export async function pushTaxLogEntry(entry: TaxLogEntry) {
  await api.appendTaxLogRemote(entry);
}

export function scheduleConsigneePush(consignees: Consignee[]) {
  if (consigneePushTimer) clearTimeout(consigneePushTimer);
  consigneePushTimer = setTimeout(() => {
    api.saveConsignees(consignees).catch(() => null);
  }, 300);
}

export async function syncConsigneesNow(consignees?: Consignee[]) {
  const list = consignees ?? useWorkflowStore.getState().consignees;
  await api.saveConsignees(list);
}

/** Pull remote workflow data, merge with local, push updates back to D1. */
export async function syncTeamWorkflow(): Promise<void> {
  const store = useWorkflowStore.getState();
  const localConsignees = store.consignees;
  const localLog = store.taxLog.length ? store.taxLog : loadTaxLog();

  const [consigneesRes, taxLogRes] = await Promise.all([
    api.getConsignees().catch(() => ({ consignees: [] as Consignee[] })),
    api.getTaxLog().catch(() => ({ entries: [] as TaxLogEntry[] })),
  ]);

  const mergedConsignees = mergeConsignees(localConsignees, consigneesRes.consignees);
  const mergedLog = mergeTaxLogs(localLog, taxLogRes.entries);

  store.setConsignees(mergedConsignees);
  store.setTaxLog(mergedLog);

  await Promise.all([
    api.saveConsignees(mergedConsignees).catch(() => null),
    pushMissingTaxLogEntries(mergedLog, taxLogRes.entries),
  ]);
}
