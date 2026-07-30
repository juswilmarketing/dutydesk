import type { BrokerageInputs, TaxBreakdownData, TaxLogAttachment, TaxLogEntry } from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { appendTaxLog } from "@/lib/tax-log";
import { buildBrokerageReportHtml } from "@/lib/export/brokerage-report";
import { calculateBrokerage } from "@/lib/brokerage";
import { htmlToPdfBase64 } from "@/lib/export/tax-advice-pdf";
import { buildTaxBreakdownHtml } from "@/lib/export/tax-breakdown";
import { flowboardReferenceFor, getFlowBoardTaskId } from "@/lib/flowboard-client";

async function postQuoteToFlowBoard(payload: {
  entry: TaxLogEntry;
  documentType: "brokerage_quote" | "tax_quote";
  quotePdfBase64: string;
  quoteData: Record<string, unknown>;
  breakdownPdfBase64?: string;
  sentToCustomerVia?: Array<"email" | "whatsapp" | "portal">;
}) {
  await api.sendToFlowBoard({
    entry: payload.entry,
    documentType: payload.documentType,
    quotePdfBase64: payload.quotePdfBase64,
    quoteData: payload.quoteData,
    breakdownPdfBase64: payload.breakdownPdfBase64,
    sentToCustomerVia: payload.sentToCustomerVia?.length ? payload.sentToCustomerVia : ["portal"],
  });
  return appendTaxLog(payload.entry);
}

export async function sendBrokerageQuoteToFlowBoard(
  inputs: BrokerageInputs,
  sentBy: string,
  options?: { sentToCustomerVia?: Array<"email" | "whatsapp" | "portal"> },
): Promise<TaxLogEntry> {
  const totals = calculateBrokerage(inputs);
  const ref = inputs.invoiceNo.trim() || `QT-${Date.now().toString(36).toUpperCase()}`;
  const taskId = getFlowBoardTaskId();
  const flowboardReference = flowboardReferenceFor(ref, taskId);
  const sentAt = new Date().toISOString();
  const quotePdf = await htmlToPdfBase64(buildBrokerageReportHtml(inputs));

  const attachments: TaxLogAttachment[] = [
    { name: `DutyDesk_Brokerage_Quote_${ref}.pdf`, type: "application/pdf", auto: true },
  ];

  const entry: TaxLogEntry = {
    id: `log_${Date.now()}`,
    worksheetNum: ref,
    consigneeName: inputs.custName || inputs.custCompany || "",
    billOfLading: inputs.invoiceNo || "",
    commodity: inputs.commodity || "",
    totalDuty: totals.d30,
    totalVAT: totals.d45 - totals.d42,
    depositFee: 0,
    cesFee: 0,
    userFeeAmt: totals.d36,
    grandTotal: totals.d45,
    sentTo: "FlowBoard",
    sentCc: "",
    sentBy,
    sentAt,
    method: "FlowBoard Quote",
    attachments,
    taskId,
    flowboardReference,
    flowboardStatus: "sent",
    lastSyncAt: sentAt,
    documentType: "brokerage_quote",
    invoiceNumber: inputs.invoiceNo,
  };

  return postQuoteToFlowBoard({
    entry,
    documentType: "brokerage_quote",
    quotePdfBase64: quotePdf,
    quoteData: { inputs, totals },
    sentToCustomerVia: options?.sentToCustomerVia,
  });
}

export async function sendTaxQuoteToFlowBoard(payload: {
  worksheetNum: string;
  consigneeName: string;
  billOfLading: string;
  commodity: string;
  totalDuty: number;
  totalVAT: number;
  depositFee: number;
  cesFee: number;
  userFeeAmt: number;
  grandTotal: number;
  sentBy: string;
  worksheetHtml: string;
  breakdown: TaxBreakdownData;
  sentToCustomerVia?: Array<"email" | "whatsapp" | "portal">;
}): Promise<TaxLogEntry> {
  const ref = payload.worksheetNum.trim() || `TQ-${Date.now().toString(36).toUpperCase()}`;
  const taskId = getFlowBoardTaskId();
  const flowboardReference = flowboardReferenceFor(ref, taskId);
  const sentAt = new Date().toISOString();
  const quotePdf = await htmlToPdfBase64(payload.worksheetHtml);
  const breakdownHtml = buildTaxBreakdownHtml(payload.breakdown);
  const breakdownPdf = await htmlToPdfBase64(breakdownHtml, 760);

  const attachments: TaxLogAttachment[] = [
    { name: `DutyDesk_Tax_Quote_${ref}.pdf`, type: "application/pdf", auto: true },
    { name: `DutyDesk_Tax_Breakdown_${ref}.pdf`, type: "application/pdf", auto: true },
  ];

  const entry: TaxLogEntry = {
    id: `log_${Date.now()}`,
    worksheetNum: ref,
    consigneeName: payload.consigneeName,
    billOfLading: payload.billOfLading,
    commodity: payload.commodity,
    totalDuty: payload.totalDuty,
    totalVAT: payload.totalVAT,
    depositFee: payload.depositFee,
    cesFee: payload.cesFee,
    userFeeAmt: payload.userFeeAmt,
    grandTotal: payload.grandTotal,
    sentTo: "FlowBoard",
    sentCc: "",
    sentBy: payload.sentBy,
    sentAt,
    method: "FlowBoard Quote",
    attachments,
    taskId,
    flowboardReference,
    flowboardStatus: "sent",
    lastSyncAt: sentAt,
    documentType: "tax_quote",
    totalCif: payload.breakdown.cifTTD,
  };

  return postQuoteToFlowBoard({
    entry,
    documentType: "tax_quote",
    quotePdfBase64: quotePdf,
    breakdownPdfBase64: breakdownPdf,
    quoteData: { breakdown: payload.breakdown, totals: payload },
    sentToCustomerVia: payload.sentToCustomerVia,
  });
}
