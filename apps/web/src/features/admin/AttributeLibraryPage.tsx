import { useEffect, useMemo, useState } from "react";
import type {
  AttributeDefinition,
  ProductAttributeLibraryEntry,
} from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

function emptyAttr(): AttributeDefinition {
  return { key: "", label: "", prompt: "", options: [], synonyms: [], confidenceThreshold: 0.75 };
}

export function AttributeLibraryPage() {
  const [entries, setEntries] = useState<ProductAttributeLibraryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    productFamily: string;
    industry: string;
    typicalChapters: string;
    requiredAttributes: AttributeDefinition[];
    optionalAttributes: AttributeDefinition[];
    questionOrder: string;
    validationRulesJson: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const { entries: rows } = await api.getAttributeLibrary();
      setEntries(rows);
      if (selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
      else if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({
      productFamily: selected.productFamily,
      industry: selected.industry,
      typicalChapters: (selected.typicalChapters || []).join(", "),
      requiredAttributes: selected.requiredAttributes?.length
        ? selected.requiredAttributes.map((a) => ({ ...a }))
        : [],
      optionalAttributes: selected.optionalAttributes?.length
        ? selected.optionalAttributes.map((a) => ({ ...a }))
        : [],
      questionOrder: (selected.questionOrder || []).join(", "),
      validationRulesJson: JSON.stringify(selected.validationRules || [], null, 2),
    });
  }, [selected]);

  const createFamily = async () => {
    const family = window.prompt("Product family name (e.g. Footwear)");
    if (!family?.trim()) return;
    const industry = window.prompt("Industry code", "consumer") || "consumer";
    await api.saveAttributeLibrary({
      productFamily: family.trim(),
      industry: industry.trim(),
      typicalChapters: [],
      requiredAttributes: [],
      optionalAttributes: [],
      questionOrder: [],
      validationRules: [],
    });
    setMessage(`Created ${family}`);
    await load();
  };

  const saveDraft = async () => {
    if (!draft || !selected) return;
    let validationRules = [];
    try {
      validationRules = JSON.parse(draft.validationRulesJson || "[]");
    } catch {
      setMessage("Validation rules must be valid JSON");
      return;
    }
    const required = draft.requiredAttributes.filter((a) => a.key.trim() && a.prompt.trim());
    const optional = draft.optionalAttributes.filter((a) => a.key.trim() && a.prompt.trim());
    const order =
      draft.questionOrder
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) || [...required, ...optional].map((a) => a.key);

    await api.updateAttributeLibrary(selected.id, {
      productFamily: draft.productFamily.trim(),
      industry: draft.industry.trim(),
      typicalChapters: draft.typicalChapters
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requiredAttributes: required,
      optionalAttributes: optional,
      questionOrder: order,
      validationRules,
    });
    setMessage("Saved");
    await load();
  };

  const updateAttr = (
    kind: "requiredAttributes" | "optionalAttributes",
    index: number,
    patch: Partial<AttributeDefinition>,
  ) => {
    if (!draft) return;
    const list = [...draft[kind]];
    list[index] = { ...list[index], ...patch };
    setDraft({ ...draft, [kind]: list });
  };

  const addAttr = (kind: "requiredAttributes" | "optionalAttributes") => {
    if (!draft) return;
    setDraft({ ...draft, [kind]: [...draft[kind], emptyAttr()] });
  };

  const removeAttr = (kind: "requiredAttributes" | "optionalAttributes", index: number) => {
    if (!draft) return;
    setDraft({ ...draft, [kind]: draft[kind].filter((_, i) => i !== index) });
  };

  const exportProfiles = async () => {
    const data = await api.exportAttributeLibrary();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attribute-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Exported");
  };

  const importProfiles = async () => {
    const raw = window.prompt("Paste Attribute Library JSON (full export or { profiles: [...] })");
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const profiles = Array.isArray(parsed) ? parsed : parsed.profiles;
      if (!Array.isArray(profiles)) throw new Error("Expected profiles array");
      const res = await api.importAttributeLibrary(profiles);
      setMessage(`Imported ${res.imported} profiles`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <PageLayout>
      <PageHeader
        icon="🧩"
        title="Product Attribute Library"
        description="Data-driven required/optional attributes per product family — no hardcoded industry logic"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={createFamily}>Create Family</Button>
            <Button variant="secondary" onClick={exportProfiles}>
              Export
            </Button>
            <Button variant="secondary" onClick={importProfiles}>
              Import
            </Button>
            <Button variant="ghost" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {message && <div className="mb-3 text-sm dd-text-muted">{message}</div>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide dd-text-muted">Families</div>
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {entries.map((e) => (
              <button
                key={e.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm"
                style={{
                  borderColor: e.id === selectedId ? "var(--accent)" : "var(--border)",
                  background: e.id === selectedId ? "var(--surface2)" : "transparent",
                }}
                onClick={() => setSelectedId(e.id)}
              >
                <span>{e.productFamily}</span>
                <Badge tone={e.status === "active" ? "green" : "default"}>{e.industry}</Badge>
              </button>
            ))}
            {!entries.length && <div className="text-sm dd-text-muted">No families yet.</div>}
          </div>
        </Card>

        {draft && selected ? (
          <Card className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block dd-text-muted">Product Family</span>
                <input
                  className="edit-cell w-full"
                  value={draft.productFamily}
                  onChange={(e) => setDraft({ ...draft, productFamily: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block dd-text-muted">Industry</span>
                <input
                  className="edit-cell w-full"
                  value={draft.industry}
                  onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block dd-text-muted">Typical Chapters (comma-separated)</span>
                <input
                  className="edit-cell w-full"
                  value={draft.typicalChapters}
                  onChange={(e) => setDraft({ ...draft, typicalChapters: e.target.value })}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block dd-text-muted">Question Order (attribute keys)</span>
                <input
                  className="edit-cell w-full"
                  value={draft.questionOrder}
                  onChange={(e) => setDraft({ ...draft, questionOrder: e.target.value })}
                />
              </label>
            </div>

            {(["requiredAttributes", "optionalAttributes"] as const).map((kind) => (
              <div key={kind}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-semibold">
                    {kind === "requiredAttributes" ? "Required Attributes" : "Optional Attributes"}
                  </div>
                  <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => addAttr(kind)}>
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {draft[kind].map((attr, idx) => (
                    <div
                      key={`${kind}-${idx}`}
                      className="grid gap-2 rounded-md border p-2 sm:grid-cols-2"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <input
                        className="edit-cell"
                        placeholder="key"
                        value={attr.key}
                        onChange={(e) => updateAttr(kind, idx, { key: e.target.value })}
                      />
                      <input
                        className="edit-cell"
                        placeholder="label"
                        value={attr.label}
                        onChange={(e) => updateAttr(kind, idx, { label: e.target.value })}
                      />
                      <input
                        className="edit-cell sm:col-span-2"
                        placeholder="question prompt"
                        value={attr.prompt}
                        onChange={(e) => updateAttr(kind, idx, { prompt: e.target.value })}
                      />
                      <input
                        className="edit-cell"
                        placeholder="options (comma)"
                        value={(attr.options || []).join(", ")}
                        onChange={(e) =>
                          updateAttr(kind, idx, {
                            options: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <input
                        className="edit-cell"
                        placeholder="synonyms (comma)"
                        value={(attr.synonyms || []).join(", ")}
                        onChange={(e) =>
                          updateAttr(kind, idx, {
                            synonyms: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <input
                        className="edit-cell"
                        placeholder="default value"
                        value={attr.defaultValue || ""}
                        onChange={(e) => updateAttr(kind, idx, { defaultValue: e.target.value })}
                      />
                      <input
                        className="edit-cell"
                        type="number"
                        step="0.01"
                        min={0}
                        max={1}
                        placeholder="confidence threshold"
                        value={attr.confidenceThreshold ?? 0.75}
                        onChange={(e) =>
                          updateAttr(kind, idx, { confidenceThreshold: Number(e.target.value) || 0.75 })
                        }
                      />
                      <div className="sm:col-span-2">
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => removeAttr(kind, idx)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <label className="block text-sm">
              <span className="mb-1 block dd-text-muted">Validation Rules (JSON)</span>
              <textarea
                className="edit-cell min-h-[100px] w-full font-mono text-xs"
                value={draft.validationRulesJson}
                onChange={(e) => setDraft({ ...draft, validationRulesJson: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveDraft}>Save Profile</Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.disableAttributeLibrary(selected.id);
                  setMessage("Disabled");
                  await load();
                }}
              >
                Disable
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-6 text-sm dd-text-muted">Select or create a product family.</Card>
        )}
      </div>
    </PageLayout>
  );
}
