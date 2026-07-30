import { useMemo, useState } from "react";
import type { LineItem, ParsedLineDescription, ProductQuestionAnswer } from "@pas/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  item: LineItem;
  onFieldChange: (patch: Partial<ParsedLineDescription>) => void;
  onAnswerUpdate: (answers: ProductQuestionAnswer[]) => void;
  onResolve: () => void;
  onMarkConfirmed: () => void;
  resolving?: boolean;
};

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-[10px]">
      <span className="dd-text-muted">{label}</span>
      <input
        className="edit-cell mt-0.5 w-full text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function ParsedDescriptionPanel({
  item,
  onFieldChange,
  onAnswerUpdate,
  onResolve,
  onMarkConfirmed,
  resolving,
}: Props) {
  const parsed = item.parsed_description || item.explainability?.parsedDescription;
  const unresolved = item.identity_unresolved || parsed?.identityStatus === "unresolved";
  const [open, setOpen] = useState(Boolean(unresolved));

  const answers = item.question_answers ?? [];

  const dims = useMemo(() => {
    if (!parsed?.dimensions) return "";
    const d = parsed.dimensions;
    return [d.width, d.length, d.height].filter((n) => n != null).join(" × ") + (d.unit ? ` ${d.unit}` : "");
  }, [parsed?.dimensions]);

  if (!parsed && !unresolved) return null;
  if (!parsed) return null;

  const setAnswer = (questionId: string, field: string, value: string) => {
    const next = answers.filter((a) => a.question_id !== questionId);
    next.push({ question_id: questionId, field, value });
    onAnswerUpdate(next);
  };

  return (
    <div
      className="mt-2 rounded-lg border px-2.5 py-2 text-[11px]"
      style={{
        borderColor: unresolved ? "var(--gold)" : "var(--border)",
        background: unresolved ? "var(--gold-light)" : "var(--surface2)",
      }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between border-none bg-transparent p-0 text-left font-semibold"
        style={{ color: "var(--text)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Parsed Description {open ? "▾" : "▸"}</span>
        <Badge tone={unresolved ? "gold" : parsed.identityStatus === "resolved" ? "green" : "blue"}>
          {unresolved ? "Identity unresolved" : parsed.identityStatus}
        </Badge>
      </button>

      {open && (
        <div className="mt-2 space-y-2 leading-snug">
          <div className="dd-text-muted">
            <span className="font-medium dd-text-accent">Raw:</span> {parsed.rawDescription}
          </div>
          {parsed.normalizedDescription && (
            <div className="dd-text-muted">
              <span className="font-medium dd-text-accent">Normalized:</span> {parsed.normalizedDescription}
            </div>
          )}

          {unresolved && (
            <div className="rounded border px-2 py-1.5" style={{ borderColor: "var(--gold)", background: "var(--surface)" }}>
              <div className="font-semibold" style={{ color: "var(--gold)" }}>
                Product identity unresolved
              </div>
              <div className="mt-1 dd-text-muted">
                Detected:{" "}
                {[
                  parsed.brandOrProductFamily && `Brand/family: ${parsed.brandOrProductFamily}`,
                  parsed.partNumber && `Part: ${parsed.partNumber}`,
                  parsed.sku && `SKU: ${parsed.sku}`,
                  parsed.thickness && `Thickness: ${parsed.thickness}`,
                  dims && `Size: ${dims}`,
                  parsed.styleOrFinish && `Finish: ${parsed.styleOrFinish}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "codes and modifiers only"}
              </div>
              {parsed.missingFields.length > 0 && (
                <div className="mt-1 dd-text-muted">Missing: {parsed.missingFields.join("; ")}</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <Field
              label="Product noun / type"
              value={parsed.productType || ""}
              onChange={(v) => onFieldChange({ productType: v, productNoun: v })}
            />
            <Field
              label="Brand / family"
              value={parsed.brandOrProductFamily || ""}
              onChange={(v) => onFieldChange({ brandOrProductFamily: v })}
            />
            <Field label="Material" value={parsed.material || ""} onChange={(v) => onFieldChange({ material: v })} />
            <Field label="Function / use" value={parsed.function || ""} onChange={(v) => onFieldChange({ function: v })} />
            <Field label="Part number" value={parsed.partNumber || ""} onChange={(v) => onFieldChange({ partNumber: v })} />
            <Field label="SKU" value={parsed.sku || ""} onChange={(v) => onFieldChange({ sku: v })} />
            <Field label="Thickness" value={parsed.thickness || ""} onChange={(v) => onFieldChange({ thickness: v })} />
            <Field
              label="Finish"
              value={parsed.styleOrFinish || ""}
              onChange={(v) => onFieldChange({ styleOrFinish: v })}
            />
            <Field
              label="Colour"
              value={parsed.colour.join(", ")}
              onChange={(v) =>
                onFieldChange({
                  colour: v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <Field label="Variant" value={parsed.variant || ""} onChange={(v) => onFieldChange({ variant: v })} />
            <Field label="Dimensions" value={dims} onChange={() => undefined} />
            <Field
              label="Identity confidence"
              value={`${Math.round((parsed.identityConfidence || 0) * 100)}%`}
              onChange={() => undefined}
            />
          </div>

          {parsed.unresolvedTokens.length > 0 && (
            <div className="dd-text-muted">
              <span className="font-medium dd-text-accent">Unresolved tokens:</span>{" "}
              {parsed.unresolvedTokens.join(", ")}
            </div>
          )}

          {item.line_context?.notes?.length ? (
            <div className="dd-text-muted">
              <span className="font-medium dd-text-accent">Context:</span> {item.line_context.notes.join(" · ")}
            </div>
          ) : null}

          {(parsed.suggestedQuestions?.length || item.pending_questions?.length) && unresolved && (
            <div className="space-y-1.5">
              <div className="font-medium dd-text-accent">Clerk questions</div>
              {(parsed.suggestedQuestions?.length ? parsed.suggestedQuestions : item.pending_questions || [])
                .slice(0, 4)
                .map((q) => (
                  <label key={q.id} className="block">
                    <span className="dd-text-muted">{q.prompt}</span>
                    {q.options?.length ? (
                      <select
                        className="edit-cell mt-0.5 w-full text-[11px]"
                        value={answers.find((a) => a.question_id === q.id)?.value || ""}
                        onChange={(e) => setAnswer(q.id, q.field, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {q.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="edit-cell mt-0.5 w-full text-[11px]"
                        value={answers.find((a) => a.question_id === q.id)?.value || ""}
                        onChange={(e) => setAnswer(q.id, q.field, e.target.value)}
                        placeholder="Answer…"
                      />
                    )}
                  </label>
                ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button type="button" disabled={resolving} onClick={onResolve}>
              {resolving ? "Resolving…" : "Resolve Product"}
            </Button>
            <Button type="button" variant="secondary" onClick={onMarkConfirmed}>
              Mark Identity Confirmed
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
