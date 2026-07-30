import type { LineItem, ProductQuestionAnswer } from "@pas/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildRankedSuggestions,
  clarificationQuestions,
  clerkReviewStatus,
  structuredExplanation,
} from "./classification-helpers";

type Props = {
  item: LineItem;
  updating?: boolean;
  answers: ProductQuestionAnswer[];
  onAnswer: (answers: ProductQuestionAnswer[]) => void;
  onUpdateClassification: () => void;
  onSearchSupplierHistory: () => void;
  onOpenAssistant?: () => void;
  compact?: boolean;
};

export function AiAssistantPanel({
  item,
  updating,
  answers,
  onAnswer,
  onUpdateClassification,
  onSearchSupplierHistory,
}: Props) {
  const suggestions = buildRankedSuggestions(item);
  const recommended = suggestions.find((s) => s.label === "Recommended") || suggestions[0] || null;
  const expl = structuredExplanation(item, recommended);
  const questions = clarificationQuestions(item);
  const status = clerkReviewStatus(item);

  const setAnswer = (questionId: string, field: string, value: string) => {
    const next = answers.filter((a) => a.question_id !== questionId);
    next.push({ question_id: questionId, field, value });
    onAnswer(next);
  };

  if (!item.product_confirmed && !item.classification_recommendation) {
    const product = item.product_resolution?.suggestions[0] || null;
    return (
      <aside className="dd-class-assistant" aria-label="AI Classification Assistant">
        <div className="dd-class-assistant-head">
          <div className="font-semibold text-sm">Classification Assistant</div>
          <Badge tone="blue">Suggestions first</Badge>
        </div>
        <section className="dd-class-assistant-block">
          <div className="dd-class-assistant-label">Working from</div>
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {product?.canonicalName || item.desc}
          </div>
          <div className="mt-2 text-[11.5px] dd-text-muted">
            Tariff suggestions generate automatically. Use this panel for optional refinements.
          </div>
        </section>
      </aside>
    );
  }

  return (
    <aside className="dd-class-assistant" aria-label="AI Classification Assistant">
      <div className="dd-class-assistant-head">
        <div className="font-semibold text-sm">AI Assistant</div>
        <Badge tone="blue">Guided</Badge>
      </div>

      <section className="dd-class-assistant-block">
        <div className="dd-class-assistant-label">AI identified this product as</div>
        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {expl.productType}
        </div>
      </section>

      <section className="dd-class-assistant-block">
        <div className="dd-class-assistant-label">Suggested next action</div>
        <div className="text-[12.5px] leading-snug">{expl.nextStep}</div>
      </section>

      {status === "no_reliable_match" && (
        <section className="dd-class-assistant-block dd-class-warn">
          <div className="font-semibold text-[12px]">No reliable tariff suggestion found</div>
          <ul className="mt-1 list-disc pl-4 text-[11.5px] space-y-0.5">
            <li>Answer clarification questions</li>
            <li>Upload specification or SDS</li>
            <li>Search previous classifications</li>
            <li>Search tariff manually</li>
            <li>Ask supervisor</li>
          </ul>
        </section>
      )}

      {questions.length > 0 && (
        <section className="dd-class-assistant-block">
          <div className="dd-class-assistant-label">Clarification questions</div>
          <div className="space-y-2 mt-1">
            {questions.map((q) => {
              const current = answers.find((a) => a.question_id === q.id)?.value ?? "";
              return (
                <label key={q.id} className="block text-[11.5px]">
                  <span className="mb-0.5 block font-medium">
                    {q.prompt}
                    {q.required ? " *" : ""}
                  </span>
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
              className="h-7 px-2 text-[10px] w-full"
              disabled={updating}
              onClick={onUpdateClassification}
            >
              {updating ? "Updating…" : "Update classification"}
            </Button>
          </div>
        </section>
      )}

      <section className="dd-class-assistant-block">
        <div className="dd-class-assistant-label">Supplier & history</div>
        <div className="space-y-1.5">
          {item.supplier_history_id ? (
            <div className="text-[12px]">
              <Badge tone="green">Previous Approved Match</Badge>
              <div className="mt-1 dd-text-muted text-[11px]">
                Used {item.supplier_usage_count ?? 1}×
                {item.supplier_last_used_at ? ` · last ${item.supplier_last_used_at.slice(0, 10)}` : ""}
              </div>
            </div>
          ) : (
            <div className="text-[11.5px] dd-text-muted">No supplier history match for this SKU yet.</div>
          )}
          <Button variant="secondary" className="h-7 px-2 text-[10px] w-full" onClick={onSearchSupplierHistory}>
            Search supplier history
          </Button>
        </div>
      </section>

      <section className="dd-class-assistant-block">
        <div className="dd-class-assistant-label">Why (structured)</div>
        <ul className="list-disc pl-4 text-[11.5px] space-y-0.5">
          {expl.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        {expl.uncertainty.length > 0 && (
          <>
            <div className="dd-class-assistant-label mt-2">Uncertainty</div>
            <ul className="list-disc pl-4 text-[11.5px] space-y-0.5">
              {expl.uncertainty.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  );
}
