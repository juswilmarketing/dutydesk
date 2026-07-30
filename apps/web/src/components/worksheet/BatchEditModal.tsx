import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { WorksheetReviewStatus } from "@pas/shared-types";
import type { BatchEditPatch } from "@/lib/worksheet-lines";

interface Props {
  open: boolean;
  selectedCount: number;
  onCancel: () => void;
  onApply: (patch: BatchEditPatch) => void;
}

export function BatchEditModal({ open, selectedCount, onCancel, onApply }: Props) {
  const [description, setDescription] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [dutyRate, setDutyRate] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [reviewStatus, setReviewStatus] = useState<WorksheetReviewStatus | "">("");
  const [notes, setNotes] = useState("");

  if (!open) return null;

  const handleApply = () => {
    const patch: BatchEditPatch = {};
    if (description.trim()) patch.worksheet_description = description.trim();
    if (hsCode.trim()) patch.hs_code = hsCode.trim();
    if (dutyRate.trim()) patch.duty_rate = dutyRate.trim();
    if (vatRate.trim()) patch.vat_rate = vatRate.trim();
    if (reviewStatus) patch.reviewed_status = reviewStatus;
    if (notes.trim()) patch.internal_notes = notes.trim();
    onApply(patch);
    setDescription("");
    setHsCode("");
    setDutyRate("");
    setVatRate("");
    setReviewStatus("");
    setNotes("");
  };

  return (
    <div className="dd-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="batch-edit-title">
      <div className="dd-modal-panel max-w-md">
        <h2 id="batch-edit-title" className="text-base font-bold">
          Batch Edit Worksheet Lines
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
          Apply changes to {selectedCount} selected line{selectedCount !== 1 ? "s" : ""}. Leave fields blank to
          skip. Descriptions update worksheet text only — original extracted descriptions are preserved.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Description">
            <input
              className="dd-input w-full"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Common worksheet description"
            />
          </Field>
          <Field label="HS/tariff code">
            <input
              className="dd-input w-full font-mono"
              value={hsCode}
              onChange={(e) => setHsCode(e.target.value)}
              placeholder="e.g. 8539.50"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duty rate">
              <input
                className="dd-input w-full"
                value={dutyRate}
                onChange={(e) => setDutyRate(e.target.value)}
                placeholder="e.g. 20%"
              />
            </Field>
            <Field label="VAT rate">
              <input
                className="dd-input w-full"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
                placeholder="e.g. 12.5%"
              />
            </Field>
          </div>
          <Field label="Review status">
            <select
              className="dd-input w-full"
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value as WorksheetReviewStatus | "")}
            >
              <option value="">— No change —</option>
              <option value="pending">Pending review</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              className="dd-input w-full min-h-[72px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" className="text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="text-xs" onClick={handleApply} disabled={selectedCount === 0}>
            Apply to Selected
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold" style={{ color: "var(--text2)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
