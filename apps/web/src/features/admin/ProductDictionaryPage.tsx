import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { ProductDictionaryEntry } from "@pas/shared-types";

export function ProductDictionaryPage() {
  return (
    <AdminCrudPage<ProductDictionaryEntry>
      title="Product Dictionary"
      description="Canonical products, synonyms, industry, and typical chapters"
      createLabel="Add product"
      onCreate={async () => {
        const name = window.prompt("Canonical product name");
        if (!name?.trim()) return;
        const family = window.prompt("Product family", "General") || "General";
        const industry = window.prompt("Industry code", "consumer") || "consumer";
        const chapter = window.prompt("Typical chapter (optional)") || undefined;
        await api.saveProductDictionary({
          canonical_name: name.trim(),
          product_family: family,
          industry_code: industry,
          typical_chapter: chapter,
        });
      }}
      load={async () => (await api.getProductDictionary()).entries}
      columns={[
        { key: "canonical_name", label: "Product" },
        { key: "product_family", label: "Family" },
        { key: "industry_code", label: "Industry" },
        { key: "typical_chapter", label: "Chapter" },
        { key: "usage_count", label: "Uses" },
        {
          key: "actions",
          label: "",
          render: (row) => (
            <button
              type="button"
              className="text-xs dd-text-muted"
              onClick={async () => {
                await api.disableProductDictionary(row.id);
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
