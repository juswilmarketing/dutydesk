import type { Invoice } from "@pas/shared-types";
import { lineItemValue } from "@/lib/invoice-charges";
import { escapeCsv } from "./escape";

export function exportInvoiceCsv(inv: Invoice, preparedBy?: string) {
  const clerk = preparedBy?.trim() || inv.meta.clerk?.trim() || "";
  const sub = inv.items.reduce((s, i) => s + lineItemValue(i), 0);
  let csv = `"DutyDesk - Tariff Report"\n`;
  csv += `"Invoice","${escapeCsv(inv.meta.number)}","Date","${escapeCsv(inv.meta.date)}","Supplier","${escapeCsv(inv.meta.supplier)}"\n`;
  csv += `"Ship From","${escapeCsv(inv.meta.from)}","Ship To","${escapeCsv(inv.meta.to)}","Prepared By","${escapeCsv(clerk)}"\n\n`;
  csv += `"#","Description","T&T Tariff Code","Duty Rate","Category","Source","Qty","Unit","Unit Price","Total","Notes"\n`;
  inv.items.forEach((it, i) => {
    csv += `"${i + 1}","${escapeCsv(it.desc)}","${escapeCsv(it.tariff_code || "")}","${escapeCsv(it.duty_rate || "")}","${escapeCsv(it.category || "")}","${it.source === "database" ? "Official" : "AI"}","${it.qty}","${escapeCsv(it.unit)}","${(it.price || 0).toFixed(2)}","${lineItemValue(it).toFixed(2)}","${escapeCsv(it.notes || "")}"\n`;
  });
  csv += `\n"","","","","","","","","TOTAL","${sub.toFixed(2)}",""\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `TariffReport_${inv.meta.number || "Invoice"}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
