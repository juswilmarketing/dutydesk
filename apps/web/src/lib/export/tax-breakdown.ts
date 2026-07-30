import type { TaxBreakdownData } from "@pas/shared-types";
import { COMPANY_NAME } from "@/lib/company";
import { fmtExchangeRate, fmtUSD } from "@pas/tax-engine";
import { escapeHtml } from "./escape";

function fmtTtd(n: number): string {
  return Number(n || 0).toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dutyLabel(rate: string | null, exempt: boolean): string {
  if (exempt || rate === "Free") return "Free";
  return rate || "—";
}

export function buildTaxBreakdownHtml(data: TaxBreakdownData): string {
  const today = new Date().toLocaleDateString("en-TT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const preparedBy = data.preparedBy?.trim() || "Brokerage Team";

  const itemRows =
    data.rows.length > 0
      ? data.rows
          .map(
            (row, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.desc)}</td>
        <td class="mono">${escapeHtml(row.tariff_code || "—")}</td>
        <td>${escapeHtml(dutyLabel(row.duty_rate, row.isDutyExempt))}</td>
        <td class="num">TT$${fmtTtd(row.itemCIF)}</td>
        <td class="num">TT$${fmtTtd(row.duty)}</td>
        <td class="num">${row.isVatExempt ? "Exempt" : `TT$${fmtTtd(row.vat)}`}</td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="7" class="empty">No line items — summary figures only.</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Tax Calculation — ${escapeHtml(data.worksheetNum || "Worksheet")}</title>
<style>
  @page{margin:18mm 15mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11pt;color:#111;background:#fff}
  .page{max-width:760px;margin:0 auto;padding:10px}
  h1{font-size:18pt;color:#8B0000;margin-bottom:4px}
  .sub{font-size:9pt;color:#666;margin-bottom:16px}
  .intro{font-size:10pt;color:#444;line-height:1.6;margin-bottom:16px}
  .box{border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin-bottom:14px;background:#faf8f4}
  .box h2{font-size:11pt;color:#8B0000;margin-bottom:10px}
  .step{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #e0d8cc;font-size:10.5pt}
  .step:last-child{border-bottom:none;font-weight:700;color:#8B0000}
  .step span:last-child{font-family:'Courier New',monospace;white-space:nowrap}
  .items{width:100%;border-collapse:collapse;font-size:9.5pt;margin-top:8px}
  .items th{background:#8B0000;color:#fff;padding:7px 8px;text-align:left}
  .items td{padding:7px 8px;border-bottom:1px solid #ece6dc;vertical-align:top}
  .items tr:nth-child(even) td{background:#faf8f4}
  .items .num,.items .mono{text-align:right;font-family:'Courier New',monospace}
  .items .mono{text-align:left}
  .items .empty{text-align:center;color:#888;padding:14px}
  .totals{margin-top:14px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0;font-size:10.5pt}
  .grand{margin-top:8px;padding:10px 12px;background:#8B0000;color:#fff;border-radius:6px;display:flex;justify-content:space-between;font-weight:700;font-size:12pt}
  .note{margin-top:16px;font-size:9pt;color:#777;line-height:1.6;border-top:1px solid #ddd;padding-top:10px}
</style></head><body>
<div class="page">
  <h1>How Your Taxes Were Calculated</h1>
  <div class="sub">${escapeHtml(data.worksheetNum || "Tax worksheet")}${data.consigneeName ? ` · ${escapeHtml(data.consigneeName)}` : ""} · Prepared by ${escapeHtml(preparedBy)} · ${today}</div>
  <p class="intro">This is a plain-language summary of how the figures on your tax advice were worked out. Final amounts are confirmed by T&amp;T Customs &amp; Excise.</p>

  <div class="box">
    <h2>Step 1 — Value of the shipment</h2>
    <div class="step"><span>Invoice value (goods)</span><span>${fmtUSD(data.invoiceTotal)}</span></div>
    ${data.freight > 0 ? `<div class="step"><span>+ Freight</span><span>${fmtUSD(data.freight)}</span></div>` : ""}
    ${data.insurance > 0 ? `<div class="step"><span>+ Insurance</span><span>${fmtUSD(data.insurance)}</span></div>` : ""}
    ${data.otherCharges > 0 ? `<div class="step"><span>+ Other charges</span><span>${fmtUSD(data.otherCharges)}</span></div>` : ""}
    <div class="step"><span>= CIF value (USD)</span><span>${fmtUSD(data.cifUSD)}</span></div>
  </div>

  <div class="box">
    <h2>Step 2 — Convert to Trinidad &amp; Tobago dollars</h2>
    <div class="step"><span>Customs exchange rate</span><span>1 USD = TT$${fmtExchangeRate(data.xr)}</span></div>
    <div class="step"><span>= CIF value (TTD)</span><span>TT$${fmtTtd(data.cifTTD)}</span></div>
  </div>

  <div class="box">
    <h2>Step 3 — Duty &amp; VAT by item</h2>
    <p style="font-size:9.5pt;color:#666;margin-bottom:8px">Duty is applied to each item's share of the CIF (TTD). VAT is 12.5% on CIF + duty (unless exempt).</p>
    <table class="items">
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Tariff</th>
          <th>Duty rate</th>
          <th style="text-align:right">CIF share</th>
          <th style="text-align:right">Duty</th>
          <th style="text-align:right">VAT</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="totals">
      <div class="total-row"><span>Total import duty (ICD)</span><span>TT$${fmtTtd(data.totalDuty)}</span></div>
      <div class="total-row"><span>Total VAT (12.5%)${data.vatExempt ? " — exempt" : ""}</span><span>TT$${fmtTtd(data.totalVAT)}</span></div>
      ${data.cesFee > 0 ? `<div class="total-row"><span>Container exam fee (CES)</span><span>TT$${fmtTtd(data.cesFee)}</span></div>` : ""}
      ${data.depositFee > 0 ? `<div class="total-row"><span>Deposit / other fee</span><span>TT$${fmtTtd(data.depositFee)}</span></div>` : ""}
      ${data.userFeeAmt > 0 ? `<div class="total-row"><span>User fee (UFC)</span><span>TT$${fmtTtd(data.userFeeAmt)}</span></div>` : ""}
    </div>
    <div class="grand"><span>Total payable</span><span>TT$${fmtTtd(data.grandTotal)}</span></div>
  </div>

  <div class="note">
    Figures are <strong>estimates</strong> for your review before payment. Customs may adjust on final assessment.<br/>
    Prepared by <strong>${escapeHtml(preparedBy)}</strong> · ${escapeHtml(COMPANY_NAME)}
  </div>
</div>
</body></html>`;
}

export function downloadTaxBreakdownHtml(html: string, worksheetNum: string) {
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `DutyDesk_Tax_Breakdown_${(worksheetNum || "Worksheet").replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
  a.click();
}
