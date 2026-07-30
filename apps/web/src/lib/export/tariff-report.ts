import type { Invoice } from "@pas/shared-types";
import { lineItemValue } from "@/lib/invoice-charges";
import { escapeHtml } from "./escape";

export function buildTariffReportHtml(inv: Invoice, preparedBy?: string): string {
  const clerk = preparedBy?.trim() || inv.meta.clerk?.trim() || "—";
  const sub = inv.items.reduce((s, i) => s + lineItemValue(i), 0);
  const rows = inv.items
    .map((it, i) => {
      const total = lineItemValue(it);
      const source = it.source === "database" ? "✓ Official" : "AI est.";
      const sourceColor = it.source === "database" ? "#1a6b3c" : "#b8860b";
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.desc)}</td>
        <td><strong>${escapeHtml(it.tariff_code || "—")}</strong></td>
        <td>${escapeHtml(it.duty_rate || "—")}</td>
        <td>${escapeHtml(it.category || "—")}</td>
        <td style="font-size:10px;color:${sourceColor}">${source}</td>
        <td>${it.qty} ${escapeHtml(it.unit)}</td>
        <td>$${(it.price || 0).toFixed(2)}</td>
        <td>$${total.toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Tariff Report ${escapeHtml(inv.meta.number)}</title>
<style>body{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:12px;padding:20px;color:#111}h1{color:#8B0000;font-size:17px}h2{font-size:11px;color:#888;font-weight:400;margin-bottom:16px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 24px;margin:14px 0 20px;padding:12px;background:#f7f3ef;border:1px solid #ddd;border-radius:6px}.meta div label{font-size:9px;font-weight:700;text-transform:uppercase;color:#888;display:block}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#8B0000;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase}td{padding:7px 10px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#fafafa}.tot td{background:#8B0000!important;color:#fff;font-weight:700}.sig{display:flex;justify-content:space-between;margin-top:40px}.sig div{border-top:1px solid #555;padding-top:4px;font-size:11px;width:200px;text-align:center;color:#555}.foot{margin-top:20px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:8px}@media print{@page{margin:15mm}body{padding:0}}</style></head><body>
<h1>DutyDesk — Customs Tariff Declaration Report</h1>
<h2>Generated ${escapeHtml(new Date().toLocaleString())} · T&T Customs Act Chap. 78:01</h2>
<div class="meta">
<div><label>Invoice No</label>${escapeHtml(inv.meta.number || "—")}</div>
<div><label>Date</label>${escapeHtml(inv.meta.date || "—")}</div>
<div><label>Supplier</label>${escapeHtml(inv.meta.supplier || "—")}</div>
<div><label>Ship From</label>${escapeHtml(inv.meta.from || "—")}</div>
<div><label>Ship To</label>${escapeHtml(inv.meta.to || "—")}</div>
<div><label>Prepared By</label>${escapeHtml(clerk)}</div>
</div>
<table><thead><tr><th>#</th><th>Description</th><th>T&T Tariff Code</th><th>Duty Rate</th><th>Category</th><th>Source</th><th>Qty</th><th>Unit Price</th><th>Total (USD)</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="tot"><td colspan="8" style="text-align:right">TOTAL (USD)</td><td>$${sub.toFixed(2)}</td></tr></tfoot>
</table>
<div class="sig"><div>Customs Clerk Signature</div><div>Date</div><div>T&T Customs Stamp</div></div>
<div class="foot">DutyDesk · T&T Customs Act Chap. 78:01 · Verify at info.ttbizlink.gov.tt/hs-code-tariff-finder</div>
</body></html>`;
}

export function openPrintWindow(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
}
