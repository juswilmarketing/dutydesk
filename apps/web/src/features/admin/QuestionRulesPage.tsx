import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { QuestionRuleEntry } from "@pas/shared-types";

export function QuestionRulesPage() {
  return (
    <AdminCrudPage<QuestionRuleEntry>
      title="Question Rules"
      description="Minimum clarifying questions by industry / product family"
      createLabel="Add rule"
      onCreate={async () => {
        const industry = window.prompt("Industry code (optional)") || undefined;
        const family = window.prompt("Product family (optional)") || undefined;
        const prompt = window.prompt("Question prompt");
        if (!prompt?.trim()) return;
        const field = window.prompt("Field key", "material") || "material";
        await api.saveQuestionRule({
          industry_code: industry,
          product_family: family,
          questions: [{ id: field, field, prompt, required: true }],
        });
      }}
      load={async () => (await api.getQuestionRules()).entries}
      columns={[
        { key: "industry_code", label: "Industry" },
        { key: "product_family", label: "Family" },
        {
          key: "questions",
          label: "Questions",
          render: (row) => (row.questions || []).map((q) => q.prompt).join(" · "),
        },
        { key: "priority", label: "Priority" },
      ]}
    />
  );
}
