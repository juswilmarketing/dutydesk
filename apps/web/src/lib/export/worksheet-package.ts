import type { TaxBreakdownData } from "@pas/shared-types";
import type { TaxAdviceData } from "./tax-advice-report";
import { buildTaxAdviceHtml } from "./tax-advice-report";
import { buildGroupedWorksheetHtml } from "./worksheet-grouped";
import { buildOriginalInvoiceBreakdownHtml } from "./worksheet-original-invoice";
import { downloadHtmlAsPdf, htmlToPdfBase64 } from "./tax-advice-pdf";

export interface WorksheetPackageOptions {
  /** Include page 3 original invoice audit breakdown (default true). */
  includeOriginalInvoice?: boolean;
}

function extractBody(html: string): string {
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || "";
}

function extractStyles(html: string): string {
  return html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join("\n") || "";
}

/**
 * V2 worksheet package layout — wraps the authoritative V1 Tax Advice HTML unchanged.
 * Page 1: existing Tax Advice · Page 2: grouped worksheet · Page 3: original invoice (optional)
 */
export function buildWorksheetPackageHtml(
  advice: TaxAdviceData,
  breakdown: TaxBreakdownData,
  options: WorksheetPackageOptions = {},
): string {
  const includeOriginal = options.includeOriginalInvoice !== false;

  const page1 = buildTaxAdviceHtml(advice);
  const page2 = buildGroupedWorksheetHtml(breakdown);
  const page3 = includeOriginal ? buildOriginalInvoiceBreakdownHtml(breakdown) : "";

  const styles = [page1, page2, page3].map(extractStyles).join("\n");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>DutyDesk Worksheet Package - ${advice.worksheetNum}</title>
<style>
${styles}
.package-page-break{page-break-before:always}
@media print{.package-page-break{page-break-before:always}}
</style></head><body>
${extractBody(page1)}
<div class="package-page-break"></div>
${extractBody(page2)}
${includeOriginal ? `<div class="package-page-break"></div>${extractBody(page3)}` : ""}
</body></html>`;
}

/** Standalone V1 Tax Advice PDF HTML — backwards compatible with pre-package sends. */
export function buildTaxAdviceOnlyHtml(advice: TaxAdviceData): string {
  return buildTaxAdviceHtml(advice);
}

export async function downloadWorksheetPackagePdf(
  advice: TaxAdviceData,
  breakdown: TaxBreakdownData,
  worksheetNum: string,
  options?: WorksheetPackageOptions,
) {
  const html = buildWorksheetPackageHtml(advice, breakdown, options);
  await downloadHtmlAsPdf(html, `DutyDesk_Worksheet_${worksheetNum || "Package"}`, 800);
}

export async function taxAdvicePdfBase64(advice: TaxAdviceData): Promise<string> {
  return htmlToPdfBase64(buildTaxAdviceHtml(advice));
}

export async function groupedWorksheetPdfBase64(breakdown: TaxBreakdownData): Promise<string> {
  return htmlToPdfBase64(buildGroupedWorksheetHtml(breakdown), 800);
}

export async function originalInvoicePdfBase64(breakdown: TaxBreakdownData): Promise<string> {
  return htmlToPdfBase64(buildOriginalInvoiceBreakdownHtml(breakdown), 800);
}

export async function worksheetPackagePdfBase64(
  advice: TaxAdviceData,
  breakdown: TaxBreakdownData,
  options?: WorksheetPackageOptions,
): Promise<string> {
  return htmlToPdfBase64(buildWorksheetPackageHtml(advice, breakdown, options), 800);
}
