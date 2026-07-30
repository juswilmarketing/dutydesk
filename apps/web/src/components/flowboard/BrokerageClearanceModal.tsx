import { CheckCircle2, FileText, Lock, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { JobAttachmentItem } from "@/lib/job-attachments";
import { selectedAttachmentCount } from "@/lib/job-attachments";

export interface BrokerageSendSuccess {
  message: string;
  reference?: string;
  jobUrl?: string;
  sentAt: string;
  attachmentNames: string[];
}

interface Props {
  open: boolean;
  checklist: JobAttachmentItem[];
  onToggle: (id: string) => void;
  sending: boolean;
  error?: string;
  success?: BrokerageSendSuccess | null;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenFlowboard: () => void;
}

/** Workflow that FlowBoard will create when it receives the job package. */
export const FLOWBOARD_WORKFLOW_STEPS = [
  "Worksheet received from Duty Desk",
  "Send worksheet to customer",
  "Customer approval received",
  "Assessment prepared",
  "Assessment paid",
  "Online releases completed",
  "Ready to lodge for clearance",
  "Lodged with Customs",
  "Customs clearance completed",
];

export function BrokerageClearanceModal({
  open,
  checklist,
  onToggle,
  sending,
  error,
  success,
  onCancel,
  onConfirm,
  onOpenFlowboard,
}: Props) {
  if (!open) return null;

  const count = selectedAttachmentCount(checklist);
  const hasFailed = Boolean(error) && !sending;

  return (
    <div className="dd-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="brokerage-send-title">
      <div className="dd-modal-panel max-w-lg">
        {success ? (
          <div className="animate-fade-up">
            <div className="text-center">
              <div
                className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "var(--green-light)", color: "var(--green)" }}
              >
                <CheckCircle2 size={28} />
              </div>
              <h2 className="text-base font-bold" style={{ color: "var(--green)" }}>
                {success.message}
              </h2>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              {success.reference && (
                <Row label="FlowBoard card reference" value={<span className="font-mono">{success.reference}</span>} />
              )}
              <Row label="Sent" value={new Date(success.sentAt).toLocaleString()} />
              <Row label="Attachments sent" value={String(success.attachmentNames.length)} />
            </div>

            <div className="mt-3">
              <div className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text2)" }}>
                Attachments
              </div>
              <ul className="space-y-1">
                {success.attachmentNames.map((name) => (
                  <li key={name} className="flex items-center gap-2 text-xs" style={{ color: "var(--text2)" }}>
                    <Paperclip size={12} className="shrink-0" />
                    <span className="truncate">{name}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <div className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text2)" }}>
                Workflow created
              </div>
              <ul className="space-y-1">
                {FLOWBOARD_WORKFLOW_STEPS.map((step) => (
                  <li key={step} className="flex items-start gap-1.5 text-xs" style={{ color: "var(--text2)" }}>
                    <span style={{ color: "var(--accent2)" }}>•</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onCancel}>
                Done
              </Button>
              <Button onClick={onOpenFlowboard} style={{ background: "#1B4F8A" }}>
                Open in FlowBoard
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="brokerage-send-title" className="text-lg font-bold" style={{ color: "var(--text)" }}>
              Send Complete Job to FlowBoard?
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
              This will send the worksheet, tax breakdown, classification details, original invoice, and all supporting
              attachments to FlowBoard. FlowBoard will handle customer email, WhatsApp delivery, follow-ups, approval
              tracking, assessment tracking, online releases, and clearance workflow.
            </p>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
                Attachments
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ background: "var(--surface2)", color: "var(--text)" }}
              >
                {count} selected
              </span>
            </div>

            <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {checklist.map((item) => (
                <label
                  key={item.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
                    item.required ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface2)",
                    opacity: item.required ? 0.95 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={item.selected}
                    disabled={item.required || sending}
                    onChange={() => !item.required && onToggle(item.id)}
                  />
                  <FileText size={16} className="mt-0.5 shrink-0" style={{ color: "var(--text3)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold" style={{ color: "var(--text)" }}>
                        {item.category}
                      </span>
                      {item.required && (
                        <span
                          className="flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold uppercase"
                          style={{ background: "var(--accent-light)", color: "var(--accent)" }}
                        >
                          <Lock size={8} /> Required
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text2)" }}>
                      {item.label}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {error && <div className="dd-notif-error mt-3 text-sm">{error}</div>}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onCancel} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={onConfirm} disabled={sending} style={{ background: "var(--accent2)" }}>
                {sending ? "Sending…" : hasFailed ? "Retry Send" : "Complete & Send to FlowBoard"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5" style={{ borderColor: "var(--border)" }}>
      <span style={{ color: "var(--text2)" }}>{label}</span>
      <span className="text-right font-medium" style={{ color: "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}
