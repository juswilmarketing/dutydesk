import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtTTD } from "@pas/tax-engine";
import type { DutyDeskJobStatus, DutyDeskJobType } from "@pas/shared-types";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useTaxWorksheet } from "@/hooks/useTaxWorksheet";
import { clerkDisplayName } from "@/lib/clerk";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { WorkflowProgress } from "@/components/workflow/WorkflowProgress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompleteJobModal } from "@/components/flowboard/CompleteJobModal";
import { BrokerageClearanceModal } from "@/components/flowboard/BrokerageClearanceModal";
import type { BrokerageSendSuccess } from "@/components/flowboard/BrokerageClearanceModal";
import { openFlowboardJobCard, resolveFlowboardJobUrl } from "@/lib/flowboard-client";
import { saveWorksheetDraft, sendWorksheetToFlowBoard } from "@/lib/flowboard-send";
import {
  buildJobAttachmentChecklist,
  selectedAttachmentNames,
  type JobAttachmentItem,
} from "@/lib/job-attachments";
import { loadActivity, logActivity, type ActivityLogEntry } from "@/lib/activity-log";
import { getWorkflowStages, matchTypeLabel } from "@/lib/workflow-pipeline";
import { useWorksheetLines } from "@/hooks/useWorksheetLines";
import { WorksheetPreview } from "@/components/worksheet/WorksheetPreview";
import { BatchEditModal } from "@/components/worksheet/BatchEditModal";
import { buildWorksheetPackageHtml, downloadWorksheetPackagePdf } from "@/lib/export/worksheet-package";
import { buildTaxAdviceHtml } from "@/lib/export/tax-advice-report";
import { groupedToBreakdownRows, sourceToBreakdownRows } from "@/lib/worksheet-lines";
import type { TaxBreakdownData } from "@pas/shared-types";
import { buildEmailDataFromAdvice, EmailModal } from "@/components/email/EmailModal";
import { buildTaxReportHtml } from "@/lib/export/tax-report";
import { EmptyState } from "@/components/ui/banners";
import { syncTeamWorkflow } from "@/lib/workflow-sync";
import { DutyDeskJobStatusBadge } from "@/components/workflow/StatusBadge";
import { finishJob, START_NEW_JOB_CONFIRM } from "@/lib/job-sync";
import type { UploadLocationState } from "@/lib/job-state";

export function WorksheetPage() {
  const user = useAuthStore((s) => s.user);
  const clerkName = clerkDisplayName(user);
  const navigate = useNavigate();
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const refreshTaxLog = useWorkflowStore((s) => s.refreshTaxLog);
  const approvedTaxSheet = useWorkflowStore((s) => s.approvedTaxSheet);

  const ws = useTaxWorksheet(clerkName);
  const {
    invoices,
    taxInv,
    activeItems,
    activeConsignee,
    summary,
    worksheetNum,
    supplierName,
    invoiceNumber,
    billOfLading,
    totalDuty,
    totalVAT,
    cesFee,
    depositFee,
    userFeeAmt,
    freight,
    insurance,
    adviceGrandTotal,
    buildAdvice,
    adviceData,
    breakdownData,
    commodity,
    combineAll,
    taxInputs,
    xr,
  } = ws;

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showBrokerageModal, setShowBrokerageModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [checklist, setChecklist] = useState<JobAttachmentItem[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [successEntry, setSuccessEntry] = useState<ReturnType<typeof useWorkflowStore.getState>["taxLog"][0] | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [brokerageSuccess, setBrokerageSuccess] = useState<BrokerageSendSuccess | null>(null);
  const [jobStatus, setJobStatus] = useState<DutyDeskJobStatus>("draft");
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [validationBlocked, setValidationBlocked] = useState("");

  const worksheetLines = useWorksheetLines({
    worksheetNum,
    taxRows: summary.rows,
    activeItems,
    vatExempt: taxInputs.vatExempt,
  });

  const fullBreakdown = useMemo(
    (): TaxBreakdownData => ({
      ...breakdownData,
      rows: sourceToBreakdownRows(worksheetLines.sourceLines),
      groupedRows: groupedToBreakdownRows(worksheetLines.groupedLines),
      sourceLines: worksheetLines.sourceLines,
      groupedLines: worksheetLines.groupedLines,
    }),
    [breakdownData, worksheetLines.sourceLines, worksheetLines.groupedLines],
  );

  const buildPackageHtml = () => buildWorksheetPackageHtml(adviceData, fullBreakdown);
  const buildTaxAdviceOnlyHtml = () => buildTaxAdviceHtml(adviceData);

  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);

  const activeInv = taxInv || invoices[0] || null;
  const stages = getWorkflowStages(activeInv, taxInputs, taxLog, approvedTaxSheet);

  const existingFlowBoard = useMemo(
    () =>
      taxLog.find(
        (e) =>
          e.worksheetNum?.toLowerCase() === worksheetNum.toLowerCase() &&
          (e.method === "FlowBoard" || e.method.includes("FlowBoard")),
      ) ?? null,
    [taxLog, worksheetNum],
  );

  const existingClassificationSend = useMemo(
    () =>
      taxLog.find(
        (e) =>
          e.worksheetNum?.toLowerCase() === worksheetNum.toLowerCase() &&
          !(e.method === "FlowBoard" || e.method.includes("FlowBoard")),
      ) ?? null,
    [taxLog, worksheetNum],
  );

  const sentState = successEntry || existingFlowBoard;
  const canIncludeItemizedReport = summary.invoiceTotal > 0 && summary.rows.length > 0;

  useEffect(() => {
    setActivity(loadActivity(worksheetNum));
  }, [worksheetNum]);

  useEffect(() => {
    if (existingFlowBoard) setJobStatus("sent_to_flowboard");
    else if (existingClassificationSend) setJobStatus("completed_directly");
    else if (worksheetNum.trim() && adviceGrandTotal > 0) setJobStatus("worksheet_ready");
    else setJobStatus("draft");
  }, [existingFlowBoard, existingClassificationSend, worksheetNum, adviceGrandTotal]);

  const refreshActivity = () => setActivity(loadActivity(worksheetNum));

  const recordActivity = (message: string) => {
    logActivity(worksheetNum, message, clerkName);
    refreshActivity();
  };

  const classificationRows = () =>
    worksheetLines.sourceLines.map((line) => {
      const item = activeItems.find((it) => it.id === line.id);
      return {
        desc: line.worksheet_description,
        originalDescription: line.original_description,
        qty: line.quantity,
        value: line.value,
        tariff_code: line.hs_code,
        duty_rate: line.duty_rate,
        vatRate: line.vat_rate,
        source: item?.source ?? "worksheet",
        itemCif: line.value,
        duty: line.duty_amount,
        vat: line.vat_amount,
        sourceLineNumber: line.source_line_number,
        groupId: line.group_id,
        matchType: item ? matchTypeLabel(item.source, Boolean(line.hs_code)) : undefined,
        reviewStatus: line.reviewed_status,
        notes: line.internal_notes,
      };
    });

  const handleSaveDraft = () => {
    saveWorksheetDraft(worksheetNum, {
      worksheetNum,
      consigneeName: activeConsignee?.name,
      billOfLading,
      commodity,
      totals: { totalDuty, totalVAT, cesFee, depositFee, userFeeAmt, adviceGrandTotal },
    });
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 3000);
  };

  const handleGenerateWorksheet = async () => {
    if (worksheetLines.hasErrors) {
      setValidationBlocked("Fix validation errors before generating the worksheet PDF.");
      return;
    }
    setValidationBlocked("");
    await downloadWorksheetPackagePdf(adviceData, fullBreakdown, worksheetNum);
    recordActivity("Worksheet generated (Tax Advice + Line Breakdown PDF)");
  };

  const handleAutoGroup = () => {
    worksheetLines.applyAutoGroup();
    recordActivity("Auto-group by HS code, duty rate, and VAT rate applied");
  };

  const handleManualGroup = () => {
    worksheetLines.applyManualGroup();
    recordActivity(`Manual group created (${worksheetLines.selectedIds.size} lines)`);
  };

  const handleUngroup = () => {
    worksheetLines.applyUngroup();
    recordActivity("Selected lines ungrouped");
  };

  const handleBatchEditApply = (patch: Parameters<typeof worksheetLines.applyBatchEdit>[0]) => {
    const count = worksheetLines.selectedIds.size;
    worksheetLines.applyBatchEdit(patch);
    setShowBatchEdit(false);
    recordActivity(`Batch edit applied to ${count} line(s)`);
  };

  const openCompleteJob = () => {
    if (worksheetLines.hasErrors) {
      setValidationBlocked("Fix validation errors before completing the job.");
      return;
    }
    setValidationBlocked("");
    setSendError("");
    setBrokerageSuccess(null);
    setShowCompleteModal(true);
  };

  const handleContinue = (path: DutyDeskJobType) => {
    setShowCompleteModal(false);
    setJobStatus("awaiting_completion");
    if (path === "classification_only") {
      setShowEmailModal(true);
    } else {
      setChecklist(
        buildJobAttachmentChecklist({
          worksheetNum,
          invoices,
          canIncludeItemizedReport,
          includeItemizedReportDefault: true,
        }),
      );
      setSendError("");
      setShowBrokerageModal(true);
    }
  };

  const toggleChecklistItem = (id: string) =>
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );

  const completeAndStartNext = async (
    jobType: DutyDeskJobType,
    notice: NonNullable<UploadLocationState["jobFinished"]>,
  ) => {
    await finishJob({ status: "sent", jobType, worksheetNum });
    navigate("/upload", { state: { jobFinished: notice } satisfies UploadLocationState });
  };

  const handleStartNewJob = async () => {
    if (!window.confirm(START_NEW_JOB_CONFIRM)) return;
    await finishJob({ status: "abandoned" });
    navigate("/upload");
  };

  const handleClassificationSent = () => {
    setJobStatus("completed_directly");
    recordActivity("Classification worksheet sent directly from Duty Desk");
    void completeAndStartNext("classification_only", {
      message: `Worksheet ${worksheetNum} sent to the customer. Ready for the next job.`,
    });
  };

  const handleBrokerageSend = async () => {
    if (!worksheetNum.trim()) {
      setSendError("Enter a worksheet number before sending to FlowBoard.");
      return;
    }
    setSending(true);
    setSendError("");
    setJobStatus("sending_to_flowboard");
    const includeItemized =
      canIncludeItemizedReport && checklist.some((i) => i.id === "itemized-report-pdf" && i.selected);
    const names = selectedAttachmentNames(checklist);
    try {
      const result = await sendWorksheetToFlowBoard({
        worksheetNum,
        jobType: "brokerage_clearance",
        consigneeName: activeConsignee?.name || "",
        consigneeEmail: activeConsignee?.email,
        consigneePhone: activeConsignee?.phone,
        billOfLading,
        commodity,
        supplierName,
        invoiceNumber,
        lineItemCount: activeItems.length,
        currency: taxInv?.meta.currency,
        exchangeRate: xr,
        fobTotal: summary.invoiceTotal,
        freight,
        insurance,
        totalCif: summary.cifTTD,
        totalDuty,
        totalVAT,
        depositFee,
        cesFee,
        userFeeAmt,
        otherCharges: cesFee + depositFee + userFeeAmt,
        grandTotal: adviceGrandTotal,
        sentBy: clerkName,
        taxAdviceHtml: buildTaxAdviceOnlyHtml(),
        worksheetPackageHtml: buildPackageHtml(),
        breakdown: fullBreakdown,
        includeOriginalInvoice: true,
        invoices,
        classificationRows: classificationRows(),
        sourceLines: worksheetLines.sourceLines,
        groupedLines: worksheetLines.groupedLines,
        attachmentNames: names,
        includeItemizedReport: includeItemized,
        itemizedReportHtml: includeItemized
          ? buildTaxReportHtml(summary, {
              combineAll,
              invoices,
              taxInv,
              taxInputs,
              exchangeRate: xr,
              preparedBy: clerkName,
            })
          : undefined,
      });
      setSuccessEntry(result.entry);
      setSuccessMessage(result.message || "Complete job package sent to FlowBoard successfully.");
      setJobStatus("sent_to_flowboard");
      setBrokerageSuccess({
        message: "Complete job package sent to FlowBoard successfully.",
        reference: result.entry.flowboardReference,
        jobUrl: result.flowboardJobUrl || resolveFlowboardJobUrl(result.jobId),
        sentAt: result.entry.sentAt,
        attachmentNames: result.entry.attachments?.map((a) => a.name) ?? names,
      });
      recordActivity("Sent to FlowBoard");
      logActivity(worksheetNum, "FlowBoard card created", clerkName);
      logActivity(worksheetNum, "Customer approval workflow started", clerkName);
      refreshActivity();
      await syncTeamWorkflow().catch(() => null);
      refreshTaxLog();
      await completeAndStartNext("brokerage_clearance", {
        message: `Worksheet ${worksheetNum} sent to FlowBoard${
          result.entry.flowboardReference ? ` (${result.entry.flowboardReference})` : ""
        }. Ready for the next job.`,
        flowboardJobUrl: result.flowboardJobUrl || resolveFlowboardJobUrl(result.jobId) || undefined,
      });
    } catch (e) {
      setJobStatus("failed_flowboard_send");
      setSendError(e instanceof Error ? e.message : "Failed to send to FlowBoard");
    } finally {
      setSending(false);
    }
  };

  if (!invoices.length && !worksheetNum) {
    return (
      <EmptyState
        icon="📋"
        title="No worksheet to prepare"
        action={
          <Button onClick={() => navigate("/upload")}>Upload Supplier Invoice →</Button>
        }
      />
    );
  }

  return (
    <PageLayout>
      <PageHeader
        icon="📋"
        title="Worksheet"
        description="Review totals, then Complete Job once — Classification Only emails from here; Brokerage Clearance sends via FlowBoard"
        actions={
          <div className="flex items-center gap-2">
            <DutyDeskJobStatusBadge status={jobStatus} />
            <Button variant="secondary" className="text-xs" onClick={() => void handleStartNewJob()}>
              Start new job
            </Button>
          </div>
        }
      />

      <WorkflowProgress stages={stages} />

      <Card className="dd-card mb-4 border-none p-3 text-sm shadow-none" style={{ background: "var(--surface2)" }}>
        <span style={{ color: "var(--text2)" }}>
          When the worksheet is ready, click <strong>Complete Job</strong>. For brokerage clearance, the full job
          package (worksheet, tax breakdown, invoice, and supporting attachments) is sent to FlowBoard, which then
          handles all customer email, WhatsApp, approvals, and clearance tracking.
        </span>
      </Card>

      {draftSaved && (
        <div className="dd-notif-success mb-3 text-sm">Worksheet draft saved.</div>
      )}

      {sentState && (
        <Card className="dd-card mb-4 border-none p-4 shadow-none" style={{ borderLeft: "4px solid var(--green)" }}>
          <div className="font-semibold" style={{ color: "var(--green)" }}>
            {successMessage || "Complete job package sent to FlowBoard successfully."}
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2" style={{ color: "var(--text2)" }}>
            <div>
              <span className="font-medium" style={{ color: "var(--text)" }}>Worksheet: </span>
              {sentState.worksheetNum}
            </div>
            <div>
              <span className="font-medium" style={{ color: "var(--text)" }}>Sent: </span>
              {new Date(sentState.sentAt).toLocaleString()}
            </div>
            {sentState.flowboardReference && (
              <div>
                <span className="font-medium" style={{ color: "var(--text)" }}>FlowBoard card: </span>
                <span className="font-mono text-xs">{sentState.flowboardReference}</span>
              </div>
            )}
            <div>
              <span className="font-medium" style={{ color: "var(--text)" }}>Attachments sent: </span>
              {sentState.attachmentsSent ?? sentState.attachments?.length ?? 0}
            </div>
            <div className="sm:col-span-2">
              <span className="font-medium" style={{ color: "var(--text)" }}>Files: </span>
              {sentState.attachments?.map((a) => a.name).join(", ") || "Worksheet PDF, Tax breakdown"}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DutyDeskJobStatusBadge status={sentState.dutyDeskStatus || "sent_to_flowboard"} />
            <Button
              className="text-xs"
              style={{ background: "#1B4F8A" }}
              onClick={() => openFlowboardJobCard(sentState.flowboardJobId || sentState.taskId)}
            >
              Open in FlowBoard
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="dd-card border-none p-4 shadow-none">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "var(--text2)" }}>
            Shipment summary
          </div>
          <dl className="grid gap-2 text-sm">
            {[
              ["Customer", activeConsignee?.name || "—"],
              ["Supplier", supplierName || "—"],
              ["Invoice number", invoiceNumber || "—"],
              ["Shipment / job ref", billOfLading || "—"],
              ["Line items", String(activeItems.length)],
              ["Total CIF", fmtTTD(summary.cifTTD)],
              ["Import duty", fmtTTD(totalDuty)],
              ["VAT", fmtTTD(totalVAT)],
              ["Other charges", fmtTTD(cesFee + depositFee + userFeeAmt)],
              ["Grand total", fmtTTD(adviceGrandTotal)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b py-1.5" style={{ borderColor: "var(--border)" }}>
                <dt style={{ color: "var(--text2)" }}>{k}</dt>
                <dd className="font-mono font-semibold text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="dd-card border-none p-4 shadow-none">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "var(--text2)" }}>
            Worksheet #
          </div>
          <input
            className="dd-input mb-3"
            placeholder="e.g. MIM363"
            value={taxInputs.worksheetNum || ""}
            onChange={(e) => ws.setTaxInputs((t) => ({ ...t, worksheetNum: e.target.value }))}
          />
          <p className="text-xs" style={{ color: "var(--text2)" }}>
            Complete duties &amp; taxes on the previous step, then generate and send the worksheet here.
            {!worksheetNum && (
              <button type="button" className="ml-1 underline" onClick={() => navigate("/duties-taxes")}>
                Go to Duties &amp; Taxes
              </button>
            )}
          </p>
        </Card>
      </div>

      <WorksheetPreview
        advice={adviceData}
        breakdown={fullBreakdown}
        sourceLines={worksheetLines.sourceLines}
        groupedLines={worksheetLines.groupedLines}
        validation={worksheetLines.validation}
        selectedIds={worksheetLines.selectedIds}
        expandedGroups={worksheetLines.expandedGroups}
        onToggleSelect={worksheetLines.toggleSelect}
        onSelectAll={worksheetLines.selectAll}
        onClearSelection={worksheetLines.clearSelection}
        onToggleGroupExpand={worksheetLines.toggleGroupExpand}
        onEditDescription={worksheetLines.editDescription}
        onEditGroupDescription={worksheetLines.editGroupDescription}
        onEditLineField={worksheetLines.editLineField}
        onAutoGroup={handleAutoGroup}
        onManualGroup={handleManualGroup}
        onUngroup={handleUngroup}
        onBatchEdit={() => setShowBatchEdit(true)}
      />

      {validationBlocked && (
        <div className="dd-notif-error mt-2 text-sm">{validationBlocked}</div>
      )}

      <Card className="dd-card dd-sticky-actions mt-4 border-none shadow-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm" style={{ color: "var(--text2)" }}>
            Total payable: <span className="font-mono font-bold" style={{ color: "var(--green)" }}>{fmtTTD(adviceGrandTotal)}</span>
            <div className="mt-1 text-xs">
              {sentState
                ? "Already sent — open FlowBoard for status. Do not resend from Duties & Taxes."
                : existingClassificationSend
                  ? "Already emailed from Duty Desk — do not send again from another tab."
                  : "Customer send happens only from Complete Job on this tab."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="text-xs" onClick={handleSaveDraft}>
              Save Draft
            </Button>
            <Button variant="green" className="text-xs" onClick={handleGenerateWorksheet} disabled={worksheetLines.hasErrors}>
              Generate Worksheet PDF
            </Button>
            {sentState ? (
              <Button
                className="text-xs"
                style={{ background: "#1B4F8A" }}
                onClick={() => openFlowboardJobCard(sentState.flowboardJobId || sentState.taskId)}
              >
                Open in FlowBoard
              </Button>
            ) : existingClassificationSend ? (
              <>
                <Button variant="secondary" className="text-xs" onClick={openCompleteJob}>
                  Resend Worksheet
                </Button>
              </>
            ) : (
              <Button
                className="text-xs"
                style={{ background: "var(--accent2)" }}
                onClick={openCompleteJob}
                disabled={!worksheetNum.trim() || adviceGrandTotal <= 0}
              >
                Complete Job
              </Button>
            )}
          </div>
        </div>
      </Card>

      {activity.length > 0 && (
        <Card className="dd-card mt-4 border-none p-4 shadow-none">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "var(--text2)" }}>
            Audit trail
          </div>
          <ul className="space-y-2">
            {activity.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 text-sm">
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--accent2)" }}
                />
                <span className="min-w-0">
                  <span style={{ color: "var(--text)" }}>{item.message}</span>
                  <span className="ml-2 text-xs" style={{ color: "var(--text3)" }}>
                    {new Date(item.at).toLocaleString()}
                    {item.actor ? ` · ${item.actor}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <BatchEditModal
        open={showBatchEdit}
        selectedCount={worksheetLines.selectedIds.size}
        onCancel={() => setShowBatchEdit(false)}
        onApply={handleBatchEditApply}
      />

      <CompleteJobModal
        open={showCompleteModal}
        onCancel={() => setShowCompleteModal(false)}
        onContinue={handleContinue}
      />

      <BrokerageClearanceModal
        open={showBrokerageModal}
        checklist={checklist}
        onToggle={toggleChecklistItem}
        sending={sending}
        error={sendError}
        success={brokerageSuccess}
        onCancel={() => {
          setShowBrokerageModal(false);
          setSendError("");
          if (!brokerageSuccess && jobStatus !== "sent_to_flowboard") setJobStatus("worksheet_ready");
        }}
        onConfirm={handleBrokerageSend}
        onOpenFlowboard={() => openFlowboardJobCard(successEntry?.flowboardJobId || successEntry?.taskId)}
      />

      {showEmailModal && (
        <EmailModal
          title="Send Classification Worksheet"
          subtitle="Classification Only — email or WhatsApp the worksheet directly from Duty Desk"
          data={buildEmailDataFromAdvice(buildAdvice(), {
            worksheetNum,
            consigneeName: activeConsignee?.name || "",
            consigneeEmail: activeConsignee?.email,
            consigneePhone: activeConsignee?.phone || "",
            billOfLading,
            commodity,
            totalDuty,
            totalVAT,
            depositFee,
            cesFee,
            userFeeAmt,
            grandTotal: adviceGrandTotal,
            preparedBy: clerkName,
            breakdown: fullBreakdown,
          })}
          currentUserName={clerkName}
          onSent={handleClassificationSent}
          onClose={() => setShowEmailModal(false)}
        />
      )}
    </PageLayout>
  );
}
