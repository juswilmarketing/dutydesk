import { useEffect, useMemo, useState } from "react";
import type { LiquidCompositionRuleEntry } from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

export function LiquidCompositionRulesPage() {
  const [rules, setRules] = useState<LiquidCompositionRuleEntry[]>([]);
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]);
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"rules" | "profiles" | "conflicts">("rules");

  const selected = useMemo(() => rules.find((r) => r.id === selectedId) ?? null, [rules, selectedId]);

  const load = async () => {
    const [r, p, c] = await Promise.all([
      api.getLiquidCompositionRules(),
      api.getLiquidCompositions(),
      api.getLiquidConflicts(),
    ]);
    setRules(r.entries);
    setProfiles(p.entries);
    setConflicts(c.entries);
    if (!selectedId && r.entries[0]) setSelectedId(r.entries[0].id);
  };

  useEffect(() => {
    load().catch((e) => setMessage(e instanceof Error ? e.message : "Load failed"));
  }, []);

  useEffect(() => {
    if (!selected) {
      setJsonDraft("");
      return;
    }
    setJsonDraft(
      JSON.stringify(
        {
          display_name: selected.display_name,
          typical_chapters: selected.typical_chapters,
          required_fields: selected.required_fields,
          composition_thresholds: selected.composition_thresholds,
          active_ingredient_mappings: selected.active_ingredient_mappings,
          solvent_base_mappings: selected.solvent_base_mappings,
          chemical_synonyms: selected.chemical_synonyms,
          cas_mappings: selected.cas_mappings,
          classification_hints: selected.classification_hints,
          status: selected.status,
        },
        null,
        2,
      ),
    );
  }, [selected]);

  return (
    <PageLayout>
      <PageHeader
        icon="🧪"
        title="Liquid Composition Rules"
        description="Manage liquid types, composition thresholds, CAS/synonym mappings, and reusable composition profiles"
        actions={
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                const type = window.prompt("Liquid type key (e.g. cleaning_preparation)");
                if (!type?.trim()) return;
                const name = window.prompt("Display name", type) || type;
                await api.saveLiquidCompositionRule({
                  liquid_type: type.trim(),
                  display_name: name.trim(),
                  typical_chapters: [],
                  required_fields: ["liquidType", "intendedUse", "composition"],
                });
                setMessage("Created");
                await load();
              }}
            >
              Add Liquid Type
            </Button>
            <Button variant="secondary" onClick={() => load()}>
              Refresh
            </Button>
          </div>
        }
      />
      {message && <div className="mb-3 text-sm dd-text-muted">{message}</div>}

      <div className="mb-3 flex gap-2">
        {(["rules", "profiles", "conflicts"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "primary" : "secondary"} onClick={() => setTab(t)}>
            {t === "rules" ? "Rules" : t === "profiles" ? "Approved Profiles" : "Conflicts"}
          </Button>
        ))}
      </div>

      {tab === "rules" && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="p-3">
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {rules.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm"
                  style={{
                    borderColor: r.id === selectedId ? "var(--accent)" : "var(--border)",
                    background: r.id === selectedId ? "var(--surface2)" : "transparent",
                  }}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span>{r.display_name}</span>
                  <Badge tone="blue">{r.liquid_type}</Badge>
                </button>
              ))}
            </div>
          </Card>
          {selected ? (
            <Card className="space-y-3 p-4">
              <div className="text-sm font-semibold">{selected.display_name}</div>
              <textarea
                className="edit-cell min-h-[420px] w-full font-mono text-xs"
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
              />
              <Button
                onClick={async () => {
                  try {
                    const payload = JSON.parse(jsonDraft);
                    await api.updateLiquidCompositionRule(selected.id, payload);
                    setMessage("Saved");
                    await load();
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "Invalid JSON");
                  }
                }}
              >
                Save Rule
              </Button>
            </Card>
          ) : (
            <Card className="p-6 text-sm dd-text-muted">Select a liquid type.</Card>
          )}
        </div>
      )}

      {tab === "profiles" && (
        <Card className="overflow-x-auto p-3">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Product</th>
                <th>Supplier</th>
                <th>Model</th>
                <th>Essential</th>
                <th>Approved</th>
                <th>Uses</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={String(p.id)}>
                  <td>{String(p.product_name || "—")}</td>
                  <td>{String(p.supplier_name || "—")}</td>
                  <td>{String(p.model_number || "—")}</td>
                  <td>{String(p.essential_character_component || "—")}</td>
                  <td>{p.approved ? "Yes" : "No"}</td>
                  <td>{String(p.usage_count ?? 0)}</td>
                  <td>
                    {!p.approved && (
                      <Button
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        onClick={async () => {
                          await api.approveLiquidComposition(Number(p.id));
                          await load();
                        }}
                      >
                        Approve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!profiles.length && (
                <tr>
                  <td colSpan={7} className="dd-text-muted">
                    No saved compositions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "conflicts" && (
        <Card className="overflow-x-auto p-3">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={String(c.id)}>
                  <td>{String(c.conflict_type)}</td>
                  <td>{String(c.description)}</td>
                  <td>{String(c.status)}</td>
                </tr>
              ))}
              {!conflicts.length && (
                <tr>
                  <td colSpan={3} className="dd-text-muted">
                    No open conflicts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </PageLayout>
  );
}
