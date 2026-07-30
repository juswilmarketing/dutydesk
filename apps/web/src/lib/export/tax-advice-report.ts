import type { Consignee } from "@pas/shared-types";
import { COMPANY_NAME } from "@/lib/company";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { fmtExchangeRate, fmtUSD, cesFeeFromContainer, formatContainerCesLabel } from "@pas/tax-engine";
import { escapeHtml } from "./escape";

export { cesFeeFromContainer, formatContainerCesLabel };

/** Input for the authoritative V1 Tax Advice document — calculations come from useTaxWorksheet. */
export interface TaxAdviceData {
  worksheetNum: string;
  consignee: Consignee | null;
  billOfLading: string;
  commodity: string;
  totalDuty: number;
  totalVAT: number;
  cesFee: number;
  depositFee: number;
  userFeeAmt: number;
  grandTotal: number;
  preparedBy: string;
  xr?: number;
  invoiceTotal?: number;
  freight?: number;
  insurance?: number;
  otherCharges?: number;
  cifUSD?: number;
  cifTTD?: number;
  vatExempt?: boolean;
  totalsMismatch?: boolean;
  containerCesLabel?: string;
}

/**
 * Authoritative Tax Advice HTML (V1).
 * Do not change calculation inputs, totals, wording, or business rules here —
 * only spacing/visual presentation.
 */
export function buildTaxAdviceHtml(data: TaxAdviceData): string {
  const today = new Date().toLocaleDateString("en-TT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const fmt2 = (n: number) =>
    n.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const xr = data.xr ?? 6.75;
  const invoiceTotal = data.invoiceTotal ?? 0;
  const freight = data.freight ?? 0;
  const insurance = data.insurance ?? 0;
  const otherCharges = data.otherCharges ?? 0;
  const cifUSD = data.cifUSD ?? invoiceTotal + freight + insurance + otherCharges;
  const cifTTD = data.cifTTD ?? cifUSD * xr;
  const preparedBy = data.preparedBy?.trim() || "Brokerage Team";

  const noteParts = [
    `Exchange Rate: 1 USD = TT$${fmtExchangeRate(xr)}`,
    invoiceTotal > 0 ? `Invoice: ${fmtUSD(invoiceTotal)}` : null,
    freight > 0 ? `Freight: ${fmtUSD(freight)}` : null,
    insurance > 0 ? `Insurance: ${fmtUSD(insurance)}` : null,
    otherCharges > 0 ? `Other charges: ${fmtUSD(otherCharges)}` : null,
    cifUSD > 0 ? `CIF (USD): ${fmtUSD(cifUSD)}` : null,
    cifTTD > 0 ? `CIF (TTD): TT$${fmt2(cifTTD)}` : null,
    data.vatExempt ? "<strong>VAT EXEMPT</strong>" : null,
    data.totalsMismatch ? `<strong style="color:#8B0000">Invoice totals require review (line items may not match supplier total)</strong>` : null,
  ]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>DutyDesk Tax Advice - ${escapeHtml(data.worksheetNum)}</title>
<style>
  @page{margin:18mm 15mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11pt;color:#111;background:#fff}
  .page{max-width:720px;margin:0 auto;padding:10px}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #8B0000;padding-bottom:10px;margin-bottom:18px}
  .logo-img{width:min(560px,100%);height:auto;max-height:120px;object-fit:contain}
  .doc-title{font-size:24pt;font-weight:900;color:#8B0000;text-align:right;letter-spacing:2px}
  .doc-sub{font-size:8pt;color:#888;text-align:right;margin-top:2px}
  .field-grid{display:grid;grid-template-columns:220px 1fr;gap:0;margin-bottom:4px}
  .field-label{font-weight:700;font-size:10pt;color:#333;padding:5px 0}
  .field-value{font-size:10pt;color:#111;padding:5px 0;border-bottom:1px solid #ddd}
  .section-divider{height:1px;background:#ddd;margin:14px 0}
  .payment-box{background:#f9f6f0;border:1.5px solid #c8a96e;border-radius:6px;padding:12px 16px;margin:14px 0;font-size:10pt}
  .payment-box h3{font-size:11pt;font-weight:700;color:#8B0000;margin-bottom:8px}
  .payment-row{display:flex;gap:8px;margin-bottom:4px;align-items:flex-start}
  .pay-bullet{color:#8B0000;font-weight:700;flex-shrink:0}
  .cheque-line{margin-top:8px;font-size:10pt}
  .cheque-name{font-size:12pt;font-weight:700;color:#8B0000;display:block;margin-top:3px}
  .tax-table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11pt}
  .tax-table th{background:#8B0000;color:#fff;padding:9px 16px;text-align:left;font-size:10pt;font-weight:700}
  .tax-table th:last-child{text-align:right}
  .tax-table td{padding:9px 16px;border-bottom:1px solid #e8e0d0;font-size:11pt}
  .tax-table td:last-child{text-align:right;font-family:'Courier New',monospace;font-weight:600}
  .tax-table tr:nth-child(even) td{background:#faf8f4}
  .total-row td{background:#8B0000 !important;color:#fff;font-weight:700;font-size:13pt;border:none}
  .total-row td:first-child{border-radius:0 0 0 6px}
  .total-row td:last-child{border-radius:0 0 6px 0;font-size:14pt}
  .note{margin-top:18px;font-size:9pt;color:#777;border-top:1px solid #ddd;padding-top:8px;line-height:1.7}
  .regards{margin-top:24px;font-size:10pt;color:#333;font-weight:600}
  .footer{margin-top:32px;border-top:2px solid #8B0000;padding-top:10px;display:flex;justify-content:space-between;font-size:8pt;color:#999}
  @media print{.page{padding:0}.payment-box{break-inside:avoid}.tax-table{break-inside:avoid}}
</style></head><body>
<div class="page">
  <div class="header">
    <div>
      <img class="logo-img" src="${escapeHtml(DUTY_DESK_LOGO_SRC)}" alt="DutyDesk"/>
    </div>
    <div>
      <div class="doc-title">TAX ADVICE</div>
      <div class="doc-sub">Date: ${today}</div>
    </div>
  </div>
  <div class="field-grid">
    <div class="field-label">Worksheet #:</div>
    <div class="field-value"><strong>${escapeHtml(data.worksheetNum) || "&nbsp;"}</strong></div>
  </div>
  <div class="field-grid">
    <div class="field-label">Consignee <em style="font-weight:400;font-size:9pt">(MUST appear on certified chq.)</em>:</div>
    <div class="field-value"><strong>${escapeHtml(data.consignee?.name || "") || "&nbsp;"}</strong></div>
  </div>
  <div class="field-grid">
    <div class="field-label">Bill of Lading / Air Way Bill:</div>
    <div class="field-value">${escapeHtml(data.billOfLading) || "&nbsp;"}</div>
  </div>
  <div class="field-grid">
    <div class="field-label">Commodity:</div>
    <div class="field-value">${escapeHtml(data.commodity) || "&nbsp;"}</div>
  </div>
  <div class="field-grid">
    <div class="field-label">Prepared by:</div>
    <div class="field-value"><strong>${escapeHtml(preparedBy)}</strong></div>
  </div>
  <div class="section-divider"></div>
  <div class="payment-box">
    <h3>Payment Methods</h3>
    <div class="payment-row"><span class="pay-bullet">▸</span><div><strong>TOTAL LESS THAN TTD 5,000.00</strong> &nbsp;—&nbsp; CASH or CERTIFIED CHEQUE</div></div>
    <div class="payment-row"><span class="pay-bullet">▸</span><div><strong>MORE THAN TTD 5,000.00</strong> &nbsp;—&nbsp; CERTIFIED CHEQUE ONLY</div></div>
    <div class="cheque-line">Make Certified Cheque payable to:
      <span class="cheque-name">THE COMPTROLLER OF CUSTOMS &amp; EXCISE</span>
    </div>
  </div>
  <table class="tax-table">
    <thead><tr><th>TAX / FEE</th><th>VALUE in TTD</th></tr></thead>
    <tbody>
      <tr><td>IMPORT DUTY (ICD):</td><td>$${fmt2(data.totalDuty)}</td></tr>
      <tr><td>VALUE ADDED TAX (VAT):</td><td>$${fmt2(data.totalVAT)}</td></tr>
      <tr><td>CONTAINER EXAM FEE (CES)${data.containerCesLabel ? ` (${escapeHtml(data.containerCesLabel)})` : ""}:</td><td>$${fmt2(data.cesFee)}</td></tr>
      <tr><td>DEPOSIT ENTRY / OTHER FEE:</td><td>$${fmt2(data.depositFee)}</td></tr>
      <tr><td>USER FEE (UFC):</td><td>$${fmt2(data.userFeeAmt)}</td></tr>
    </tbody>
    <tfoot>
      <tr class="total-row"><td>TOTAL PAYABLE</td><td>TT$ ${fmt2(data.grandTotal)}</td></tr>
    </tfoot>
  </table>
  <div class="note">
    ⓘ &nbsp;The above figures are <strong>estimates only</strong> and are subject to change upon final assessment by T&amp;T Customs &amp; Excise.<br/>
    ${noteParts || "Manual tax advice entry — no invoice loaded."}
  </div>
  <div class="regards">Kind regards,<br/><span style="color:#8B0000;font-size:12pt">${escapeHtml(preparedBy)}</span><br/><span style="font-size:10pt;color:#333">${escapeHtml(COMPANY_NAME)}</span></div>
  <div class="footer">
    <span>Prepared by ${escapeHtml(preparedBy)} · ${escapeHtml(COMPANY_NAME)}</span>
    <span>Generated ${escapeHtml(new Date().toLocaleString())}</span>
  </div>
</div></body></html>`;
}

export function openTaxAdvicePrint(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}

export function downloadTaxAdviceHtml(html: string, worksheetNum: string) {
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `DutyDesk_Tax_Advice_${(worksheetNum || "Assessment").replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
  a.click();
}
