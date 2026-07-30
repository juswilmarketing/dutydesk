import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { IndustryDictionaryEntry } from "@pas/shared-types";

export function IndustryDictionaryPage() {
  return (
    <AdminCrudPage<IndustryDictionaryEntry>
      title="Industry Dictionary"
      description="Industries and typical HS chapters"
      createLabel="Add industry"
      onCreate={async () => {
        const code = window.prompt("Industry code (e.g. footwear)");
        if (!code?.trim()) return;
        const name = window.prompt("Display name", code) || code;
        const chapters = window.prompt("Typical chapters (comma-separated)", "64") || "";
        await api.saveIndustryDictionary({
          code: code.trim(),
          name: name.trim(),
          typical_chapters: chapters.split(",").map((s) => s.trim()).filter(Boolean),
        });
      }}
      load={async () => (await api.getIndustryDictionary()).entries}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        {
          key: "typical_chapters",
          label: "Chapters",
          render: (row) => (row.typical_chapters || []).join(", "),
        },
        { key: "status", label: "Status" },
      ]}
    />
  );
}
