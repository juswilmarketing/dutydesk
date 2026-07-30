import type {
  DutyDeskJobType,
  Invoice,
  TaxBreakdownData,
  TaxLogAttachment,
  TaxLogEntry,
  WorksheetGroupedLine,
  WorksheetSourceLine,
} from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { appendTaxLog } from "@/lib/tax-log";
import { buildGroupedWorksheetHtml } from "@/lib/export/worksheet-grouped";
import { buildOriginalInvoiceBreakdownHtml } from "@/lib/export/worksheet-original-invoice";
import { htmlToPdfBase64 } from "@/lib/export/tax-advice-pdf";
import { flowboardReferenceFor, getFlowBoardJobId } from "@/lib/flowboard-client";
import { FLOWBOARD_WORKFLOW_STEPS } from "@/components/flowboard/BrokerageClearanceModal";

export type FlowboardDeliveryChannel = "email" | "whatsapp" | "portal";

export interface FlowBoardClassificationRow {
  desc: string;
  originalDescription?: string;
  qty: number;
  tariff_code: string | null;
  duty_rate: string | null;
  source: string;
  itemCif?: number;
  value?: number;
  duty?: number;
  vat?: number;
  vatRate?: string;
  confidence?: number;
  matchType?: string;
  reviewStatus?: string;
  notes?: string;
  sourceLineNumber?: number;
  groupId?: string | null;
}

export interface FlowBoardSendInput {
  worksheetNum: string;
  jobType?: DutyDeskJobType;
  consigneeName: string;
  consigneeEmail?: string;
  consigneePhone?: string;
  billOfLading: string;
  commodity: string;
  supplierName: string;
  invoiceNumber: string;
  lineItemCount: number;
  currency?: string;
  exchangeRate?: number;
  fobTotal?: number;
  freight?: number;
  insurance?: number;
  totalCif: number;
  totalDuty: number;
  totalVAT: number;
  depositFee: number;
  cesFee: number;
  userFeeAmt: number;
  otherCharges?: number;
  grandTotal: number;
  sentBy: string;
  createdAt?: string;
  /** Full V2 worksheet package HTML (Tax Advice + grouped + optional original). */
  worksheetPackageHtml: string;
  /** Authoritative V1 Tax Advice HTML — sent separately for backwards compatibility. */
  taxAdviceHtml: string;
  breakdown: TaxBreakdownData;
  invoices: Invoice[];
  classificationRows: FlowBoardClassificationRow[];
  /** Names of the attachments the clerk selected in the checklist. */
  attachmentNames?: string[];
  includeItemizedReport?: boolean;
  itemizedReportHtml?: string;
  sourceLines?: WorksheetSourceLine[];
  groupedLines?: WorksheetGroupedLine[];
  includeOriginalInvoice?: boolean;
  jobId?: string;
  /** Stable key so retries do not create duplicate FlowBoard cards. */
  idempotencyKey?: string;
  sentToCustomerVia?: FlowboardDeliveryChannel[];
  notes?: string;
  customerVisibleNote?: boolean;
}

export interface FlowBoardSendResult {
  entry: TaxLogEntry;
  jobId?: string;
  flowboardJobUrl?: string;
  message?: string;
}

export async function sendWorksheetToFlowBoard(input: FlowBoardSendInput): Promise<FlowBoardSendResult> {
  const linkedJobId = input.jobId || getFlowBoardJobId();
  const flowboardReference = flowboardReferenceFor(input.worksheetNum, linkedJobId);
  const sentAt = new Date().toISOString();
  const jobType = input.jobType ?? "brokerage_clearance";
  const idempotencyKey =
    input.idempotencyKey || linkedJobId || `dutydesk:${input.worksheetNum.replace(/\W/g, "").toUpperCase()}`;
  const otherCharges = input.otherCharges ?? input.cesFee + input.depositFee + input.userFeeAmt;

  const taxAdvicePdf = await htmlToPdfBase64(input.taxAdviceHtml);
  const groupedPdf = await htmlToPdfBase64(buildGroupedWorksheetHtml(input.breakdown), 800);
  const originalPdf =
    input.includeOriginalInvoice !== false && input.breakdown.sourceLines?.length
      ? await htmlToPdfBase64(buildOriginalInvoiceBreakdownHtml(input.breakdown), 800)
      : undefined;
  const packagePdf = await htmlToPdfBase64(input.worksheetPackageHtml, 800);
  const itemizedPdf =
    input.includeItemizedReport && input.itemizedReportHtml
      ? await htmlToPdfBase64(input.itemizedReportHtml, 900)
      : undefined;

  const selectedNames = input.attachmentNames;
  const includeUpload = (filename: string) => !selectedNames || selectedNames.includes(filename);

  const attachmentNames: TaxLogAttachment[] = [
    { name: `DutyDesk_Tax_Advice_${input.worksheetNum}.pdf`, type: "application/pdf", auto: true },
    { name: `DutyDesk_Worksheet_Grouped_${input.worksheetNum}.pdf`, type: "application/pdf", auto: true },
    ...(originalPdf
      ? [{ name: `DutyDesk_Original_Invoice_${input.worksheetNum}.pdf`, type: "application/pdf", auto: true }]
      : []),
    { name: `DutyDesk_Worksheet_Package_${input.worksheetNum}.pdf`, type: "application/pdf", auto: true },
    ...(itemizedPdf
      ? [{ name: `DutyDesk_Itemized_Report_${input.worksheetNum}.pdf`, type: "application/pdf", auto: true }]
      : []),
    ...input.invoices
      .filter((inv) => includeUpload(inv.filename))
      .map((inv) => ({
        name: inv.filename,
        type: "application/pdf",
        size: "reference",
        auto: false,
      })),
  ];

  const entry: TaxLogEntry = {
    id: `log_${Date.now()}`,
    worksheetNum: input.worksheetNum,
    consigneeName: input.consigneeName,
    billOfLading: input.billOfLading,
    commodity: input.commodity,
    totalDuty: input.totalDuty,
    totalVAT: input.totalVAT,
    depositFee: input.depositFee,
    cesFee: input.cesFee,
    userFeeAmt: input.userFeeAmt,
    grandTotal: input.grandTotal,
    sentTo: "FlowBoard",
    sentCc: "",
    sentBy: input.sentBy,
    sentAt,
    method: "FlowBoard",
    attachments: attachmentNames,
    taskId: linkedJobId,
    flowboardReference,
    flowboardStatus: "sent",
    lastSyncAt: sentAt,
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    lineItemCount: input.lineItemCount,
    totalCif: input.totalCif,
    documentType: "worksheet",
    jobType,
    dutyDeskStatus: "sent_to_flowboard",
    attachmentsSent: attachmentNames.length,
    idempotencyKey,
  };

  const classificationRows = input.classificationRows.map((row) => ({
    desc: row.desc,
    original_description: row.originalDescription,
    qty: row.qty,
    value: row.value,
    tariff_code: row.tariff_code,
    duty_rate: row.duty_rate,
    vat_rate: row.vatRate || "12.5%",
    taxAmount: (row.duty ?? 0) + (row.vat ?? 0),
    itemCif: row.itemCif,
    confidence: row.confidence,
    matchType: row.matchType,
    reviewStatus: row.reviewStatus,
    notes: row.notes,
    source_line_number: row.sourceLineNumber,
    group_id: row.groupId,
  }));

  const jobPackage = {
    jobId: linkedJobId,
    dutyDeskJobId: input.worksheetNum,
    worksheetNum: input.worksheetNum,
    jobType,
    reference: flowboardReference,
    customer: {
      name: input.consigneeName,
      email: input.consigneeEmail,
      phone: input.consigneePhone,
    },
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    shipmentReference: input.billOfLading,
    clerkName: input.sentBy,
    createdAt: input.createdAt || sentAt,
    sentAt,
    financials: {
      currency: input.currency || "USD",
      exchangeRate: input.exchangeRate,
      fobTotal: input.fobTotal,
      freight: input.freight,
      insurance: input.insurance,
      cifTotal: input.totalCif,
      importDutyTotal: input.totalDuty,
      vatTotal: input.totalVAT,
      otherCharges,
      grandTotal: input.grandTotal,
    },
    classification: classificationRows,
    groupedLines: input.groupedLines,
    sourceLines: input.sourceLines?.map((l) => ({
      id: l.id,
      source_line_number: l.source_line_number,
      original_description: l.original_description,
      worksheet_description: l.worksheet_description,
      hs_code: l.hs_code,
      duty_rate: l.duty_rate,
      vat_rate: l.vat_rate,
      quantity: l.quantity,
      value: l.value,
      duty_amount: l.duty_amount,
      vat_amount: l.vat_amount,
      group_id: l.group_id,
      reviewed_status: l.reviewed_status,
      internal_notes: l.internal_notes,
    })),
    attachments: attachmentNames.map((a) => a.name),
  };

  const workflowInstructions = {
    targetStatus: "Worksheet Ready for Customer",
    idempotencyKey,
    checklist: FLOWBOARD_WORKFLOW_STEPS,
    activityLog: "Complete job package received from Duty Desk",
    enableCustomerEmail: true,
    enableCustomerWhatsApp: true,
    startApprovalWorkflow: true,
    displaySections: ["tax_advice", "worksheet_breakdown", "grouped_lines", "attachments"],
  };

  const response = await api.sendToFlowBoard({
    entry: { ...entry, customerEmail: input.consigneeEmail },
    documentType: "worksheet",
    jobType,
    worksheetPdfBase64: taxAdvicePdf,
    breakdownPdfBase64: groupedPdf,
    originalInvoicePdfBase64: originalPdf,
    worksheetPackagePdfBase64: packagePdf,
    taxBreakdown: input.breakdown as unknown as Record<string, unknown>,
    classificationRows,
    invoiceFilenames: input.invoices.filter((i) => includeUpload(i.filename)).map((i) => i.filename),
    itemizedReportPdfBase64: itemizedPdf,
    includeItemizedReport: !!itemizedPdf,
    jobId: linkedJobId,
    idempotencyKey,
    jobPackage,
    workflowInstructions,
    sentToCustomerVia: input.sentToCustomerVia?.length ? input.sentToCustomerVia : ["portal"],
    notes: input.notes,
    customerVisibleNote: input.customerVisibleNote,
  });

  const syncedEntry: TaxLogEntry = {
    ...entry,
    flowboardJobId: response.jobId,
    flowboardJobUrl: response.flowboardJobUrl,
    flowboardStatus: "sent",
    dutyDeskStatus: "sent_to_flowboard",
    lastSyncAt: new Date().toISOString(),
  };

  return {
    entry: appendTaxLog(syncedEntry),
    jobId: response.jobId,
    flowboardJobUrl: response.flowboardJobUrl,
    message: response.message,
  };
}

export function saveWorksheetDraft(worksheetNum: string, payload: Record<string, unknown>) {
  const key = `dutydesk-worksheet-draft-${worksheetNum || "default"}`;
  localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), ...payload }));
}
