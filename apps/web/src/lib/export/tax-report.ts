import type { Invoice, TaxInputs } from "@pas/shared-types";
import type { TaxSummary } from "@pas/tax-engine";
import { fmtExchangeRate, fmtTTD, fmtUSD, formatContainerCesLabel } from "@pas/tax-engine";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { escapeHtml } from "./escape";
import { openPrintWindow } from "./tariff-report";

export function buildTaxReportHtml(
  summary: TaxSummary,
  opts: {
    combineAll: boolean;
    invoices: Invoice[];
    taxInv: Invoice | null;
    taxInputs: TaxInputs;
    exchangeRate: number;
    preparedBy: string;
  },
): string {
  const { combineAll, invoices, taxInv, taxInputs, exchangeRate: xr, preparedBy } = opts;
  const rows = summary.rows
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(it.desc)}</td><td>${escapeHtml(it.tariff_code || "—")}</td><td>${it.isDutyExempt ? "Free (Exempt)" : escapeHtml(it.duty_rate || "—")}</td><td>${fmtUSD(it.itemVal)}</td><td>${fmtTTD(it.itemCIF)}</td><td>${it.isDutyExempt ? "—" : fmtTTD(it.duty)}</td><td>${it.isVatExempt ? "—" : fmtTTD(it.vat)}</td><td><strong>${fmtTTD(it.subtotal)}</strong></td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Customs Tax Assessment</title>
<style>body{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:11px;padding:20px;color:#111}h1{color:#8B0000;font-size:16px;margin-bottom:2px}h2{font-size:10px;color:#888;font-weight:400;margin-bottom:14px}.params{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 18px;padding:10px 14px;background:#f7f3ef;border:1px solid #ddd;border-radius:6px}.params div label{font-size:8px;font-weight:700;text-transform:uppercase;color:#888;display:block;margin-bottom:2px}table{width:100%;border-collapse:collapse;font-size:10.5px}th{background:#8B0000;color:#fff;padding:7px 9px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:6px 9px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#fafafa}.sum{margin-top:16px;border:1px solid #ddd;border-radius:6px;overflow:hidden}.sum-row{display:flex;justify-content:space-between;padding:8px 16px;border-bottom:1px solid #eee;font-size:11px}.sum-row:last-child{border-bottom:none}.sum-total{background:#8B0000;color:#fff;font-weight:700;font-size:13px}.sig{display:flex;justify-content:space-between;margin-top:36px}.sig div{border-top:1px solid #555;padding-top:4px;font-size:10px;width:180px;text-align:center;color:#555}@media print{@page{margin:12mm}body{padding:0}}</style></head><body>
<h1><img src="${escapeHtml(DUTY_DESK_LOGO_SRC)}" alt="DutyDesk" style="height:42px;vertical-align:middle;margin-right:8px"/> Customs Tax Assessment</h1>
<h2>Generated ${escapeHtml(new Date().toLocaleString())} · T&T Customs Act Chap. 78:01</h2>
<div class="params">
<div><label>Invoice</label>${combineAll ? "Multiple" : escapeHtml(taxInv?.meta.number || "—")}</div>
<div><label>Supplier</label>${combineAll ? escapeHtml(invoices.map((i) => i.meta.supplier || i.filename).join(", ")) : escapeHtml(taxInv?.meta.supplier || "—")}</div>
<div><label>Invoice Total</label>${fmtUSD(summary.invoiceTotal)}</div>
<div><label>CIF (USD)</label>${fmtUSD(summary.cifUSD)}</div>
<div><label>Exchange Rate</label>1 USD = TT$${fmtExchangeRate(xr)}</div>
<div><label>CIF (TTD)</label>${fmtTTD(summary.cifTTD)}</div>
<div><label>Container</label>${taxInputs.containerSize === "none" ? "N/A" : escapeHtml(formatContainerCesLabel(taxInputs.containerSize, taxInputs.containerCount))}</div>
<div><label>VAT</label>${taxInputs.vatExempt ? "Exempt" : "12.5%"}</div>
<div><label>Prepared By</label>${escapeHtml(preparedBy)}</div>
</div>
<table><thead><tr><th>#</th><th>Description</th><th>Tariff Code</th><th>Duty Rate</th><th>Value (USD)</th><th>CIF (TTD)</th><th>Duty (TTD)</th><th>VAT (TTD)</th><th>Total Tax (TTD)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum">
<div class="sum-row"><span>Customs Duty</span><span>${fmtTTD(summary.totalDuty)}</span></div>
<div class="sum-row"><span>VAT (12.5%)</span><span>${fmtTTD(summary.totalVAT)}</span></div>
${summary.containerFee > 0 ? `<div class="sum-row"><span>Container Fee (${escapeHtml(formatContainerCesLabel(taxInputs.containerSize, taxInputs.containerCount))})</span><span>${fmtTTD(summary.containerFee)}</span></div>` : ""}
${summary.userFee > 0 ? `<div class="sum-row"><span>User Fee</span><span>${fmtTTD(summary.userFee)}</span></div>` : ""}
<div class="sum-row sum-total"><span>TOTAL TAXES PAYABLE</span><span>${fmtTTD(summary.grandTotal)}</span></div>
</div>
<div class="sig"><div>Customs Clerk Signature</div><div>Date</div><div>T&T Customs Stamp</div></div>
</body></html>`;
}

export function exportTaxReport(
  summary: TaxSummary,
  opts: Parameters<typeof buildTaxReportHtml>[1],
) {
  if (summary.invoiceTotal === 0) return;
  openPrintWindow(buildTaxReportHtml(summary, opts));
}
