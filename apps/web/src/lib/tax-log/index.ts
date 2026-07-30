const TAX_LOG_KEY = "dutydesk_tax_log_v1";

import type { TaxLogEntry } from "@pas/shared-types";

export function loadTaxLog(): TaxLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(TAX_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveTaxLog(log: TaxLogEntry[]) {
  localStorage.setItem(TAX_LOG_KEY, JSON.stringify(log.slice(0, 500)));
}

export function clearTaxLog() {
  localStorage.removeItem(TAX_LOG_KEY);
}

export function appendTaxLog(entry: Omit<TaxLogEntry, "id">) {
  const newEntry: TaxLogEntry = { ...entry, id: `log_${Date.now()}` };
  const local = loadTaxLog();
  local.unshift(newEntry);
  saveTaxLog(local);
  return newEntry;
}

export function mergeTaxLogs(local: TaxLogEntry[], remote: TaxLogEntry[]): TaxLogEntry[] {
  return [...local, ...remote]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, 500);
}
