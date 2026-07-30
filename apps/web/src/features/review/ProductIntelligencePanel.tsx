import { useState } from "react";
import type { LineItem, ProductQuestionAnswer } from "@pas/shared-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  item: LineItem;
  onAnswerUpdate: (answers: ProductQuestionAnswer[]) => void;
  onUpdateClassification: () => void;
  updating?: boolean;
};

export function ProductIntelligencePanel({
  item,
  onAnswerUpdate,
  onUpdateClassification,
  updating,
}: Props) {
  const [open, setOpen] = useState(Boolean(item.pending_questions?.length));
  const profile = item.product_profile;
  const pred = item.predictions;
  const explain = item.explainability;
  const answers = item.question_answers ?? [];

  if (!profile && !explain) return null;

  const setAnswer = (questionId: string, field: string, value: string) => {
    const next = answers.filter((a) => a.question_id !== questionId);
    next.push({ question_id: questionId, field, value });
    onAnswerUpdate(next);
  };

  const attrs = Object.entries(explain?.attributes ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);

  return (
    <div className="mt-2 rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between border-none bg-transparent p-0 text-left font-semibold"
        style={{ color: "var(--text)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Product Intelligence {open ? "▾" : "▸"}</span>
        {pred?.chapter && (
          <Badge tone="blue">Ch {pred.chapter}</Badge>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2 leading-snug dd-text-muted">
          <div>
            <span className="font-medium dd-text-accent">Product:</span>{" "}
            {explain?.normalizedName || profile?.normalizedName || profile?.productName}
          </div>
          {(explain?.industry || profile?.industry) && (
            <div>
              <span className="font-medium dd-text-accent">Industry:</span>{" "}
              {explain?.industry || profile?.industry}
              {(explain?.productFamily || profile?.productFamily) &&
                ` · ${explain?.productFamily || profile?.productFamily}`}
            </div>
          )}
          {attrs.length > 0 && (
            <div>
              <span className="font-medium dd-text-accent">Attributes:</span> {attrs.join(" · ")}
            </div>
          )}
          {item.inferred_attributes && item.inferred_attributes.length > 0 && (
            <div>
              <span className="font-medium dd-text-accent">Inferred:</span>{" "}
              {item.inferred_attributes
                .slice(0, 8)
                .map((a) => {
                  const conf = item.attribute_confidences?.[a.key] ?? a.confidence;
                  return `${a.key}=${a.value} (${Math.round(conf * 100)}%)`;
                })
                .join(" · ")}
            </div>
          )}
          <div>
            <span className="font-medium dd-text-accent">Prediction:</span>{" "}
            {pred?.chapter ? `Chapter ${pred.chapter}` : "—"}
            {pred?.headings?.[0] &&
              ` → ${pred.headings[0].heading} (${Math.round((pred.headings[0].score || 0) * 100)}%)`}
            {explain?.confidence != null && ` · conf ${Math.round(explain.confidence * 100)}%`}
          </div>
          {(explain?.domainLabel || pred?.domainLabel || explain?.classificationPath?.length) && (
            <div className="rounded-md border p-2 space-y-1" style={{ borderColor: "var(--border)" }}>
              <div className="font-semibold" style={{ color: "var(--text)" }}>
                Classification path
              </div>
              <div>
                <span className="font-medium dd-text-accent">Product identity:</span>{" "}
                {profile?.productType || explain?.productFamily || "—"}
              </div>
              <div>
                <span className="font-medium dd-text-accent">Domain:</span>{" "}
                {explain?.domainLabel || pred?.domainLabel || "—"}
              </div>
              <div>
                <span className="font-medium dd-text-accent">Predicted chapter:</span>{" "}
                {pred?.chapter || explain?.predictedChapter || "—"}
              </div>
              <div>
                <span className="font-medium dd-text-accent">Candidate heading:</span>{" "}
                {pred?.headings?.[0]?.heading || explain?.predictedHeading || "—"}
              </div>
              <div>
                <span className="font-medium dd-text-accent">Explanatory Note validation:</span>{" "}
                {explain?.enValidationStatus ||
                  pred?.enValidation?.[0]?.status ||
                  "After candidates only (not used for initial search)"}
              </div>
              <div>
                <span className="font-medium dd-text-accent">Final tariff:</span>{" "}
                {item.tariff_code || pred?.predictedHsCode || "—"}
              </div>
            </div>
          )}
          {explain?.domainConflictWarning && (
            <div
              className="rounded-md px-2 py-1.5 text-[11px]"
              style={{ background: "var(--gold-light)", color: "var(--gold)" }}
            >
              {explain.domainConflictWarning}
            </div>
          )}
          {pred?.headings && pred.headings.length > 1 && (
            <div>
              <span className="font-medium dd-text-accent">Candidates:</span>{" "}
              {pred.headings
                .slice(0, 5)
                .map((h) => h.hs_code)
                .join(", ")}
            </div>
          )}
          {explain?.knowledgeSources?.length ? (
            <div>
              <span className="font-medium dd-text-accent">Sources:</span>{" "}
              {explain.knowledgeSources.join(" · ")}
            </div>
          ) : null}
          {explain?.reasoningSummary && (
            <div className="italic">{explain.reasoningSummary}</div>
          )}

          {(item.pending_questions?.length ?? 0) > 0 && (
            <div className="space-y-1.5 rounded-md border p-2" style={{ borderColor: "var(--border)" }}>
              <div className="font-semibold" style={{ color: "var(--gold)" }}>
                Questions to refine classification
              </div>
              {item.pending_questions!.map((q) => {
                const current = answers.find((a) => a.question_id === q.id)?.value ?? "";
                return (
                  <label key={q.id} className="block">
                    <span className="mb-0.5 block">{q.prompt}{q.required ? " *" : ""}</span>
                    {q.options?.length ? (
                      <select
                        className="edit-cell w-full text-[11px]"
                        value={current}
                        onChange={(e) => setAnswer(q.id, q.field, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {q.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="edit-cell w-full text-[11px]"
                        value={current}
                        onChange={(e) => setAnswer(q.id, q.field, e.target.value)}
                        placeholder="Answer…"
                      />
                    )}
                  </label>
                );
              })}
              <Button
                variant="secondary"
                className="mt-1 h-7 px-2 text-[10px]"
                disabled={updating}
                onClick={onUpdateClassification}
              >
                {updating ? "Updating…" : "Update classification"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
