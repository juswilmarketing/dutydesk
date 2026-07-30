import type { Invoice } from "@pas/shared-types";

export type JobAttachmentSource = "generated" | "uploaded";

export interface JobAttachmentItem {
  id: string;
  /** Display label shown in the checklist. */
  label: string;
  /** Category/type of document (Commercial Invoice, Supporting Document, etc.). */
  category: string;
  source: JobAttachmentSource;
  /** Original uploaded filename, when the item maps to an uploaded file. */
  filename?: string;
  /** Required documents cannot be deselected. */
  required: boolean;
  selected: boolean;
}

export interface BuildChecklistInput {
  worksheetNum: string;
  invoices: Invoice[];
  /** Whether the itemized line-by-line report is available to include. */
  canIncludeItemizedReport: boolean;
  includeItemizedReportDefault?: boolean;
}

const slug = (v: string) => (v || "Assessment").replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * Builds the attachment checklist for a Brokerage Clearance job package.
 * Required (locked): Worksheet PDF, Tax Breakdown PDF, and the Commercial Invoice
 * (first uploaded invoice). Everything else is optional and selected by default.
 */
export function buildJobAttachmentChecklist(input: BuildChecklistInput): JobAttachmentItem[] {
  const s = slug(input.worksheetNum);
  const items: JobAttachmentItem[] = [
    {
      id: "worksheet-pdf",
      label: `DutyDesk_Worksheet_${s}.pdf`,
      category: "Worksheet PDF",
      source: "generated",
      required: true,
      selected: true,
    },
    {
      id: "tax-breakdown-pdf",
      label: `DutyDesk_Tax_Breakdown_${s}.pdf`,
      category: "Tax Breakdown PDF",
      source: "generated",
      required: true,
      selected: true,
    },
  ];

  if (input.canIncludeItemizedReport) {
    items.push({
      id: "itemized-report-pdf",
      label: `DutyDesk_Itemized_Report_${s}.pdf`,
      category: "Line Item Classification Report",
      source: "generated",
      required: false,
      selected: input.includeItemizedReportDefault ?? true,
    });
  }

  input.invoices.forEach((inv, idx) => {
    const isCommercialInvoice = idx === 0;
    items.push({
      id: `upload-${inv.id}`,
      label: inv.filename,
      category: isCommercialInvoice ? "Commercial Invoice" : "Supporting Document",
      source: "uploaded",
      filename: inv.filename,
      required: isCommercialInvoice,
      selected: true,
    });
  });

  return items;
}

export function selectedAttachmentCount(items: JobAttachmentItem[]): number {
  return items.filter((i) => i.selected).length;
}

export function selectedAttachmentNames(items: JobAttachmentItem[]): string[] {
  return items.filter((i) => i.selected).map((i) => i.label);
}
