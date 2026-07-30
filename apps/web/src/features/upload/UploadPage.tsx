import { useState } from "react";
import { DropZone } from "./DropZone";
import { useInvoiceProcessor } from "@/hooks/useInvoiceProcessor";
import { useInvoiceStore } from "@/stores/invoice-store";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { InfoBanner } from "@/components/ui/banners";
import { Card } from "@/components/ui/card";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { cn } from "@/lib/cn";
import { useWorkflowStore } from "@/stores/workflow-store";
import { getInvoiceQueueStatus } from "@/lib/workflow-pipeline";
import { InvoiceQueueBadge } from "@/components/workflow/StatusBadge";
import { lineItemValue } from "@/lib/invoice-charges";
import { Button } from "@/components/ui/button";
import { api, type DocumentProcessingJobStatus } from "@/lib/api-client";

const STEPS = [
  "Uploading document…",
  "Processing scanned pages in batches…",
  "Matching supplier history & product identity…",
  "AI classifying remaining items only…",
  "Complete!",
];

export function UploadPage() {
  const [processing, setProcessing] = useState<{
    filename: string;
    step: number;
    detail?: string;
    job?: DocumentProcessingJobStatus | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [failedJobId, setFailedJobId] = useState<string | null>(null);
  const { processFile, resumeJob } = useInvoiceProcessor();
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const setActiveInvId = useInvoiceStore((s) => s.setActiveInvId);
  const setInvoices = useInvoiceStore((s) => s.setInvoices);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    setError("");
    setFailedJobId(null);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
    } catch {
      /* ignore */
    }

    setProcessing({ filename: file.name, step: 0, detail: "Uploading…" });
    try {
      await processFile(
        file,
        (step) => setProcessing((p) => (p ? { ...p, step } : { filename: file.name, step })),
        (detail) => setProcessing((p) => (p ? { ...p, detail } : { filename: file.name, step: 1, detail })),
        (job) => {
          setProcessing((p) =>
            p
              ? { ...p, job, detail: job.currentStage || p.detail }
              : { filename: file.name, step: 1, job, detail: job.currentStage || "" },
          );
          if (job.status === "failed") setFailedJobId(job.jobId);
        },
      );
      setProcessing(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to process invoice.";
      setError(msg);
      setProcessing((p) => {
        if (p?.job?.jobId) setFailedJobId(p.job.jobId);
        return null;
      });
    }
  };

  const handleRetry = async () => {
    if (!failedJobId) return;
    setError("");
    setProcessing({
      filename: "Retry",
      step: 1,
      detail: "Retrying from failed batch…",
      job: {
        success: true,
        jobId: failedJobId,
        status: "ocr_processing",
        pagesTotal: 0,
        pagesCompleted: 0,
        progressPercent: 0,
      },
    });
    try {
      await resumeJob(
        failedJobId,
        (step) => setProcessing((p) => (p ? { ...p, step } : { filename: "Retry", step })),
        (detail) => setProcessing((p) => (p ? { ...p, detail } : { filename: "Retry", step: 1, detail })),
        (job) => {
          setProcessing((p) =>
            p
              ? { ...p, job, detail: job.currentStage || p.detail }
              : { filename: "Retry", step: 1, job, detail: job.currentStage || "" },
          );
          if (job.status === "failed") setFailedJobId(job.jobId);
        },
      );
      setProcessing(null);
      setFailedJobId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
      setProcessing(null);
    }
  };

  const handleCancel = async () => {
    const jobId = processing?.job?.jobId || failedJobId;
    if (!jobId) return;
    try {
      await api.cancelDocumentJob(jobId);
    } catch {
      /* ignore */
    }
    setProcessing(null);
    setFailedJobId(null);
  };

  const pct = processing?.job?.progressPercent ?? (processing ? processing.step * 20 : 0);

  return (
    <PageLayout>
      <PageHeader
        icon="📄"
        title="Upload Supplier Invoice"
        description="Drop supplier invoices to extract line items and match T&T tariff codes"
        actions={
          invoices.length > 0 ? (
            <Badge tone="green">{invoices.length} loaded</Badge>
          ) : undefined
        }
      />

      {processing ? (
        <div className="processing-card" aria-live="polite">
          <div
            className="mx-auto mb-4 h-11 w-11 rounded-full border-[3px] animate-spin"
            style={{ borderColor: "var(--border)", borderTopColor: "var(--accent2)" }}
          />
          <div className="text-xl font-bold" style={{ color: "var(--accent2)" }}>
            Processing {processing.filename}
          </div>
          <div className="mx-auto mt-4 max-w-md text-left">
            <div className="mb-1 flex justify-between text-xs dd-text-muted">
              <span>Progress</span>
              <span>{Math.max(0, Math.min(100, pct))}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: "var(--accent2)" }}
              />
            </div>
            {processing.job && (
              <div className="mt-2 text-sm dd-text-muted">
                Stage: {processing.job.currentStage || processing.job.status}
                {processing.job.pagesTotal > 0 && (
                  <>
                    <br />
                    Pages {processing.job.pagesCompleted} of {processing.job.pagesTotal}
                    {processing.job.batchSize
                      ? ` · batches of ${processing.job.batchSize}`
                      : null}
                  </>
                )}
              </div>
            )}
            {processing.detail && !processing.job && (
              <div className="mt-2 text-sm dd-text-muted">{processing.detail}</div>
            )}
          </div>
          <div className="mx-auto mt-3 inline-block text-left text-[12.5px] leading-[2.4]">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`flex items-center gap-2.5 ${
                  i < processing.step ? "step-done" : i === processing.step ? "step-active" : "step-pending"
                }`}
              >
                <span className="w-4 text-center text-[13px]">
                  {i < processing.step ? "✓" : i === processing.step ? "⟳" : "○"}
                </span>
                {s}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Button type="button" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <InfoBanner tone="error" className="mb-3">
              <div>{error}</div>
              {failedJobId && (
                <div className="mt-2 flex gap-2">
                  <Button type="button" onClick={handleRetry}>
                    Retry from failed page
                  </Button>
                </div>
              )}
            </InfoBanner>
          )}
          <DropZone onFile={handleFile} />
        </>
      )}

      {invoices.length > 0 && (
        <Card className="mt-4">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="font-semibold">Loaded invoices</div>
            <Button type="button" variant="secondary" onClick={() => navigate("/classification")}>
              Continue to classification
            </Button>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {invoices.map((inv) => {
              const queue = getInvoiceQueueStatus(inv, taxLog, taxInputs);
              const total = inv.items.reduce((s, it) => s + lineItemValue(it), 0);
              return (
                <button
                  key={inv.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm",
                    inv.id === activeInvId ? "bg-[var(--surface2)]" : "",
                  )}
                  onClick={() => setActiveInvId(inv.id)}
                >
                  <div>
                    <div className="font-medium">{inv.meta.supplier || inv.filename}</div>
                    <div className="text-xs dd-text-muted">
                      {inv.items.length} lines · US${total.toFixed(2)}
                    </div>
                  </div>
                  <InvoiceQueueBadge status={queue} />
                </button>
              );
            })}
          </div>
          <div className="px-3 py-2">
            <button
              type="button"
              className="text-xs dd-text-muted underline"
              onClick={() => setInvoices(() => [])}
            >
              Clear all
            </button>
          </div>
        </Card>
      )}
    </PageLayout>
  );
}
