import type { LineItem } from "@pas/shared-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  confidencePct,
  shortDescription,
} from "./classification-helpers";

type Props = {
  items: LineItem[];
  activeId: number | null;
  selectedIds: number[];
  onSelect: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
};

function normalizeStatus(item: LineItem): string {
  if (item.classification_status) return item.classification_status;
  if (item.classification_recommendation?.recommendations?.length
    || item.classification_recommendation?.recommendedCandidate) {
    return "Suggestion Ready";
  }
  return "Generating Suggestions";
}

function statusTone(status: string): "green" | "blue" | "gold" {
  if (status === "Applied" || status === "AI Applied" || status === "Clerk Edited") return "green";
  if (status === "Suggestion Ready" || status === "Recommendation Ready") return "blue";
  return "gold";
}

export function LineQueuePanel({
  items,
  activeId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onSelectAll,
}: Props) {
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const ordered = [...items].sort((a, b) => {
    const unresolved = (item: LineItem) => {
      const status = normalizeStatus(item);
      return status === "Applied" || status === "AI Applied" || status === "Clerk Edited" ? 1 : 0;
    };
    return unresolved(a) - unresolved(b);
  });

  return (
    <aside className="dd-class-queue" aria-label="Invoice line queue">
      <div className="dd-class-queue-head">
        <div className="font-semibold text-sm">Lines</div>
        <label className="flex items-center gap-1.5 text-[11px] dd-text-muted">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onSelectAll(allSelected ? [] : items.map((i) => i.id))}
          />
          Select all
        </label>
      </div>
      <div className="dd-class-queue-list">
        {ordered.map((it) => {
          const idx = items.findIndex((entry) => entry.id === it.id);
          const pct = confidencePct(
            it.classification_recommendation?.recommendations?.[0]?.confidence
            ?? it.classification_recommendation?.recommendedCandidate?.confidence
            ?? it.evidence_resolution?.confidence
            ?? it.product_resolution?.confidence
            ?? it.match_confidence
            ?? it.explainability?.confidence
            ?? it.predictions?.headings?.[0]?.score,
          );
          const interpreted =
            it.classification_recommendation?.interpretation?.productName
            || it.evidence_resolution?.resolvedProduct?.displayName
            || it.evidence_resolution?.resolvedProduct?.canonicalName
            || it.product_resolution?.selected?.canonicalName;
          const productStatus = normalizeStatus(it);
          const preferredCode =
            it.tariff_code
            || it.classification_recommendation?.recommendations?.[0]?.code
            || it.classification_recommendation?.recommendedCandidate?.code;
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              className={cn("dd-class-queue-item", active && "dd-class-queue-item-active")}
              onClick={() => onSelect(it.id)}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(it.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleSelect(it.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-mono dd-text-muted">#{idx + 1}</span>
                    <span className="text-[10px] font-semibold" style={{ color: pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--gold)" : "var(--red)" }}>
                      {pct}%
                    </span>
                  </div>
                  <div className="truncate text-[12.5px] font-medium" style={{ color: "var(--text)" }}>
                    {shortDescription(it.desc, 42)}
                  </div>
                  {interpreted && (
                    <div className="truncate text-[11px] dd-text-muted">
                      {shortDescription(interpreted, 42)}
                    </div>
                  )}
                  {preferredCode && (
                    <div className="truncate text-[11px] font-mono" style={{ color: "var(--green)" }}>
                      {preferredCode}
                    </div>
                  )}
                  <div className="mt-1">
                    <Badge tone={statusTone(productStatus)}>
                      {productStatus}
                    </Badge>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
