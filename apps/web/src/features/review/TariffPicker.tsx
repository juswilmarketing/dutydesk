import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LineItem, TariffEntry } from "@pas/shared-types";
import { similarCodes } from "@pas/tariff-data";
import { domainTariffConflict, type ProductDomain } from "@pas/product-intelligence";

function formatDuty(duty: string) {
  const t = duty.trim();
  if (!t) return "—";
  return t.includes("%") ? t : `${t}%`;
}

function SuggestionRow({
  entry,
  rank,
  onPick,
  compact,
  blocked,
  blockReason,
}: {
  entry: TariffEntry;
  rank?: number;
  onPick: (entry: TariffEntry) => void;
  compact?: boolean;
  blocked?: boolean;
  blockReason?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (blocked) return;
        onPick(entry);
      }}
      disabled={blocked}
      title={blocked ? blockReason || "Domain conflict — review required" : undefined}
      className={compact ? "dd-tariff-suggestion-row dd-tariff-suggestion-row-compact" : "dd-tariff-suggestion-row"}
      style={blocked ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
    >
      {rank != null && (
        <span className="dd-tariff-suggestion-rank" aria-hidden>
          {rank}
        </span>
      )}
      <span className="dd-tariff-suggestion-desc">{entry.desc}</span>
      <span className="dd-tariff-suggestion-meta">
        <span className="dd-tariff-suggestion-code">{entry.code}</span>
        <span className="dd-tariff-suggestion-duty">{formatDuty(entry.duty)}</span>
      </span>
      <span className="dd-tariff-suggestion-apply">{blocked ? "Review" : "Apply"}</span>
    </button>
  );
}

export function TariffPicker({
  item,
  onPick,
}: {
  item: LineItem;
  onPick: (entry: TariffEntry) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 420 });
  const [ackConflict, setAckConflict] = useState<string | null>(null);

  const domain = (item.predictions?.domain ||
    item.explainability?.domain ||
    item.product_profile?.attributes?.domain ||
    "unknown") as ProductDomain;

  const preferredChapters =
    item.predictions?.allowedChapters ||
    (item.predictions?.chapter ? [item.predictions.chapter] : undefined);

  const options = useMemo(
    () =>
      similarCodes(item.desc, item.tariff_code, 8, {
        preferredChapters,
        excludeFoodChapters: domain !== "food" && domain !== "unknown",
        excludedChapters: item.predictions?.excludedChapters?.slice(0, 24),
      }),
    [item.desc, item.tariff_code, preferredChapters, domain, item.predictions?.excludedChapters],
  );

  const needsReview = item.source === "ai" || !item.tariff_code;
  const top = options[0] ?? null;
  const moreCount = Math.max(0, options.length - 1);

  const conflictFor = (code: string) => domainTariffConflict(domain, code);

  const updatePanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(440, Math.max(320, window.innerWidth - 24));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    left = Math.max(12, left);

    const panelHeight = Math.min(360, options.length * 72 + 48);
    let top = rect.bottom + 8;
    if (top + panelHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - panelHeight - 8);
    }

    setPanelPos({ top, left, width });
  }, [options.length]);

  useEffect(() => {
    if (!panelOpen) return;
    updatePanelPosition();
    const onScroll = () => updatePanelPosition();
    const onResize = () => updatePanelPosition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setPanelOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [panelOpen, updatePanelPosition]);

  const pick = (entry: TariffEntry) => {
    const { conflict } = conflictFor(entry.code);
    if (conflict && ackConflict !== entry.code) {
      setAckConflict(entry.code);
      return;
    }
    onPick(entry);
    setAckConflict(null);
    setPanelOpen(false);
  };

  if (options.length === 0) return null;

  const topConflict = top ? conflictFor(top.code) : { conflict: false, message: null };

  return (
    <div ref={anchorRef} className="dd-tariff-picker mt-1.5">
      {(item.explainability?.domainConflictWarning ||
        (item.tariff_code && conflictFor(item.tariff_code).conflict)) && (
        <div
          className="mb-1.5 rounded-md px-2 py-1.5 text-[10px] leading-snug"
          style={{ background: "var(--gold-light)", color: "var(--gold)" }}
        >
          {item.explainability?.domainConflictWarning || conflictFor(item.tariff_code!).message}
          {" "}Apply is blocked until you confirm a conflicting suggestion.
        </div>
      )}

      {needsReview && top && (
        <div className="dd-tariff-suggestion-inline">
          <div className="dd-tariff-suggestion-inline-label">Suggested tariff</div>
          <SuggestionRow
            entry={top}
            onPick={pick}
            compact
            blocked={topConflict.conflict && ackConflict !== top.code}
            blockReason={topConflict.message}
          />
          {topConflict.conflict && ackConflict === top.code && (
            <button
              type="button"
              className="mt-1 text-[10px] underline"
              style={{ color: "var(--gold)" }}
              onClick={() => pick(top)}
            >
              Confirm apply despite domain conflict
            </button>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {!needsReview && top && !(topConflict.conflict && ackConflict !== top.code) && (
          <button
            type="button"
            onClick={() => pick(top)}
            className="dd-tariff-quick-apply"
            title={`Apply ${top.code} — ${top.desc}`}
          >
            Suggested: <span className="font-mono">{top.code}</span>
            <span className="dd-tariff-suggestion-duty ml-1">{formatDuty(top.duty)}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setPanelOpen((o) => !o);
            if (!panelOpen) requestAnimationFrame(updatePanelPosition);
          }}
          className="dd-tariff-more-btn"
          aria-expanded={panelOpen}
        >
          {panelOpen ? "Hide" : needsReview ? `All ${options.length} matches` : `${options.length} similar`}
        </button>
      </div>

      {panelOpen &&
        createPortal(
          <div
            ref={panelRef}
            className="dd-tariff-panel"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
            role="dialog"
            aria-label="T&T tariff code suggestions"
          >
            <div className="dd-tariff-panel-header">
              <span>T&amp;T tariff codes — click to apply</span>
              <button type="button" className="dd-tariff-panel-close" onClick={() => setPanelOpen(false)}>
                ✕
              </button>
            </div>
            <div className="dd-tariff-panel-list">
              {options.map((o, i) => {
                const c = conflictFor(o.code);
                return (
                  <div key={o.code}>
                    <SuggestionRow
                      entry={o}
                      rank={i + 1}
                      onPick={pick}
                      blocked={c.conflict && ackConflict !== o.code}
                      blockReason={c.message}
                    />
                    {c.conflict && ackConflict === o.code && (
                      <button
                        type="button"
                        className="w-full px-2 pb-2 text-left text-[10px] underline"
                        style={{ color: "var(--gold)" }}
                        onClick={() => pick(o)}
                      >
                        Confirm apply despite domain conflict
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {moreCount > 0 && needsReview && (
              <div className="dd-tariff-panel-footer">
                {moreCount} alternative{moreCount !== 1 ? "s" : ""} — scroll if needed
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
