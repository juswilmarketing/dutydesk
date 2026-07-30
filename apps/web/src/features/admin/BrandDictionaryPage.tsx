import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { BrandDictionaryEntry } from "@pas/shared-types";

export function BrandDictionaryPage() {
  return (
    <AdminCrudPage<BrandDictionaryEntry>
      title="Brand Dictionary"
      description="Brand hints that boost industry/chapter prediction"
      createLabel="Add brand"
      onCreate={async () => {
        const brand = window.prompt("Brand name");
        if (!brand?.trim()) return;
        const industries = window.prompt("Industry hints (comma-separated)") || "";
        const chapters = window.prompt("Typical chapters (comma-separated)") || "";
        await api.saveBrandDictionary({
          brand: brand.trim(),
          industry_hints: industries.split(",").map((s) => s.trim()).filter(Boolean),
          typical_chapters: chapters.split(",").map((s) => s.trim()).filter(Boolean),
        });
      }}
      load={async () => (await api.getBrandDictionary()).entries}
      columns={[
        { key: "brand", label: "Brand" },
        {
          key: "industry_hints",
          label: "Industries",
          render: (row) => (row.industry_hints || []).join(", "),
        },
        {
          key: "typical_chapters",
          label: "Chapters",
          render: (row) => (row.typical_chapters || []).join(", "),
        },
        { key: "usage_count", label: "Uses" },
        { key: "confidence_boost", label: "Boost" },
      ]}
    />
  );
}
