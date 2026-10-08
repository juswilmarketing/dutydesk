import type { EmailModalData } from "@/components/email/EmailModal";
import { fmtTTD } from "@pas/tax-engine";
import { COMPANY_EMAIL, COMPANY_NAME, COMPANY_SHORT } from "@/lib/company";
import { isCustomerSafeShareUrl } from "@/lib/export/tax-email-body";

import { parsePhoneList } from "@/lib/contact-list";

/** Normalize T&T numbers for wa.me (e.g. 868-555-1234 → 18685551234). */
export function normalizeWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 7) return `1868${digits}`;
  if (digits.length === 10 && digits.startsWith("868")) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

export interface WhatsAppMessageOptions {
  consigneeEmail?: string;
  /** Secure link to view/download the tax advice PDF */
  secureViewUrl?: string;
}

function chargeSummary(
  data: Pick<
    EmailModalData,
    "totalDuty" | "totalVAT" | "cesFee" | "depositFee" | "userFeeAmt" | "grandTotal"
  >,
): string[] {
  return [
    `ICD: ${fmtTTD(data.totalDuty)}`,
    `VAT: ${fmtTTD(data.totalVAT)}`,
    ...(data.cesFee > 0 ? [`CES: ${fmtTTD(data.cesFee)}`] : []),
    ...(data.depositFee > 0 ? [`Deposit/Other: ${fmtTTD(data.depositFee)}`] : []),
    ...(data.userFeeAmt > 0 ? [`User Fee: ${fmtTTD(data.userFeeAmt)}`] : []),
    `*TOTAL PAYABLE: ${fmtTTD(data.grandTotal)}*`,
  ];
}

export function buildWhatsAppTaxMessage(
  data: Pick<
    EmailModalData,
    | "worksheetNum"
    | "totalDuty"
    | "totalVAT"
    | "cesFee"
    | "depositFee"
    | "userFeeAmt"
    | "grandTotal"
    | "preparedBy"
  >,
  opts: WhatsAppMessageOptions = {},
): string {
  const worksheetRef = data.worksheetNum?.trim() || "your shipment";
  const intro = `Worksheet *${worksheetRef}* has been prepared. Summary of charges below:`;

  const safeView = isCustomerSafeShareUrl(opts.secureViewUrl) ? opts.secureViewUrl!.trim() : "";
  const pdfBlock = safeView
    ? `📄 Backup online copy (PAS Trinidad):\n${safeView}`
    : "📄 Tax advice PDF is attached to your email — please check email for the document.";

  const emailLine = opts.consigneeEmail?.trim()
    ? `📧 To view all attachments, please check your email (${opts.consigneeEmail.trim()}) for approval.`
    : "📧 To view all attachments, please check your email for approval.";

  return [
    `*${COMPANY_SHORT} — Tax Advice*`,
    data.preparedBy ? `Prepared by: *${data.preparedBy}*` : "",
    "",
    intro,
    "",
    ...chargeSummary(data),
    "",
    pdfBlock,
    "",
    emailLine,
    "",
    `${COMPANY_NAME} | ${COMPANY_EMAIL}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function openWhatsApp(phone: string, text: string) {
  const normalized = normalizeWhatsAppPhone(phone);
  const url = normalized
    ? `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

/** Open one WhatsApp chat per number (slight stagger so browsers allow multiple tabs). */
export function openWhatsAppMany(phones: string[], text: string) {
  const unique = [...new Set(phones.map((p) => p.trim()).filter(Boolean))];
  if (!unique.length) {
    openWhatsApp("", text);
    return;
  }
  unique.forEach((phone, index) => {
    window.setTimeout(() => openWhatsApp(phone, text), index * 350);
  });
}

/** Split comma / semicolon / slash / whitespace-separated phone lists. */
export function parseWhatsAppPhoneList(raw: string | undefined): string[] {
  return parsePhoneList(raw);
}
