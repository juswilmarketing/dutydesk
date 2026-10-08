import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Invoice, LearnedEntry, ExchangeRate, ItemExemptions, SupplierClassificationEntry } from "@pas/shared-types";
import type { SupplierHistoryRow } from "@pas/tariff-data";

interface InvoiceState {
  invoices: Invoice[];
  activeInvId: number | null;
  learnedMap: Record<string, LearnedEntry>;
  supplierHistory: SupplierHistoryRow[];
  exchangeRate: ExchangeRate | null;
  itemExemptions: Record<number, ItemExemptions>;
  setInvoices: (fn: (prev: Invoice[]) => Invoice[]) => void;
  setActiveInvId: (id: number | null) => void;
  setLearnedMap: (entries: LearnedEntry[]) => void;
  setSupplierHistory: (entries: SupplierClassificationEntry[]) => void;
  setExchangeRate: (rate: ExchangeRate | null) => void;
  toggleExemption: (id: number, field: keyof ItemExemptions) => void;
  resetSession: () => void;
  /** Clear the active job only; keeps learned map, supplier history and exchange rate. */
  clearJob: () => void;
}

export const useInvoiceStore = create<InvoiceState>()(
  persist(
    (set) => ({
      invoices: [],
      activeInvId: null,
      learnedMap: {},
      supplierHistory: [],
      exchangeRate: null,
      itemExemptions: {},
      setInvoices: (fn) => set((s) => ({ invoices: fn(s.invoices) })),
      setActiveInvId: (id) => set({ activeInvId: id }),
      setLearnedMap: (entries) =>
        set({
          learnedMap: Object.fromEntries(entries.map((e) => [e.normalized_desc, e])),
        }),
      setSupplierHistory: (entries) =>
        set({
          supplierHistory: entries.map((e) => ({
            id: e.id,
            supplier_name: e.supplier_name,
            normalized_supplier_name: e.normalized_supplier_name,
            item_description: e.item_description,
            normalized_description: e.normalized_description,
            part_number: e.part_number,
            model_number: e.model_number,
            hs_code: e.hs_code,
            tariff_description: e.tariff_description,
            duty_rate: e.duty_rate,
            vat_rate: e.vat_rate,
            confidence: e.confidence,
            match_type: e.match_type,
            approved_by_clerk: e.approved_by_clerk,
            usage_count: e.usage_count,
            last_used_at: e.last_used_at,
            disabled: e.disabled,
          })),
        }),
      setExchangeRate: (rate) => set({ exchangeRate: rate }),
      toggleExemption: (id, field) =>
        set((s) => ({
          itemExemptions: {
            ...s.itemExemptions,
            [id]: { ...s.itemExemptions[id], [field]: !s.itemExemptions[id]?.[field] },
          },
        })),
      resetSession: () =>
        set({
          invoices: [],
          activeInvId: null,
          learnedMap: {},
          supplierHistory: [],
          exchangeRate: null,
          itemExemptions: {},
        }),
      clearJob: () =>
        set({
          invoices: [],
          activeInvId: null,
          itemExemptions: {},
        }),
    }),
    {
      name: "pas-invoices-v2",
      partialize: (s) => ({
        invoices: s.invoices,
        activeInvId: s.activeInvId,
        itemExemptions: s.itemExemptions,
      }),
    },
  ),
);
