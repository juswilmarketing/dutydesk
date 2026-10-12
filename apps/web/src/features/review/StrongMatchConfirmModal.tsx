import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { strongConfirmTitle, type StrongMatch } from "./classification-queue";

interface Props {
  matches: StrongMatch[];
  applying: boolean;
  onApply: (lineIds: number[]) => void;
  onDismiss: () => void;
}

const TITLE_ID = "strong-match-confirm-title";

export function StrongMatchConfirmModal({ matches, applying, onApply, onDismiss }: Props) {
  // Freeze the list at open: `matches` shrinks as lines apply, and rows must not vanish mid-apply.
  const [list] = useState(matches);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(list.map((m) => m.item.id)));
  useEffect(() => {
    if (applying) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applying, onDismiss]);
  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2 id={TITLE_ID} className="text-lg font-bold" style={{ color: "var(--accent2)" }}>
          {strongConfirmTitle(list.length)}
        </h2>
        <ul className="mt-4 space-y-1.5">
          {list.map(({ item, candidate }) => (
            <li key={item.id}>
              <label className="flex items-start gap-2 rounded-lg border p-2 text-[12px]" style={{ borderColor: "var(--border)" }}>
                <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} disabled={applying} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.desc}</span>
                  <span className="font-mono font-semibold">{candidate.code}</span>{" "}
                  <span className="dd-text-muted">{candidate.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onDismiss} disabled={applying}>Review individually</Button>
          <Button onClick={() => onApply([...checked])} disabled={applying || checked.size === 0}>
            {applying ? "Applying…" : `Apply ${checked.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
