import { api } from "@/lib/api-client";
import { AdminCrudPage } from "./AdminCrudPage";
import type { SupplierCatalogueEntry } from "@pas/shared-types";

export function SupplierCataloguePage() {
  return (
    <AdminCrudPage<SupplierCatalogueEntry>
      title="Supplier Product Catalogue"
      description="SKU / part catalogue for identity resolution. Verify records before approved HS codes are reused."
      createLabel="Add catalogue item"
      onCreate={async () => {
        const supplier_name = window.prompt("Supplier name");
        if (!supplier_name?.trim()) return;
        const supplier_sku = window.prompt("Supplier SKU") || undefined;
        const product_type = window.prompt("Product type (e.g. Engraving sheet)") || undefined;
        const material = window.prompt("Material") || undefined;
        const function_use = window.prompt("Function / use") || undefined;
        const brand = window.prompt("Brand") || undefined;
        const approved_hs_code = window.prompt("Approved HS code (optional)") || undefined;
        await api.saveSupplierCatalogue({
          supplier_name: supplier_name.trim(),
          supplier_sku,
          product_type,
          material,
          function_use,
          brand,
          approved_hs_code,
          approval_status: approved_hs_code ? "verified" : "pending",
          product_name: product_type,
        });
      }}
      load={async () => (await api.getSupplierCatalogue()).entries}
      columns={[
        { key: "supplier_name", label: "Supplier" },
        { key: "supplier_sku", label: "SKU" },
        { key: "brand", label: "Brand" },
        { key: "product_type", label: "Type" },
        { key: "material", label: "Material" },
        { key: "approved_hs_code", label: "HS" },
        { key: "approval_status", label: "Status" },
        {
          key: "actions",
          label: "",
          render: (row) => (
            <span className="inline-flex gap-2">
              {row.approval_status !== "verified" && (
                <button
                  type="button"
                  className="text-xs dd-text-accent"
                  onClick={async () => {
                    const hs = window.prompt("Approved HS code", row.approved_hs_code || "") || undefined;
                    await api.verifySupplierCatalogue(row.id, { approved_hs_code: hs });
                    window.location.reload();
                  }}
                >
                  Verify
                </button>
              )}
              <button
                type="button"
                className="text-xs dd-text-muted"
                onClick={async () => {
                  await api.disableSupplierCatalogue(row.id);
                  window.location.reload();
                }}
              >
                Disable
              </button>
            </span>
          ),
        },
      ]}
    />
  );
}
