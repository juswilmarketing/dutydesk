import { useState } from "react";
import type { LiquidCompositionComponent, LiquidProductProfile, LineItem } from "@pas/shared-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

type Props = {
  item: LineItem;
  onProfileChange: (profile: LiquidProductProfile) => void;
  onApproveComposition?: () => void;
};

export function CompositionPanel({ item, onProfileChange, onApproveComposition }: Props) {
  const profile = item.liquid_profile;
  const conf = item.liquid_confidences;
  const [open, setOpen] = useState(Boolean(profile));
  const [extractText, setExtractText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!profile && !item.liquid_requires_review) return null;
  if (!profile) return null;

  const updateComponent = (idx: number, patch: Partial<LiquidCompositionComponent>) => {
    const composition = profile.composition.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onProfileChange({ ...profile, composition });
  };

  const addComponent = () => {
    onProfileChange({
      ...profile,
      composition: [
        ...profile.composition,
        {
          name: "",
          normalizedName: "",
          percentage: null,
          concentrationUnit: "%",
          casNumber: null,
          role: "other",
          confidence: 1,
          source: "clerk",
        },
      ],
    });
  };

  const markActive = (idx: number) => {
    const name = profile.composition[idx]?.name;
    if (!name) return;
    const composition = profile.composition.map((c, i) =>
      i === idx ? { ...c, role: "active" as const } : c,
    );
    const activeIngredients = Array.from(new Set([...(profile.activeIngredients || []), name]));
    onProfileChange({ ...profile, composition, activeIngredients });
  };

  const setBaseSolvent = (idx: number, kind: "base" | "solvent") => {
    const name = profile.composition[idx]?.name;
    if (!name) return;
    const composition = profile.composition.map((c, i) =>
      i === idx ? { ...c, role: kind === "base" ? ("base" as const) : ("solvent" as const) } : c,
    );
    onProfileChange({
      ...profile,
      composition,
      baseSubstance: kind === "base" ? name : profile.baseSubstance,
      solvent: kind === "solvent" ? name : profile.solvent,
    });
  };

  const setEssential = (idx: number) => {
    const name = profile.composition[idx]?.name;
    if (!name) return;
    onProfileChange({
      ...profile,
      essentialCharacterComponent: name,
      essentialCharacterReason: "Set by clerk on Classification screen",
    });
  };

  const runExtract = async (source: string) => {
    if (!extractText.trim()) return;
    setBusy(true);
    try {
      const { composition } = await api.extractLiquidComposition(extractText, source);
      const merged = [...profile.composition];
      for (const c of composition) {
        if (!merged.some((m) => m.normalizedName === c.normalizedName)) merged.push(c);
      }
      onProfileChange({
        ...profile,
        composition: merged,
        documentsAvailable: Array.from(new Set([...(profile.documentsAvailable || []), source])),
      });
      setExtractText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between border-none bg-transparent p-0 text-left font-semibold"
        style={{ color: "var(--text)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Composition {open ? "▾" : "▸"}</span>
        <div className="flex gap-1">
          {profile.liquidType && <Badge tone="blue">{profile.liquidType}</Badge>}
          {item.liquid_requires_review && <Badge tone="gold">Review</Badge>}
        </div>
      </button>

      {open && (
        <div className="mt-2 space-y-2 leading-snug dd-text-muted">
          <div>
            Form: {profile.physicalForm || "—"} · Use: {profile.intendedUse || profile.primaryFunction || "—"}
            {profile.essentialCharacterComponent && ` · Essential: ${profile.essentialCharacterComponent}`}
          </div>
          {conf && (
            <div>
              Confidence — composition {Math.round(conf.compositionCompleteness * 100)}% · active{" "}
              {Math.round(conf.activeIngredient * 100)}% · use {Math.round(conf.primaryUse * 100)}% · essential{" "}
              {Math.round(conf.essentialCharacter * 100)}% · final {Math.round(conf.finalClassification * 100)}%
            </div>
          )}
          {item.liquid_conflicts?.length ? (
            <div style={{ color: "var(--gold)" }}>
              {item.liquid_conflicts.map((c, i) => (
                <div key={i}>⚠ {c.description}</div>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="dd-text-muted">
                  <th className="pr-2">Component</th>
                  <th className="pr-2">%</th>
                  <th className="pr-2">CAS</th>
                  <th className="pr-2">Role</th>
                  <th className="pr-2">Src</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {profile.composition.map((c, idx) => (
                  <tr key={idx}>
                    <td className="pr-1 py-0.5">
                      <input
                        className="edit-cell w-28 text-[11px]"
                        value={c.name}
                        onChange={(e) =>
                          updateComponent(idx, {
                            name: e.target.value,
                            normalizedName: e.target.value.toLowerCase(),
                          })
                        }
                      />
                    </td>
                    <td className="pr-1">
                      <input
                        className="edit-cell w-12 text-[11px]"
                        value={c.percentage ?? ""}
                        onChange={(e) =>
                          updateComponent(idx, {
                            percentage: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="pr-1">
                      <input
                        className="edit-cell w-16 text-[11px]"
                        value={c.casNumber ?? ""}
                        onChange={(e) => updateComponent(idx, { casNumber: e.target.value || null })}
                      />
                    </td>
                    <td className="pr-1">{c.role}</td>
                    <td className="pr-1">{c.source}</td>
                    <td className="whitespace-nowrap">
                      <button type="button" className="mr-1 text-[10px] underline" onClick={() => markActive(idx)}>
                        Active
                      </button>
                      <button type="button" className="mr-1 text-[10px] underline" onClick={() => setBaseSolvent(idx, "base")}>
                        Base
                      </button>
                      <button type="button" className="mr-1 text-[10px] underline" onClick={() => setBaseSolvent(idx, "solvent")}>
                        Solvent
                      </button>
                      <button type="button" className="text-[10px] underline" onClick={() => setEssential(idx)}>
                        Essential
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-1">
            <Button variant="secondary" className="h-7 px-2 text-[10px]" onClick={addComponent}>
              Add Component
            </Button>
            {onApproveComposition && (
              <Button variant="ghost" className="h-7 px-2 text-[10px]" onClick={onApproveComposition}>
                Approve Composition
              </Button>
            )}
          </div>

          <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1 font-semibold">Paste SDS / COA / label excerpt (normalized only — not sent whole to AI)</div>
            <textarea
              className="edit-cell min-h-[56px] w-full text-[11px]"
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              placeholder="e.g. 70% isopropyl alcohol, 30% water…"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {(["SDS", "COA", "label", "product specification"] as const).map((src) => (
                <Button
                  key={src}
                  variant="secondary"
                  className="h-7 px-2 text-[10px]"
                  disabled={busy || !extractText.trim()}
                  onClick={() => runExtract(src)}
                >
                  Extract from {src}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
