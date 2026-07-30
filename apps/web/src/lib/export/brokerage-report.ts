import type { BrokerageInputs } from "@pas/shared-types";
import { calculateBrokerage, fmtBrokerage } from "@/lib/brokerage";
import { escapeHtml } from "./escape";
import { openPrintWindow } from "./tariff-report";

export function buildBrokerageReportHtml(inputs: BrokerageInputs): string {
  const r = calculateBrokerage(inputs);
  const cif = parseFloat(inputs.cifUSD) || 0;
  const today = new Date().toLocaleDateString("en-TT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const tierRows = [
    ["2% of first", fmtBrokerage(r.c22), fmtBrokerage(r.d22)],
    ["1.5% of next", fmtBrokerage(r.c23), fmtBrokerage(r.d23)],
    ["1% of next", fmtBrokerage(r.c24), fmtBrokerage(r.d24)],
    [`${r.payless ? ".25%" : ".5%"} thereafter`, fmtBrokerage(r.c25), fmtBrokerage(r.d25)],
  ]
    .map(
      ([l, a, f]) =>
        `<tr><td>${l}</td><td style="text-align:right">${a}</td><td style="text-align:right;font-weight:600">${f}</td></tr>`,
    )
    .join("");

  const discRow =
    r.d29 < 0
      ? `<tr style="background:#fff8f0"><td style="font-weight:600;color:#c94508">LESS DISCOUNT${r.discountPct > 0 ? ` (${r.discountPct}%)` : ""}</td><td></td><td style="text-align:right;font-weight:700;color:#c94508;font-family:monospace">(${fmtBrokerage(-r.d29)})</td></tr>`
      : "";

  const otherRows = [
    r.d35 > 0 ? `<tr><td colspan="2">BDC</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d35)}</td></tr>` : "",
    r.d36 > 0 ? `<tr style="background:#f9fafc"><td colspan="2">User Fee</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d36)}</td></tr>` : "",
    r.d37 > 0 ? `<tr><td colspan="2">Weigh Bridge Fee</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d37)}</td></tr>` : "",
    r.d38 > 0 ? `<tr style="background:#f9fafc"><td colspan="2">Clerk Overtime</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d38)}</td></tr>` : "",
    r.d39 > 0 ? `<tr><td colspan="2">Customs Overtime</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d39)}</td></tr>` : "",
    r.d40 > 0 ? `<tr style="background:#f9fafc"><td colspan="2">Certificate of Origin</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d40)}</td></tr>` : "",
  ].join("");

  const custBlock = [
    inputs.custName ? `<strong>${escapeHtml(inputs.custName)}</strong><br/>` : "",
    inputs.custCompany ? `${escapeHtml(inputs.custCompany)}<br/>` : "",
    inputs.custAddress ? `${escapeHtml(inputs.custAddress)}<br/>` : "",
    inputs.custPhone ? `Tel: ${escapeHtml(inputs.custPhone)}<br/>` : "",
    inputs.custEmail ? `Email: ${escapeHtml(inputs.custEmail)}` : "",
  ].join("");

  const shipBlock = [
    inputs.commodity ? `<strong>Commodity:</strong> ${escapeHtml(inputs.commodity)}<br/>` : "",
    `<strong>C.I.F. Value:</strong> <span style="font-family:monospace">${fmtBrokerage(cif)}</span><br/>`,
    `<strong>Rate:</strong> ${r.payless ? "Payless (0.25% on remainder)" : "Standard (0.5% on remainder)"}<br/>`,
    `<strong>Processing Fee:</strong> ${r.baseChargeOn ? "TT$500 (Applied)" : "Waived"}<br/>`,
    inputs.preparedBy ? `<strong>Prepared by:</strong> ${escapeHtml(inputs.preparedBy)}` : "",
  ].join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>DutyDesk Brokerage Estimate${inputs.invoiceNo ? ` - ${escapeHtml(inputs.invoiceNo)}` : ""}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#0d1f35;padding:24px 32px;max-width:780px;margin:0 auto}
  .logo-bar{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0d1f35;padding-bottom:12px;margin-bottom:18px}
  .logo-name{font-size:22px;font-weight:800;color:#0d1f35}
  .logo-sub{font-size:10px;color:#5a6e85;margin-top:2px}
  .doc-title{font-size:16px;font-weight:700;color:#1B4F8A;text-align:right}
  .doc-sub{font-size:10px;color:#5a6e85;text-align:right;margin-top:2px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .info-box{background:#f4f6f9;border-radius:6px;padding:12px 14px}
  .info-box h3{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#5a6e85;margin-bottom:8px}
  .info-box p{font-size:11px;color:#0d1f35;line-height:1.6;margin:0}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px}
  th{background:#0d1f35;color:#fff;padding:7px 10px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:0.08em}
  td{padding:6px 10px;border-bottom:1px solid #e8ecf2}
  tr:nth-child(even) td{background:#f9fafc}
  .total-brok td{background:#e8f0fa!important;font-weight:700;color:#1B4F8A!important}
  .total-due td{background:#f7f3ef!important;font-weight:700}
  .grand-total{background:#0d1f35;border-radius:6px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin:12px 0}
  .grand-total .lbl{color:rgba(255,255,255,0.8);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em}
  .grand-total .amt{color:#fff;font-size:20px;font-weight:800;font-family:monospace}
  .note{font-size:9px;color:#888;margin-top:12px;line-height:1.6}
  @media print{@page{margin:12mm}body{padding:0}}
</style></head><body>
<div class="logo-bar">
  <div><div class="logo-name">&#9875; DutyDesk</div><div class="logo-sub">Customs Brokerage &amp; Freight Services</div></div>
  <div><div class="doc-title">BROKERAGE FEE ESTIMATE</div><div class="doc-sub">Generated ${today}</div>
  ${inputs.invoiceNo ? `<div class="doc-sub" style="margin-top:2px;font-weight:700;color:#0d1f35">Ref: ${escapeHtml(inputs.invoiceNo)}</div>` : ""}
  </div>
</div>
<div class="two-col">
  <div class="info-box"><h3>Customer</h3><p>${custBlock}</p></div>
  <div class="info-box"><h3>Shipment Details</h3><p>${shipBlock}</p></div>
</div>
<table><thead><tr><th>BROKERAGE FEES</th><th style="text-align:right">Applicable Amount</th><th style="text-align:right">Fee</th></tr></thead><tbody>
${tierRows}
<tr style="background:#f7f3ef"><td style="font-weight:600">PROCESSING FEE</td><td style="text-align:right;font-family:monospace">TT$500</td><td style="text-align:right;font-weight:700;font-family:monospace">${r.baseChargeOn ? fmtBrokerage(r.d28) : "—"}</td></tr>
${discRow}
<tr class="total-brok"><td colspan="2">TOTAL BROKERAGE</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d30)}</td></tr>
</tbody></table>
<table><thead><tr><th colspan="2">OTHER CHARGES</th><th style="text-align:right">Amount</th></tr></thead><tbody>
<tr><td colspan="2">Documentation</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d33)}</td></tr>
<tr style="background:#f9fafc"><td colspan="2">Handling Charges</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d34)}</td></tr>
${otherRows}
<tr class="total-due"><td colspan="2">TOTAL DUE (before VAT)</td><td style="text-align:right;font-family:monospace">${fmtBrokerage(r.d42)}</td></tr>
</tbody></table>
<div class="grand-total"><span class="lbl">PLUS VAT 12.5% — TOTAL PAYABLE</span><span class="amt">${fmtBrokerage(r.d45)}</span></div>
<p class="note">* This is an estimate only. Final charges may vary. VAT 12.5% applied to Total Due. T&amp;T Customs Act Chap. 78:01. Valid for 30 days.</p>
</body></html>`;
}

export function printBrokerageReport(inputs: BrokerageInputs) {
  openPrintWindow(buildBrokerageReportHtml(inputs));
}

export function emailBrokerageEstimate(inputs: BrokerageInputs) {
  const r = calculateBrokerage(inputs);
  const cif = parseFloat(inputs.cifUSD) || 0;
  const to = inputs.custEmail || "";
  const subj = `DutyDesk Brokerage Fee Estimate${inputs.invoiceNo ? ` - Ref ${inputs.invoiceNo}` : ""}${inputs.custCompany ? ` - ${inputs.custCompany}` : ""}`;
  const body =
    `Dear ${inputs.custName || "Valued Customer"},\r\n\r\n` +
    `Please find below your brokerage fee estimate from DutyDesk.\r\n\r\n` +
    `C.I.F. Value: ${fmtBrokerage(cif)}\r\n` +
    `TOTAL BROKERAGE: ${fmtBrokerage(r.d30)}\r\n` +
    `TOTAL PAYABLE (incl. VAT): ${fmtBrokerage(r.d45)}\r\n\r\n` +
    `Kind regards,\r\nDutyDesk - Customs Brokerage & Freight Services`;
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}
