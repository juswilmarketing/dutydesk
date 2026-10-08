import type { ApprovedTaxSheet, BrokerageInputs, Invoice, ItemExemptions, TaxInputs } from "@pas/shared-types";

/** The per-job slice of the invoice + workflow stores that is saved to the server. */
export interface JobState {
  invoices: Invoice[];
  activeInvId: number | null;
  itemExemptions: Record<number, ItemExemptions>;
  taxInputs: TaxInputs;
  brokerageInputs: BrokerageInputs;
  approvedTaxSheet: ApprovedTaxSheet | null;
  activeConsigneeId: string | null;
}

export interface JobFinishedNotice {
  message: string;
  flowboardJobUrl?: string;
}

export interface UploadLocationState {
  jobFinished?: JobFinishedNotice;
}

export function pickJobState(
  inv: Pick<JobState, "invoices" | "activeInvId" | "itemExemptions">,
  wf: Pick<JobState, "taxInputs" | "brokerageInputs" | "approvedTaxSheet" | "activeConsigneeId">,
): JobState {
  return {
    invoices: inv.invoices,
    activeInvId: inv.activeInvId,
    itemExemptions: inv.itemExemptions,
    taxInputs: wf.taxInputs,
    brokerageInputs: wf.brokerageInputs,
    approvedTaxSheet: wf.approvedTaxSheet,
    activeConsigneeId: wf.activeConsigneeId,
  };
}

export function hasJobContent(state: Pick<JobState, "invoices">): boolean {
  return state.invoices.length > 0;
}

export function emptyJobState(defaults: { taxInputs: TaxInputs; brokerageInputs: BrokerageInputs }): JobState {
  return {
    invoices: [],
    activeInvId: null,
    itemExemptions: {},
    taxInputs: { ...defaults.taxInputs },
    brokerageInputs: { ...defaults.brokerageInputs },
    approvedTaxSheet: null,
    activeConsigneeId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJobState(value: unknown): value is JobState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.invoices) &&
    (value.activeInvId === null || typeof value.activeInvId === "number") &&
    isRecord(value.itemExemptions) &&
    isRecord(value.taxInputs) &&
    isRecord(value.brokerageInputs) &&
    (value.approvedTaxSheet === null || isRecord(value.approvedTaxSheet)) &&
    (value.activeConsigneeId === null || typeof value.activeConsigneeId === "string")
  );
}
