import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { AbbreviationDictionaryEntry } from "@pas/shared-types";

export function AbbreviationsPage() {
  return (
    <AdminCrudPage<AbbreviationDictionaryEntry>
      title="Abbreviation Dictionary"
      description="Global, industry, and supplier-specific abbreviation meanings (supplier overrides global)"
      createLabel="Add abbreviation"
      onCreate={async () => {
        const abbreviation = window.prompt("Abbreviation (e.g. QTR)");
        if (!abbreviation?.trim()) return;
        const meaning = window.prompt("Meaning");
        if (!meaning?.trim()) return;
        const scope = window.prompt("Scope: global | industry | supplier", "global") || "global";
        const supplier_name =
          scope === "supplier" ? window.prompt("Supplier name") || undefined : undefined;
        const industry_code =
          scope === "industry" ? window.prompt("Industry code") || undefined : undefined;
        await api.saveAbbreviation({
          abbreviation: abbreviation.trim(),
          meaning: meaning.trim(),
          scope,
          supplier_name,
          industry_code,
          verified: true,
        });
      }}
      load={async () => (await api.getAbbreviations()).entries}
      columns={[
        { key: "abbreviation", label: "Abbrev" },
        { key: "meaning", label: "Meaning" },
        { key: "scope", label: "Scope" },
        { key: "supplier_name", label: "Supplier" },
        { key: "industry_code", label: "Industry" },
        {
          key: "actions",
          label: "",
          render: (row) => (
            <button
              type="button"
              className="text-xs dd-text-muted"
              onClick={async () => {
                await api.disableAbbreviation(row.id);
                window.location.reload();
              }}
            >
              Disable
            </button>
          ),
        },
      ]}
    />
  );
}
