import type { TaxBreakdownData } from "@pas/shared-types";
import { COMPANY_NAME } from "@/lib/company";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { escapeHtml } from "./escape";

function fmtTtd(n: number): string {
  return Number(n || 0).toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Page 3 — Original invoice line audit breakdown. */
export function buildOriginalInvoiceBreakdownHtml(data: TaxBreakdownData): string {
  const today = new Date().toLocaleDateString("en-TT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const preparedBy = data.preparedBy?.trim() || "Brokerage Team";
  const lines = data.sourceLines || [];

  const itemRows =
    lines.length > 0
      ? lines
          .map(
            (line) => `
      <tr>
        <td>${line.source_line_number}</td>
        <td>${escapeHtml(line.original_description)}</td>
        <td>${escapeHtml(line.worksheet_description)}</td>
        <td class="mono">${escapeHtml(line.hs_code || "—")}</td>
        <td>${line.quantity}</td>
        <td class="num">TT$${fmtTtd(line.value)}</td>
        <td class="mono">${escapeHtml(line.group_id || "—")}</td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="7" class="empty">No source invoice lines.</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Original Invoice Lines — ${escapeHtml(data.worksheetNum || "Worksheet")}</title>
<style>
  @page{margin:15mm 12mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:9.5pt;color:#111;background:#fff}
  .page{max-width:800px;margin:0 auto;padding:10px}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #8B0000;padding-bottom:8px;margin-bottom:14px}
  .logo-img{width:min(400px,100%);height:auto;max-height:72px;object-fit:contain}
  .doc-title{font-size:14pt;font-weight:900;color:#8B0000;text-align:right}
  .doc-sub{font-size:8pt;color:#888;text-align:right;margin-top:2px}
  .intro{font-size:9pt;color:#555;margin-bottom:10px;line-height:1.5}
  .items{width:100%;border-collapse:collapse;font-size:8.5pt}
  .items th{background:#8B0000;color:#fff;padding:6px 5px;text-align:left;font-size:8pt}
  .items td{padding:6px 5px;border-bottom:1px solid #ece6dc;vertical-align:top}
  .items tr:nth-child(even) td{background:#faf8f4}
  .items .num{text-align:right;font-family:'Courier New',monospace}
  .items .mono{font-family:'Courier New',monospace;font-size:8pt}
  .items .empty{text-align:center;color:#888;padding:14px}
  .footer{margin-top:16px;border-top:1px solid #ddd;padding-top:8px;font-size:7.5pt;color:#999;display:flex;justify-content:space-between}
  @media print{.page{padding:0}}
</style></head><body>
<div class="page">
  <div class="header">
    <img class="logo-img" src="${escapeHtml(DUTY_DESK_LOGO_SRC)}" alt="DutyDesk"/>
    <div>
      <div class="doc-title">ORIGINAL INVOICE LINES</div>
      <div class="doc-sub">Internal audit · Worksheet ${escapeHtml(data.worksheetNum || "")} · ${today}</div>
    </div>
  </div>
  <p class="intro">
    Extracted invoice lines as classified in Duty Desk. Original descriptions are preserved for audit;
    worksheet descriptions reflect clerk edits before PDF generation.
  </p>
  <table class="items">
    <thead>
      <tr>
        <th>Line</th>
        <th>Original Description</th>
        <th>Worksheet Description</th>
        <th>HS Code</th>
        <th>Qty</th>
        <th style="text-align:right">Value</th>
        <th>Group ID</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="footer">
    <span>Prepared by ${escapeHtml(preparedBy)} · ${escapeHtml(COMPANY_NAME)}</span>
    <span>Generated ${escapeHtml(new Date().toLocaleString())}</span>
  </div>
</div>
</body></html>`;
}
