import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";

type Row = {
  id: number;
  supplier_name: string | null;
  original_description: string;
  selected_hs_code: string | null;
  created_at: string;
};

export function ProductProfilesPage() {
  return (
    <AdminCrudPage<Row>
      title="Product Profiles"
      description="Persisted product profiles from clerk-approved classifications"
      load={async () => (await api.getProductProfiles()).entries}
      columns={[
        { key: "id", label: "ID" },
        { key: "supplier_name", label: "Supplier" },
        { key: "original_description", label: "Description" },
        { key: "selected_hs_code", label: "HS" },
        { key: "created_at", label: "Created" },
      ]}
    />
  );
}
