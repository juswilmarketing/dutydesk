import type { TaxBreakdownData } from "@pas/shared-types";
import { COMPANY_NAME } from "@/lib/company";
import { DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { escapeHtml } from "./escape";

function fmtTtd(n: number): string {
  return Number(n || 0).toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rateLabel(rate: string | null | undefined, exempt: boolean): string {
  if (exempt || rate === "Free" || rate === "Exempt") return rate || "—";
  return rate || "—";
}

/** Page 2 — Grouped worksheet lines (layout only; totals from existing tax engine). */
export function buildGroupedWorksheetHtml(data: TaxBreakdownData): string {
  const today = new Date().toLocaleDateString("en-TT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const preparedBy = data.preparedBy?.trim() || "Brokerage Team";
  const rows = data.groupedRows?.length ? data.groupedRows : data.rows;

  const itemRows =
    rows.length > 0
      ? rows
          .map((row, idx) => {
            const sourceRef =
              row.source_line_numbers && row.source_line_numbers.length > 1
                ? `Source invoice lines: ${row.source_line_numbers.join(", ")}`
                : row.source_line_number
                  ? `Source invoice line: ${row.source_line_number}`
                  : "";
            return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <div>${escapeHtml(row.worksheet_description || row.desc)}</div>
          ${sourceRef ? `<div class="sub-ref">${escapeHtml(sourceRef)}</div>` : ""}
        </td>
        <td class="mono">${escapeHtml(row.tariff_code || "—")}</td>
        <td>${row.qty ?? "—"}</td>
        <td class="num">TT$${fmtTtd(row.itemCIF)}</td>
        <td>${escapeHtml(rateLabel(row.duty_rate, row.isDutyExempt))}</td>
        <td>${escapeHtml(rateLabel(row.vat_rate, row.isVatExempt))}</td>
        <td class="num">TT$${fmtTtd(row.duty)}</td>
        <td class="num">${row.isVatExempt ? "Exempt" : `TT$${fmtTtd(row.vat)}`}</td>
      </tr>`;
          })
          .join("")
      : `<tr><td colspan="9" class="empty">No grouped worksheet lines.</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Worksheet Breakdown — ${escapeHtml(data.worksheetNum || "Worksheet")}</title>
<style>
  @page{margin:15mm 12mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:10pt;color:#111;background:#fff}
  .page{max-width:800px;margin:0 auto;padding:10px}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #8B0000;padding-bottom:8px;margin-bottom:14px}
  .logo-img{width:min(400px,100%);height:auto;max-height:80px;object-fit:contain}
  .doc-title{font-size:16pt;font-weight:900;color:#8B0000;text-align:right}
  .doc-sub{font-size:8pt;color:#888;text-align:right;margin-top:2px}
  .meta{font-size:9pt;color:#555;margin-bottom:12px;line-height:1.6}
  .items{width:100%;border-collapse:collapse;font-size:8.5pt}
  .items th{background:#8B0000;color:#fff;padding:6px 5px;text-align:left;font-size:8pt}
  .items td{padding:6px 5px;border-bottom:1px solid #ece6dc;vertical-align:top}
  .items tr:nth-child(even) td{background:#faf8f4}
  .items .num,.items .mono{text-align:right;font-family:'Courier New',monospace}
  .items .mono{text-align:left}
  .items .empty{text-align:center;color:#888;padding:14px}
  .sub-ref{font-size:7.5pt;color:#888;margin-top:2px}
  .footer{margin-top:20px;border-top:1px solid #ddd;padding-top:8px;font-size:7.5pt;color:#999;display:flex;justify-content:space-between}
  @media print{.page{padding:0}}
</style></head><body>
<div class="page">
  <div class="header">
    <img class="logo-img" src="${escapeHtml(DUTY_DESK_LOGO_SRC)}" alt="DutyDesk"/>
    <div>
      <div class="doc-title">WORKSHEET BREAKDOWN</div>
      <div class="doc-sub">Worksheet ${escapeHtml(data.worksheetNum || "")} · ${today}</div>
    </div>
  </div>
  <div class="meta">
    <strong>${escapeHtml(data.consigneeName || "")}</strong>
    ${data.supplierName ? ` · Supplier: ${escapeHtml(data.supplierName)}` : ""}
    ${data.invoiceNumber ? ` · Invoice: ${escapeHtml(data.invoiceNumber)}` : ""}
    <br/>Prepared by ${escapeHtml(preparedBy)} · ${escapeHtml(COMPANY_NAME)}
  </div>
  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Worksheet Description</th>
        <th>HS Code</th>
        <th>Qty</th>
        <th style="text-align:right">CIF Value</th>
        <th>Duty Rate</th>
        <th>VAT Rate</th>
        <th style="text-align:right">Total Duty</th>
        <th style="text-align:right">Total VAT</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="footer">
    <span>${escapeHtml(COMPANY_NAME)}</span>
    <span>Generated ${escapeHtml(new Date().toLocaleString())}</span>
  </div>
</div>
</body></html>`;
}
