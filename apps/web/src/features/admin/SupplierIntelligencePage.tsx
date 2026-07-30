import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";

type Row = {
  id?: number;
  supplier_name: string;
  profile_count: number;
  distinct_hs: number;
  last_seen: string;
};

export function SupplierIntelligencePage() {
  return (
    <AdminCrudPage<Row>
      title="Supplier Intelligence"
      description="Aggregated product profiles and HS diversity by supplier"
      load={async () => (await api.getSupplierIntelligence()).entries}
      columns={[
        { key: "supplier_name", label: "Supplier" },
        { key: "profile_count", label: "Profiles" },
        { key: "distinct_hs", label: "Distinct HS" },
        { key: "last_seen", label: "Last seen" },
      ]}
    />
  );
}
