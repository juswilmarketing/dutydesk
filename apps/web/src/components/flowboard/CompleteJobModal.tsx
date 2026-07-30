import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DutyDeskJobType } from "@pas/shared-types";

interface Props {
  open: boolean;
  onCancel: () => void;
  onContinue: (path: DutyDeskJobType) => void;
}

interface PathOption {
  id: DutyDeskJobType;
  title: string;
  recommended?: boolean;
  description: string;
  bullets: string[];
}

const OPTIONS: PathOption[] = [
  {
    id: "brokerage_clearance",
    title: "Brokerage Clearance",
    recommended: true,
    description: "Use this when PAS will continue with customs clearance.",
    bullets: [
      "Create or update a FlowBoard card",
      "Send worksheet PDF, tax breakdown PDF, and original invoice",
      "Send all uploaded supporting attachments",
      "Send classification and duty calculation data",
      "Start the customer approval workflow",
      "Let FlowBoard send email and WhatsApp (do not email from Duties & Taxes)",
      "Track assessment preparation, payment, and online releases",
      "Track lodgement and customs clearance completion",
    ],
  },
  {
    id: "classification_only",
    title: "Classification Only",
    description: "Use this when the customer only needs tariff classification or a quick duty estimate.",
    bullets: [
      "This is the only Duty Desk path that emails/WhatsApps the customer directly",
      "Send the worksheet once from here — not from Duties & Taxes",
      "Mark the job as completed",
      "No FlowBoard card will be created",
    ],
  },
];

export function CompleteJobModal({ open, onCancel, onContinue }: Props) {
  const [selected, setSelected] = useState<DutyDeskJobType>("brokerage_clearance");

  useEffect(() => {
    if (open) setSelected("brokerage_clearance");
  }, [open]);

  if (!open) return null;

  return (
    <div className="dd-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="complete-job-title">
      <div className="dd-modal-panel max-w-2xl">
        <h2 id="complete-job-title" className="text-lg font-bold" style={{ color: "var(--text)" }}>
          Complete Job
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
          Choose how this worksheet should continue. Customer delivery happens only through the path you pick here.
        </p>

        <div className="mt-4 grid gap-3">
          {OPTIONS.map((option) => {
            const active = selected === option.id;
            return (
              <label
                key={option.id}
                className="flex cursor-pointer gap-3 rounded-xl border p-4 transition"
                style={{
                  borderColor: active ? "var(--accent2)" : "var(--border)",
                  background: active ? "var(--surface2)" : "var(--surface)",
                  boxShadow: active ? "0 0 0 1px var(--accent2)" : "none",
                }}
              >
                <input
                  type="radio"
                  name="complete-job-path"
                  className="mt-1 shrink-0"
                  checked={active}
                  onChange={() => setSelected(option.id)}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                      {option.title}
                    </span>
                    {option.recommended && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ background: "var(--green-light)", color: "var(--green)" }}
                      >
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
                    {option.description}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {option.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-1.5 text-xs" style={{ color: "var(--text2)" }}>
                        <span style={{ color: active ? "var(--accent2)" : "var(--text3)" }}>•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onContinue(selected)} style={{ background: "var(--accent2)" }}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
