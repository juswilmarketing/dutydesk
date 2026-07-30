import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { FlowboardDeliveryChannel } from "@/lib/flowboard-send";
import type { FlowboardJobSummary } from "@/lib/flowboard-client";

export interface SendToFlowBoardOptions {
  jobId?: string;
  sentToCustomerVia: FlowboardDeliveryChannel[];
  notes: string;
  customerVisibleNote: boolean;
  includeItemizedReport: boolean;
}

interface Props {
  open: boolean;
  sending: boolean;
  error?: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  showItemizedReportOption?: boolean;
  includeItemizedReport?: boolean;
  onIncludeItemizedReportChange?: (value: boolean) => void;
  itemizedReportDisabled?: boolean;
  defaultJobId?: string;
  defaultReference?: string;
  defaultCustomerName?: string;
  onCancel: () => void;
  onConfirm: (options: SendToFlowBoardOptions) => void;
}

const CHANNELS: { id: FlowboardDeliveryChannel; label: string; hint: string }[] = [
  { id: "email", label: "Email", hint: "Queue customer email from FlowBoard" },
  { id: "whatsapp", label: "WhatsApp", hint: "Queue WhatsApp delivery from FlowBoard" },
  { id: "portal", label: "Customer portal", hint: "Show worksheet update in the customer portal" },
];

export function SendToFlowBoardModal({
  open,
  sending,
  error,
  title = "Send Worksheet to FlowBoard?",
  message = "Attach this worksheet to a FlowBoard job. FlowBoard will store the PDF, update the pipeline, and handle customer delivery.",
  confirmLabel = "Send to FlowBoard",
  showItemizedReportOption = false,
  includeItemizedReport = false,
  onIncludeItemizedReportChange,
  itemizedReportDisabled = false,
  defaultJobId,
  defaultReference = "",
  defaultCustomerName = "",
  onCancel,
  onConfirm,
}: Props) {
  const [jobQuery, setJobQuery] = useState(defaultReference || defaultCustomerName);
  const [jobResults, setJobResults] = useState<FlowboardJobSummary[]>([]);
  const [jobSearchError, setJobSearchError] = useState("");
  const [searchingJobs, setSearchingJobs] = useState(false);
  const [selectedJob, setSelectedJob] = useState<FlowboardJobSummary | null>(null);
  const [sentToCustomerVia, setSentToCustomerVia] = useState<FlowboardDeliveryChannel[]>(["portal"]);
  const [notes, setNotes] = useState("");
  const [customerVisibleNote, setCustomerVisibleNote] = useState(true);

  useEffect(() => {
    if (!open) return;
    setJobQuery(defaultReference || defaultCustomerName);
    setSelectedJob(defaultJobId ? { id: defaultJobId, reference: defaultReference, title: "", customerName: defaultCustomerName } : null);
    setSentToCustomerVia(["portal"]);
    setNotes("");
    setCustomerVisibleNote(true);
    setJobResults([]);
    setJobSearchError("");
  }, [open, defaultJobId, defaultReference, defaultCustomerName]);

  useEffect(() => {
    if (!open) return;
    const q = jobQuery.trim();
    if (q.length < 2) {
      setJobResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchingJobs(true);
      setJobSearchError("");
      try {
        const res = await api.searchFlowboardJobs(q);
        if (!res.success) throw new Error(res.error || "Job search failed");
        setJobResults(res.jobs);
      } catch (e) {
        setJobResults([]);
        setJobSearchError(e instanceof Error ? e.message : "Job search failed");
      } finally {
        setSearchingJobs(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [jobQuery, open]);

  if (!open) return null;

  const toggleChannel = (channel: FlowboardDeliveryChannel) => {
    setSentToCustomerVia((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel],
    );
  };

  return (
    <div className="dd-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fb-send-title">
      <div className="dd-modal-panel max-w-lg">
        <h2 id="fb-send-title" className="text-lg font-bold" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
          {message}
        </p>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
            Link FlowBoard job
          </label>
          <input
            className="dd-input"
            placeholder="Search by reference, customer, or email"
            value={jobQuery}
            onChange={(e) => {
              setJobQuery(e.target.value);
              setSelectedJob(null);
            }}
            disabled={sending}
          />
          {searchingJobs && (
            <p className="text-xs" style={{ color: "var(--text2)" }}>Searching FlowBoard jobs…</p>
          )}
          {jobSearchError && <p className="text-xs text-red-500">{jobSearchError}</p>}
          {selectedJob && (
            <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
              <div className="font-semibold" style={{ color: "var(--text)" }}>
                {selectedJob.reference || selectedJob.title || selectedJob.id}
              </div>
              <div className="text-xs" style={{ color: "var(--text2)" }}>
                {selectedJob.customerName}
                {selectedJob.customerEmail ? ` · ${selectedJob.customerEmail}` : ""}
              </div>
            </div>
          )}
          {!selectedJob && jobResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              {jobResults.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-black/5"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => {
                    setSelectedJob(job);
                    setJobQuery(job.reference || job.title || job.customerName);
                  }}
                >
                  <div className="font-semibold">{job.reference || job.title}</div>
                  <div className="text-xs" style={{ color: "var(--text2)" }}>
                    {job.customerName}
                    {job.status ? ` · ${job.status}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!selectedJob && jobQuery.trim().length >= 2 && !searchingJobs && jobResults.length === 0 && !jobSearchError && (
            <p className="text-xs" style={{ color: "var(--text2)" }}>
              No matching job — FlowBoard will create a new job from this worksheet.
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text2)" }}>
            Customer delivery
          </div>
          <div className="grid gap-2">
            {CHANNELS.map((channel) => (
              <label
                key={channel.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--surface2)" }}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={sentToCustomerVia.includes(channel.id)}
                  disabled={sending}
                  onChange={() => toggleChannel(channel.id)}
                />
                <span>
                  <span className="font-semibold" style={{ color: "var(--text)" }}>{channel.label}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: "var(--text2)" }}>{channel.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
            Note for FlowBoard team
          </label>
          <textarea
            className="dd-input min-h-[72px] resize-y"
            placeholder="Optional internal note or customer-facing message"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={sending}
          />
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={customerVisibleNote}
              disabled={sending || !notes.trim()}
              onChange={(e) => setCustomerVisibleNote(e.target.checked)}
            />
            <span style={{ color: "var(--text2)" }}>
              Show this note to the customer on the portal
            </span>
          </label>
        </div>

        {showItemizedReportOption && (
          <label
            className={`mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
              itemizedReportDisabled ? "opacity-50" : ""
            }`}
            style={{ borderColor: "var(--border)", background: "var(--surface2)" }}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeItemizedReport}
              disabled={itemizedReportDisabled || sending}
              onChange={(e) => onIncludeItemizedReportChange?.(e.target.checked)}
            />
            <span>
              <span className="font-semibold" style={{ color: "var(--text)" }}>
                Include itemized tax report
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--text2)" }}>
                Adds a line-by-line duty and VAT PDF with tariff codes and CIF values.
              </span>
            </span>
          </label>
        )}

        {error && (
          <div className="dd-notif-error mt-3 text-sm">
            {error}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                jobId: selectedJob?.id,
                sentToCustomerVia: sentToCustomerVia.length ? sentToCustomerVia : ["portal"],
                notes: notes.trim(),
                customerVisibleNote,
                includeItemizedReport,
              })
            }
            disabled={sending}
            style={{ background: "var(--accent2)" }}
          >
            {sending ? "Sending…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
