import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { ChapterPredictionRuleEntry } from "@pas/shared-types";

export function ChapterPredictionRulesPage() {
  return (
    <AdminCrudPage<ChapterPredictionRuleEntry>
      title="Chapter Prediction Rules"
      description="Weighted rules mapping industry/family/material to HS chapters"
      createLabel="Add rule"
      onCreate={async () => {
        const chapter = window.prompt("Chapter (2 digits)");
        if (!chapter?.trim()) return;
        const industry = window.prompt("Industry code (optional)") || undefined;
        const family = window.prompt("Product family (optional)") || undefined;
        const material = window.prompt("Material (optional)") || undefined;
        const weight = Number(window.prompt("Weight", "1") || "1");
        await api.saveChapterPredictionRule({
          chapter: chapter.trim(),
          industry_code: industry,
          product_family: family,
          material,
          weight,
        });
      }}
      load={async () => (await api.getChapterPredictionRules()).entries}
      columns={[
        { key: "chapter", label: "Chapter" },
        { key: "industry_code", label: "Industry" },
        { key: "product_family", label: "Family" },
        { key: "material", label: "Material" },
        { key: "function_key", label: "Function" },
        { key: "weight", label: "Weight" },
        { key: "usage_count", label: "Uses" },
      ]}
    />
  );
}
