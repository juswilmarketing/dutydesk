import { clearTaxLog } from "@/lib/tax-log";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";

/** Browser keys written by DutyDesk (not consignees on D1 — those stay on the server). */
const SESSION_STORAGE_KEYS = [
  "dutydesk-workflow-v1",
  "dutydesk_tax_log_v1",
  "pas-invoices-v2",
] as const;

/**
 * Wipe per-session browser data so the next user on this device does not see
 * the previous user's invoices, tax drafts, or cached consignee list.
 * Team consignees + tax log remain in D1 and reload on next login via sync.
 */
export function clearLocalSessionData() {
  clearTaxLog();

  useWorkflowStore.getState().resetSession();
  useInvoiceStore.getState().resetSession();

  useWorkflowStore.persist.clearStorage();
  useInvoiceStore.persist.clearStorage();

  for (const key of SESSION_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }

  sessionStorage.clear();
}

/** Clear the current job after it is sent or abandoned, without signing out. */
export function clearActiveJob() {
  useInvoiceStore.getState().clearJob();
  useWorkflowStore.getState().clearJob();
}
