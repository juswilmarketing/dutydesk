import type {
  ApprovedTaxSheet,
  DutyDeskJobStatus,
  FlowBoardQueueStatus,
  Invoice,
  InvoiceQueueStatus,
  LineItem,
  MatchTypeLabel,
  TaxInputs,
  TaxLogEntry,
  WorkflowStageId,
  WorkflowStageStatus,
} from "@pas/shared-types";

export const WORKFLOW_STAGES: Array<{ id: WorkflowStageId; label: string; path: string }> = [
  { id: "upload", label: "Upload", path: "/upload" },
  { id: "classification", label: "Classification", path: "/classification" },
  { id: "taxes", label: "Duties & Taxes", path: "/duties-taxes" },
  { id: "worksheet", label: "Worksheet", path: "/worksheet" },
  { id: "flowboard", label: "FlowBoard", path: "/flowboard" },
  { id: "asycuda", label: "ASYCUDA", path: "/asycuda" },
];

export function matchTypeLabel(source: LineItem["source"], hasCode: boolean, explicit?: LineItem["match_type"]): MatchTypeLabel {
  if (explicit) return explicit;
  if (!hasCode) return "Manual Classification";
  if (source === "database") return "Exact";
  if (source === "supplier_exact") return "Supplier Exact";
  if (source === "supplier_fuzzy") return "Supplier Fuzzy";
  if (source === "learned") return "Learning Rules";
  if (source === "product_intelligence") return "Product Intelligence";
  if (source === "ai") return "AI Suggested";
  if (source === "manual") return "Manual Classification";
  return "Manual Classification";
}

export function confidenceTone(
  source: LineItem["source"],
  hasCode: boolean,
  item?: Pick<LineItem, "match_confidence" | "classification_conflict" | "status" | "requires_clerk_review">,
): "green" | "yellow" | "red" {
  if (!hasCode) return "red";
  if (item?.classification_conflict || item?.status === "needs_review" || item?.requires_clerk_review) return "yellow";
  if (source === "supplier_exact" || source === "database" || source === "learned") return "green";
  if (source === "product_intelligence") {
    return (item?.match_confidence ?? 0) >= 0.85 ? "green" : "yellow";
  }
  if (source === "supplier_fuzzy") {
    return (item?.match_confidence ?? 0) >= 0.85 ? "green" : "yellow";
  }
  if (source === "ai") return "yellow";
  return "yellow";
}

export function confidenceLabel(
  source: LineItem["source"],
  hasCode: boolean,
  item?: Pick<LineItem, "match_confidence" | "classification_conflict" | "status" | "requires_clerk_review">,
): string {
  if (!hasCode) return "Low";
  if (item?.classification_conflict) return "Conflict";
  if (source === "supplier_fuzzy" && item?.match_confidence != null) {
    return item.match_confidence >= 0.85 ? "High" : "Review";
  }
  const tone = confidenceTone(source, hasCode, item);
  if (tone === "green") return "High";
  if (tone === "yellow") return "Review";
  return "Low";
}

function invoiceWorksheetNum(inv: Invoice, taxInputs: TaxInputs): string {
  return taxInputs.worksheetNum || inv.meta.number || "";
}

function flowboardEntryForInvoice(inv: Invoice, taxLog: TaxLogEntry[], taxInputs: TaxInputs): TaxLogEntry | null {
  const num = invoiceWorksheetNum(inv, taxInputs).toLowerCase();
  if (!num) return null;
  return (
    taxLog.find(
      (e) =>
        e.worksheetNum?.toLowerCase() === num &&
        (e.method === "FlowBoard" || e.method.includes("FlowBoard")),
    ) ?? null
  );
}

export function getInvoiceQueueStatus(
  inv: Invoice,
  taxLog: TaxLogEntry[],
  taxInputs: TaxInputs,
): InvoiceQueueStatus {
  const fb = flowboardEntryForInvoice(inv, taxLog, taxInputs);
  if (fb) return "sent_to_flowboard";

  if (inv.status === "processing" || inv.items.some((i) => i.status === "loading")) {
    return "extracting";
  }

  const needsReview = inv.items.some(
    (i) => i.source === "ai" || i.status === "needs_review" || !i.tariff_code,
  );
  if (needsReview) return "needs_review";

  const ws = invoiceWorksheetNum(inv, taxInputs);
  if (ws && taxInputs.manualDuty !== undefined) return "worksheet_ready";

  if (inv.items.length > 0 && inv.items.every((i) => i.tariff_code)) return "classifying";

  return "classifying";
}

export function invoiceQueueLabel(status: InvoiceQueueStatus): string {
  const map: Record<InvoiceQueueStatus, string> = {
    extracting: "Extracting",
    classifying: "Classifying",
    needs_review: "Needs Review",
    worksheet_ready: "Worksheet Ready",
    sent_to_flowboard: "Sent to FlowBoard",
  };
  return map[status];
}

export function invoiceQueueTone(status: InvoiceQueueStatus): "blue" | "gold" | "green" | "default" {
  if (status === "sent_to_flowboard") return "green";
  if (status === "needs_review") return "gold";
  if (status === "worksheet_ready") return "green";
  if (status === "extracting") return "blue";
  return "default";
}

export function getWorkflowStages(
  inv: Invoice | null,
  taxInputs: TaxInputs,
  taxLog: TaxLogEntry[],
  approvedTaxSheet: ApprovedTaxSheet | null,
): Array<{ id: WorkflowStageId; label: string; path: string; status: WorkflowStageStatus }> {
  const fbEntry = inv ? flowboardEntryForInvoice(inv, taxLog, taxInputs) : null;
  const hasItems = !!inv && inv.items.length > 0;
  const classifying = inv?.items.some((i) => i.status === "loading");
  const needsReview = inv?.items.some((i) => i.source === "ai" || !i.tariff_code);
  const classified = hasItems && !classifying && !needsReview;
  const hasTax =
    (taxInputs.manualDuty ?? "") !== "" ||
    (taxInputs.manualVat ?? "") !== "" ||
    (taxInputs.worksheetNum ?? "") !== "";
  const hasWorksheet = !!(taxInputs.worksheetNum && hasTax);
  const sentFlowboard = !!fbEntry;
  const asycudaDone = !!approvedTaxSheet?.items?.length;

  const upload: WorkflowStageStatus = inv ? "complete" : "not_started";
  let classification: WorkflowStageStatus = "not_started";
  if (classifying) classification = "in_progress";
  else if (needsReview) classification = "needs_review";
  else if (classified) classification = "complete";

  let taxes: WorkflowStageStatus = "not_started";
  if (classified) taxes = hasTax ? "complete" : "in_progress";

  let worksheet: WorkflowStageStatus = "not_started";
  if (hasWorksheet) worksheet = sentFlowboard ? "complete" : "in_progress";

  let flowboard: WorkflowStageStatus = "not_started";
  if (sentFlowboard) {
    flowboard = fbEntry?.syncError ? "failed" : "complete";
  } else if (hasWorksheet) {
    flowboard = "in_progress";
  }

  let asycuda: WorkflowStageStatus = "not_started";
  if (asycudaDone) asycuda = "complete";
  else if (sentFlowboard) asycuda = "in_progress";

  const statuses: Record<WorkflowStageId, WorkflowStageStatus> = {
    upload,
    classification,
    taxes,
    worksheet,
    flowboard,
    asycuda,
  };

  return WORKFLOW_STAGES.map((s) => ({ ...s, status: statuses[s.id] }));
}

/** True when the tax-log row is a Duty Desk direct customer send (not FlowBoard). */
export function isDirectCustomerSend(entry: TaxLogEntry): boolean {
  const m = entry.method || "";
  if (m.includes("FlowBoard")) return false;
  return (
    m.includes("Gmail") ||
    m.includes("Mail Client") ||
    m.includes("WhatsApp") ||
    entry.dutyDeskStatus === "completed_directly" ||
    entry.flowboardStatus === "sent_via_email"
  );
}

export function deriveFlowBoardStatus(entry: TaxLogEntry): FlowBoardQueueStatus {
  if (entry.syncError || entry.flowboardStatus === "failed") return "failed";
  if (entry.flowboardStatus) return entry.flowboardStatus;
  if (entry.method === "FlowBoard" || entry.method.includes("FlowBoard")) return "sent";
  if (isDirectCustomerSend(entry)) return "sent_via_email";
  return "pending_send";
}

export function flowBoardStatusLabel(status: FlowBoardQueueStatus): string {
  const map: Record<FlowBoardQueueStatus, string> = {
    pending_send: "Pending Send",
    sent_via_email: "Sent via Email",
    sent: "Sent",
    delivered: "Delivered",
    customer_viewed: "Customer Viewed",
    awaiting_approval: "Awaiting Customer Approval",
    approved: "Approved",
    failed: "Failed",
  };
  return map[status];
}

export function dutyDeskStatusLabel(status: DutyDeskJobStatus): string {
  const map: Record<DutyDeskJobStatus, string> = {
    draft: "Draft",
    classification_in_progress: "Classification in Progress",
    worksheet_ready: "Worksheet Ready",
    awaiting_completion: "Awaiting Completion",
    sending_to_flowboard: "Sending to FlowBoard",
    sent_to_flowboard: "Sent to FlowBoard",
    completed_directly: "Completed Directly",
    failed_flowboard_send: "Failed FlowBoard Send",
  };
  return map[status];
}

export function dashboardMetrics(
  invoices: Invoice[],
  taxLog: TaxLogEntry[],
  taxInputs: TaxInputs,
) {
  let pendingClassification = 0;
  let readyWorksheet = 0;
  let readyFlowboard = 0;
  let sentFlowboard = 0;
  let failedExports = 0;

  for (const inv of invoices) {
    const q = getInvoiceQueueStatus(inv, taxLog, taxInputs);
    if (q === "needs_review" || q === "extracting" || q === "classifying") pendingClassification++;
    if (q === "worksheet_ready") readyWorksheet++;
    if (q === "worksheet_ready" && taxInputs.worksheetNum) readyFlowboard++;
    if (q === "sent_to_flowboard") sentFlowboard++;
  }

  for (const entry of taxLog) {
    if (entry.syncError || deriveFlowBoardStatus(entry) === "failed") failedExports++;
  }

  return {
    pendingClassification,
    readyWorksheet,
    readyFlowboard,
    sentFlowboard,
    failedExports,
  };
}
