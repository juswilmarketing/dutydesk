import type { EmailModalData } from "@/components/email/EmailModal";
import { COMPANY_EMAIL, COMPANY_NAME, COMPANY_SHORT, COMPANY_TAGLINE, buildEmailSignature } from "@/lib/company";

export { buildEmailSignature };

export const EC75_NOTICE_TEXT =
  "ALSO SEE ATTACHED EC75 TO BE SIGNED AND SENT BACK TO US IN THE INTERIM. ORIGINAL CAN BE SENT ALONG WITH CUSTOMS PAYMENT.";

export const EC75_LINE = `\n\n${EC75_NOTICE_TEXT}`;

export const STANDARD_EMAIL_BODY =
  "Please see the attached tax advice PDF for approval. Once approved, kindly prepare payment as per tax invoice below.\n\nReview carefully and ensure all attachments are required for the shipment and respond via email so we can process documents.\n\nNB: Customs has implemented an appointment system to clear cargo. This may cause delay in attaining your shipment. We apologize for any inconvenience caused.";

/** True when a share URL is safe to embed in customer email (not workers.dev). */
export function isCustomerSafeShareUrl(url: string | undefined | null): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (!host) return false;
    if (host === "workers.dev" || host.endsWith(".workers.dev")) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildDefaultEmailNote(includeEc75: boolean, senderName: string): string {
  return STANDARD_EMAIL_BODY + (includeEc75 ? EC75_LINE : "") + buildEmailSignature(senderName);
}

const EC75_HTML_BLOCK =
  '<div style="background:#ffe800;padding:8px 14px;font-weight:700;font-size:13px;border-left:4px solid #e6c800;margin:8px 0;color:#5a4800;">' +
  EC75_NOTICE_TEXT +
  "</div>";

const EC75_PLAIN_MARKER = `\n\n*** ${EC75_NOTICE_TEXT} ***\n\n`;

/** Matches the EC75 notice even if the user slightly edits whitespace or punctuation. */
const EC75_REGEX = /\n*ALSO SEE ATTACHED EC75[\s\S]*?CUSTOMS PAYMENT\.?\n*/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Render the message body for HTML email — always yellow-highlights EC75 when requested. */
export function renderEmailMessageHtml(note: string, includeEc75: boolean): string {
  let working = note;

  if (includeEc75) {
    if (EC75_REGEX.test(working)) {
      working = working.replace(EC75_REGEX, "\n\n__EC75_SLOT__\n\n");
    } else {
      const regardsIdx = working.search(/\n\nKind regards,/i);
      if (regardsIdx >= 0) {
        working = `${working.slice(0, regardsIdx)}\n\n__EC75_SLOT__${working.slice(regardsIdx)}`;
      } else {
        working = `${working}\n\n__EC75_SLOT__`;
      }
    }
  } else {
    working = working.replace(EC75_REGEX, "\n\n");
  }

  let html = escapeHtml(working.trim()).split("\n").join("<br/>");
  if (includeEc75) {
    html = html.replace(/__EC75_SLOT__/g, EC75_HTML_BLOCK);
  }
  return html;
}

/** Plain-text body for mailto — wraps EC75 in visible markers when selected. */
export function formatPlainEmailBody(note: string, includeEc75: boolean): string {
  if (!includeEc75) return note.replace(EC75_REGEX, "\n\n").trim();

  if (EC75_REGEX.test(note)) {
    return note.replace(EC75_REGEX, EC75_PLAIN_MARKER).trim();
  }

  const regardsIdx = note.search(/\n\nKind regards,/i);
  if (regardsIdx >= 0) {
    return `${note.slice(0, regardsIdx)}${EC75_PLAIN_MARKER}${note.slice(regardsIdx)}`.trim();
  }
  return `${note}${EC75_PLAIN_MARKER}`.trim();
}

function fmtTtd(n: number): string {
  return Number(n || 0).toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildTaxEmailHtml(
  data: EmailModalData,
  note: string,
  includeEc75: boolean,
  senderName: string,
  opts?: { secureViewUrl?: string; secureDownloadUrl?: string },
): string {
  const signer = senderName.trim() || "Brokerage Team";
  const bodyLines = renderEmailMessageHtml(note, includeEc75);
  const safeViewUrl = isCustomerSafeShareUrl(opts?.secureViewUrl) ? opts!.secureViewUrl!.trim() : "";
  const safeDownloadUrl = isCustomerSafeShareUrl(opts?.secureDownloadUrl)
    ? opts!.secureDownloadUrl!.trim()
    : "";
  const secureLinkBox = safeViewUrl
    ? '<div style="margin-top:14px;padding:12px 16px;background:#eef5ff;border:1px solid #9cb8e6;border-radius:8px;font-size:13px;line-height:1.6;color:#222;">' +
      "<strong>Backup online copy (PAS Trinidad):</strong><br/>" +
      '<span style="font-size:12px;color:#444;">The tax advice PDF is also attached to this email. Use this link only if you need an online copy:</span><br/>' +
      '<a href="' +
      escapeHtml(safeViewUrl) +
      '" style="color:#1b4f8a;font-weight:700;word-break:break-all;">' +
      escapeHtml(safeViewUrl) +
      "</a>" +
      (safeDownloadUrl
        ? '<br/><a href="' +
          escapeHtml(safeDownloadUrl) +
          '" style="color:#1b4f8a;font-weight:700;word-break:break-all;">' +
          escapeHtml(safeDownloadUrl) +
          "</a>"
        : "") +
      '<br/><span style="font-size:11px;color:#555;">Private PAS Trinidad link. Please review the attached PDF and reply by email to approve.</span></div>'
    : "";
  const msgBox =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.8;background:#f9f6f2;border-left:5px solid #8B0000;padding:18px 24px;margin-bottom:0;">' +
    bodyLines +
    secureLinkBox +
    "</div>";

  const worksheetDisplay = data.worksheetNum || "";
  const consigneeDisplay = data.consigneeName || "";

  const taxAdvice =
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:3px solid #8B0000;margin-bottom:18px;">' +
    "<tr>" +
    '<td style="padding:14px 0;">' +
    '<div style="font-size:22pt;font-weight:900;color:#8B0000;letter-spacing:-1px;line-height:1.15;">' +
    escapeHtml(COMPANY_SHORT) +
    "</div>" +
    '<div style="font-size:10pt;font-weight:700;color:#8B0000;margin-top:4px;">Brokerage Department</div>' +
    '<div style="font-size:8pt;color:#666;margin-top:3px;line-height:1.5;">' +
    escapeHtml(COMPANY_TAGLINE) +
    "<br/>" +
    '<a href="mailto:' +
    COMPANY_EMAIL +
    '" style="color:#8B0000;text-decoration:none;">' +
    escapeHtml(COMPANY_EMAIL) +
    "</a></div>" +
    "</td>" +
    '<td style="text-align:right;padding:14px 0;">' +
    '<div style="font-size:26pt;font-weight:900;color:#8B0000;letter-spacing:3px;">TAX ADVICE</div>' +
    '<div style="font-size:9pt;color:#888;margin-top:4px;">Date: ' +
    new Date().toLocaleDateString("en-TT", { day: "2-digit", month: "long", year: "numeric" }) +
    "</div>" +
    "</td>" +
    "</tr>" +
    "</table>" +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:4px;">' +
    '<tr><td style="width:220px;font-weight:700;font-size:10pt;color:#333;padding:6px 0;">Worksheet #:</td>' +
    '<td style="font-size:10pt;color:#111;padding:6px 0;border-bottom:1px solid #ddd;"><strong>' +
    worksheetDisplay +
    "</strong></td></tr>" +
    '<tr><td style="width:220px;font-weight:700;font-size:10pt;color:#333;padding:6px 0;padding-right:8px;">Consignee <span style="font-weight:400;font-size:8pt;">(MUST appear on certified chq.)</span>:</td>' +
    '<td style="font-size:10pt;color:#111;padding:6px 0;border-bottom:1px solid #ddd;"><strong>' +
    consigneeDisplay +
    "</strong></td></tr>" +
    (data.billOfLading
      ? '<tr><td style="width:220px;font-weight:700;font-size:10pt;color:#333;padding:6px 0;">Bill of Lading / Air Way Bill:</td>' +
        '<td style="font-size:10pt;color:#111;padding:6px 0;border-bottom:1px solid #ddd;">' +
        data.billOfLading +
        "</td></tr>"
      : "") +
    (data.commodity
      ? '<tr><td style="width:220px;font-weight:700;font-size:10pt;color:#333;padding:6px 0;">Commodity:</td>' +
        '<td style="font-size:10pt;color:#111;padding:6px 0;border-bottom:1px solid #ddd;">' +
        data.commodity +
        "</td></tr>"
      : "") +
    '<tr><td style="width:220px;font-weight:700;font-size:10pt;color:#333;padding:6px 0;">Prepared by:</td>' +
    '<td style="font-size:10pt;color:#111;padding:6px 0;border-bottom:1px solid #ddd;"><strong>' +
    escapeHtml(signer) +
    "</strong></td></tr>" +
    "</table>" +
    '<div style="background:#f9f6f0;border:1.5px solid #c8a96e;border-radius:6px;padding:14px 18px;margin:16px 0;font-size:10pt;">' +
    '<div style="font-size:11pt;font-weight:700;color:#8B0000;margin-bottom:10px;">Payment Methods</div>' +
    '<div style="margin-bottom:6px;"><span style="color:#8B0000;font-weight:700;margin-right:6px;">&#9658;</span><strong>TOTAL LESS THAN TTD 5,000.00</strong> &mdash; CASH or CERTIFIED CHEQUE</div>' +
    '<div style="margin-bottom:10px;"><span style="color:#8B0000;font-weight:700;margin-right:6px;">&#9658;</span><strong>MORE THAN TTD 5,000.00</strong> &mdash; CERTIFIED CHEQUE ONLY</div>' +
    '<div style="font-size:10pt;">Make Certified Cheque payable to:<br/>' +
    '<span style="font-size:13pt;font-weight:700;color:#8B0000;display:block;margin-top:4px;">THE COMPTROLLER OF CUSTOMS &amp; EXCISE</span></div>' +
    "</div>" +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;font-size:11pt;">' +
    "<tr>" +
    '<th style="background:#8B0000;color:#fff;padding:10px 16px;text-align:left;font-size:10pt;font-weight:700;">TAX / FEE</th>' +
    '<th style="background:#8B0000;color:#fff;padding:10px 16px;text-align:right;font-size:10pt;font-weight:700;">VALUE in TTD</th>' +
    "</tr>" +
    [
      ["IMPORT DUTY (ICD):", data.totalDuty],
      ["VALUE ADDED TAX (VAT):", data.totalVAT],
      ["CONTAINER EXAM FEE (CES):", data.cesFee],
      ["DEPOSIT ENTRY / OTHER FEE:", data.depositFee],
      ["USER FEE (UFC):", data.userFeeAmt],
    ]
      .map(
        ([label, val], i) =>
          '<tr style="background:' +
          (i % 2 === 0 ? "#fff" : "#faf8f4") +
          '">' +
          '<td style="padding:9px 16px;border-bottom:1px solid #e8e0d0;font-size:11pt;">' +
          label +
          "</td>" +
          '<td style="padding:9px 16px;border-bottom:1px solid #e8e0d0;text-align:right;font-family:\'Courier New\',monospace;font-weight:600;">$' +
          fmtTtd(val as number) +
          "</td>" +
          "</tr>",
      )
      .join("") +
    "<tr>" +
    '<td style="background:#8B0000;color:#fff;font-weight:700;font-size:14pt;padding:12px 16px;">TOTAL PAYABLE</td>' +
    '<td style="background:#8B0000;color:#fff;font-weight:700;font-size:14pt;padding:12px 16px;text-align:right;font-family:\'Courier New\',monospace;">TT$ ' +
    fmtTtd(data.grandTotal) +
    "</td>" +
    "</tr>" +
    "</table>" +
    '<div style="margin-top:16px;font-size:9pt;color:#777;border-top:1px solid #ddd;padding-top:10px;line-height:1.7;">' +
    "&#9432; The above figures are <strong>estimates only</strong> and subject to change upon final assessment by T&amp;T Customs &amp; Excise." +
    "</div>" +
    '<div style="margin-top:20px;font-size:11pt;color:#333;font-weight:600;">Kind regards,<br/>' +
    '<span style="color:#8B0000;font-size:13pt;">' +
    escapeHtml(signer) +
    "</span><br/>" +
    '<span style="font-size:11pt;color:#333;">' +
    escapeHtml(COMPANY_NAME) +
    "</span><br/>" +
    '<a href="mailto:' +
    COMPANY_EMAIL +
    '" style="color:#8B0000;font-size:10pt;text-decoration:none;">' +
    escapeHtml(COMPANY_EMAIL) +
    "</a></div>" +
    '<div style="margin-top:24px;border-top:2px solid #8B0000;padding-top:10px;font-size:8pt;color:#999;">' +
    escapeHtml(COMPANY_NAME) +
    " &middot; " +
    escapeHtml(COMPANY_EMAIL) +
    "</div>";

  return (
    "<!DOCTYPE html>" +
    '<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    "<title>" +
    escapeHtml(COMPANY_SHORT) +
    " Tax Advice - " +
    escapeHtml(worksheetDisplay) +
    "</title></head>" +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">' +
    '<div style="max-width:680px;margin:0 auto;background:#ffffff;">' +
    msgBox +
    '<div style="height:4px;background:#8B0000;"></div>' +
    '<div style="padding:24px 28px;">' +
    taxAdvice +
    "</div></div></body></html>"
  );
}

export function downloadEmailHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
