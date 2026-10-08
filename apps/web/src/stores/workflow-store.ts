import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ApprovedTaxSheet,
  BrokerageInputs,
  Consignee,
  TaxInputs,
  TaxLogEntry,
} from "@pas/shared-types";
import { defaultBrokerageInputs } from "@/lib/brokerage";
import { DEFAULT_TAX_INPUTS } from "@/lib/workflow-defaults";
import { loadTaxLog, saveTaxLog } from "@/lib/tax-log";
import { scheduleConsigneePush } from "@/lib/workflow-sync";

interface WorkflowState {
  consignees: Consignee[];
  activeConsigneeId: string | null;
  approvedTaxSheet: ApprovedTaxSheet | null;
  taxInputs: TaxInputs;
  brokerageInputs: BrokerageInputs;
  ccBrokerage: boolean;
  taxLog: TaxLogEntry[];
  /** Server id of the job being edited; a closed id makes the server reject saves instead of reopening it. */
  serverJobId: string | null;
  setConsignees: (list: Consignee[]) => void;
  addConsignee: (entry: Omit<Consignee, "id">) => void;
  updateConsignee: (id: string, updated: Partial<Consignee>) => void;
  removeConsignee: (id: string) => void;
  setActiveConsigneeId: (id: string | null) => void;
  getActiveConsignee: () => Consignee | null;
  setApprovedTaxSheet: (sheet: ApprovedTaxSheet | null) => void;
  setTaxInputs: (fn: (prev: TaxInputs) => TaxInputs) => void;
  setBrokerageInputs: (fn: (prev: BrokerageInputs) => BrokerageInputs) => void;
  toggleCcBrokerage: (val: boolean) => void;
  refreshTaxLog: () => void;
  setTaxLog: (log: TaxLogEntry[]) => void;
  setServerJobId: (id: string | null) => void;
  resetSession: () => void;
  /** Clear the active job only; keeps consignee list and tax log. */
  clearJob: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      consignees: [],
      activeConsigneeId: null,
      approvedTaxSheet: null,
      taxInputs: { ...DEFAULT_TAX_INPUTS },
      brokerageInputs: defaultBrokerageInputs(),
      ccBrokerage: true,
      taxLog: loadTaxLog(),
      serverJobId: null,
      setConsignees: (list) => set({ consignees: list.map((c) => ({ ...c, phone: c.phone || "", email: c.email || "" })) }),
      addConsignee: (entry) => {
        const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        set((s) => {
          const consignees = [...s.consignees, { ...entry, id, updatedAt: now }];
          scheduleConsigneePush(consignees);
          return { consignees };
        });
      },
      updateConsignee: (id, updated) => {
        const now = new Date().toISOString();
        set((s) => {
          const consignees = s.consignees.map((c) =>
            c.id === id ? { ...c, ...updated, updatedAt: now } : c,
          );
          scheduleConsigneePush(consignees);
          return { consignees };
        });
      },
      removeConsignee: (id) => {
        set((s) => {
          const consignees = s.consignees.filter((c) => c.id !== id);
          scheduleConsigneePush(consignees);
          return {
            consignees,
            activeConsigneeId: s.activeConsigneeId === id ? null : s.activeConsigneeId,
          };
        });
      },
      setActiveConsigneeId: (id) => set({ activeConsigneeId: id }),
      getActiveConsignee: () => {
        const { consignees, activeConsigneeId } = get();
        return consignees.find((c) => c.id === activeConsigneeId) || null;
      },
      setApprovedTaxSheet: (sheet) => set({ approvedTaxSheet: sheet }),
      setTaxInputs: (fn) => set((s) => ({ taxInputs: fn(s.taxInputs) })),
      setBrokerageInputs: (fn) => set((s) => ({ brokerageInputs: fn(s.brokerageInputs) })),
      toggleCcBrokerage: (val) => set({ ccBrokerage: val }),
      refreshTaxLog: () => set({ taxLog: loadTaxLog() }),
      setTaxLog: (log) => {
        saveTaxLog(log);
        set({ taxLog: log });
      },
      setServerJobId: (id) => set({ serverJobId: id }),
      resetSession: () => {
        set({
          consignees: [],
          activeConsigneeId: null,
          approvedTaxSheet: null,
          taxInputs: { ...DEFAULT_TAX_INPUTS },
          brokerageInputs: defaultBrokerageInputs(),
          ccBrokerage: true,
          taxLog: [],
          serverJobId: null,
        });
      },
      clearJob: () =>
        set({
          activeConsigneeId: null,
          approvedTaxSheet: null,
          taxInputs: { ...DEFAULT_TAX_INPUTS },
          brokerageInputs: defaultBrokerageInputs(),
          serverJobId: null,
        }),
    }),
    {
      name: "dutydesk-workflow-v1",
      partialize: (s) => ({
        consignees: s.consignees,
        activeConsigneeId: s.activeConsigneeId,
        taxInputs: s.taxInputs,
        brokerageInputs: s.brokerageInputs,
        ccBrokerage: s.ccBrokerage,
        serverJobId: s.serverJobId,
      }),
    },
  ),
);
