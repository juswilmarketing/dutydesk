import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Mail,
  MessageCircle,
  Paperclip,
  Send,
  Upload,
  X,
} from "lucide-react";
import type { TaxLogAttachment, TaxBreakdownData } from "@pas/shared-types";
import { fmtTTD } from "@pas/tax-engine";
import { appendTaxLog } from "@/lib/tax-log";
import { pushTaxLogEntry } from "@/lib/workflow-sync";
import { cn } from "@/lib/cn";
import { downloadHtmlAsPdf, htmlToPdfBase64 } from "@/lib/export/tax-advice-pdf";
import {
  buildDefaultEmailNote,
  buildEmailSignature,
  buildTaxEmailHtml,
  EC75_LINE,
  EC75_NOTICE_TEXT,
  formatPlainEmailBody,
  isCustomerSafeShareUrl,
  STANDARD_EMAIL_BODY,
} from "@/lib/export/tax-email-body";
import { COMPANY_EMAIL, COMPANY_NAME, COMPANY_SHORT } from "@/lib/company";
import { emailsAreValid, formatEmailList, parseEmailList } from "@/lib/contact-list";
import { buildWhatsAppTaxMessage, openWhatsAppMany, parseWhatsAppPhoneList } from "@/lib/export/tax-whatsapp";
import { fileToBase64 } from "@/lib/export/email-attachments";
import { api } from "@/lib/api-client";
import { useWorkflowStore } from "@/stores/workflow-store";
import { buildTaxBreakdownHtml } from "@/lib/export/tax-breakdown";
import { Button } from "@/components/ui/button";

export interface EmailModalData {
  html: string;
  worksheetNum: string;
  consigneeName: string;
  toEmail: string;
  subject: string;
  billOfLading: string;
  commodity: string;
  totalDuty: number;
  totalVAT: number;
  depositFee: number;
  cesFee: number;
  userFeeAmt: number;
  grandTotal: number;
  consigneePhone?: string;
  preparedBy?: string;
  /** Itemized calculation detail — optional second attachment when sending */
  breakdown?: TaxBreakdownData | null;
}

type SendMode = "email" | "whatsapp";
type SentVia = SendMode | "email-direct" | null;

interface Props {
  data: EmailModalData;
  currentUserName: string;
  onClose: () => void;
  /** Override the modal header title (e.g. "Send Classification Worksheet"). */
  title?: string;
  /** Override the modal header subtitle. */
  subtitle?: string;
  /** Fired once after a successful send (email, WhatsApp, or mail client). */
  onSent?: () => void;
}

function SectionTitle({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: "var(--accent-light)", color: "var(--accent)" }}
      >
        {step}
      </span>
      <div>
        <div className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </div>
        {hint && (
          <div className="text-[11px]" style={{ color: "var(--text2)" }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentRow({
  icon: Icon,
  name,
  detail,
  badge,
  highlight,
  onDownload,
}: {
  icon: typeof FileText;
  name: string;
  detail: string;
  badge?: string;
  highlight?: boolean;
  onDownload?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
        highlight && "dd-ec75-panel",
      )}
      style={
        highlight
          ? undefined
          : { background: "var(--surface)", borderColor: "var(--border)" }
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: highlight ? "#ffe80033" : "var(--accent-light)", color: highlight ? "#7a6000" : "var(--accent)" }}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-xs font-semibold">
            <span className="truncate">{name}</span>
            {badge && (
              <span className="shrink-0 rounded px-1 py-px text-[9px] font-bold" style={{ background: "#ffe800", color: "#5a4800" }}>
                {badge}
              </span>
            )}
          </div>
          <div className="text-[10px]" style={{ color: highlight ? "inherit" : "var(--text2)" }}>
            {detail}
          </div>
        </div>
      </div>
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text2)", background: "var(--surface2)" }}
          title="Download"
        >
          <Download size={12} />
        </button>
      )}
    </div>
  );
}

export function EmailModal({ data, currentUserName, onClose, title, subtitle, onSent }: Props) {
  const ccBrokerage = useWorkflowStore((s) => s.ccBrokerage);
  const toggleCcBrokerage = useWorkflowStore((s) => s.toggleCcBrokerage);
  const refreshTaxLog = useWorkflowStore((s) => s.refreshTaxLog);

  const hasSavedPhone = Boolean(data.consigneePhone?.trim());
  const [to, setTo] = useState(data.toEmail || "");
  const [phone, setPhone] = useState(data.consigneePhone || "");
  const [cc, setCc] = useState(ccBrokerage ? "brokerage@pastrinidad.com" : "");
  const [subject, setSubject] = useState(data.subject || "");
  const [sendViaWhatsApp, setSendViaWhatsApp] = useState(hasSavedPhone);
  const [modeChoice, setModeChoice] = useState<SendMode>("email");
  const mode: SendMode = hasSavedPhone ? (sendViaWhatsApp ? "whatsapp" : "email") : modeChoice;
  const [ec75, setEc75] = useState(false);
  const [includeBreakdown, setIncludeBreakdown] = useState(false);
  const [note, setNote] = useState(buildDefaultEmailNote(false, currentUserName));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sent, setSent] = useState(false);
  const [sentVia, setSentVia] = useState<SentVia>(null);
  const [dragOver, setDragOver] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [emailFrom, setEmailFrom] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [whatsappEmailSent, setWhatsappEmailSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sentNotified = useRef(false);

  const worksheetSlug = (data.worksheetNum || "Assessment").replace(/[^a-zA-Z0-9_-]/g, "_");
  const taxAdvicePdfFilename = `DutyDesk_Tax_Advice_${worksheetSlug}.pdf`;
  const breakdownPdfFilename = `DutyDesk_Tax_Breakdown_${worksheetSlug}.pdf`;
  const breakdownHtml = data.breakdown ? buildTaxBreakdownHtml(data.breakdown) : "";
  const canIncludeBreakdown = Boolean(data.breakdown && (data.breakdown.invoiceTotal > 0 || data.breakdown.rows.length > 0));
  const canSendEmail = emailsAreValid(to) && subject.trim().length > 0;
  const recipientEmails = parseEmailList(to.trim() || data.toEmail || "");
  const recipientEmail = formatEmailList(recipientEmails);
  const recipientPhones = parseWhatsAppPhoneList(phone.trim() || data.consigneePhone || "");
  const ccEmails = parseEmailList(cc);
  const ccList = formatEmailList(ccEmails);

  const toggleEc75 = (val: boolean) => {
    setEc75(val);
    setNote(STANDARD_EMAIL_BODY + (val ? EC75_LINE : "") + buildEmailSignature(currentUserName));
  };

  const addFiles = useCallback((files: File[]) => {
    setAttachments((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...files.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = "";
  };

  const removeFile = (name: string) => setAttachments((p) => p.filter((f) => f.name !== name));

  const logSend = (
    method: string,
    recipient: string,
    ccAddr = "",
    extraAttachments: TaxLogAttachment[] = [],
    includePdf = true,
  ) => {
    const autoAttachments: TaxLogAttachment[] = [
      ...(includePdf ? [{ name: taxAdvicePdfFilename, type: "application/pdf", size: "auto", auto: true }] : []),
      ...(includeBreakdown && breakdownHtml
        ? [{ name: breakdownPdfFilename, type: "application/pdf", size: "auto", auto: true }]
        : []),
      ...(ec75 ? [{ name: "EC75 (attach manually)", type: "application/pdf", size: "manual", auto: false }] : []),
      ...attachments.map((f) => ({
        name: f.name,
        type: f.type || "application/octet-stream",
        size: `${Math.round(f.size / 1024)}KB`,
      })),
      ...extraAttachments,
    ];
    const flowboardTaskId = sessionStorage.getItem("flowboard:taskId") || undefined;
    const entry = appendTaxLog({
      worksheetNum: data.worksheetNum || "",
      consigneeName: data.consigneeName || "",
      billOfLading: data.billOfLading || "",
      commodity: data.commodity || "",
      totalDuty: data.totalDuty || 0,
      totalVAT: data.totalVAT || 0,
      depositFee: data.depositFee || 0,
      cesFee: data.cesFee || 0,
      userFeeAmt: data.userFeeAmt || 0,
      grandTotal: data.grandTotal || 0,
      sentTo: recipient,
      sentCc: ccAddr,
      sentBy: currentUserName,
      sentAt: new Date().toISOString(),
      method: ec75 ? `${method} + EC75` : method,
      attachments: autoAttachments,
      documentType: "worksheet",
      jobType: "classification_only",
      dutyDeskStatus: "completed_directly",
      flowboardStatus: "sent_via_email",
      ...(flowboardTaskId ? { taskId: flowboardTaskId } : {}),
    });
    pushTaxLogEntry(entry).catch(() => null);
    refreshTaxLog();
  };

  const downloadSendFiles = async () => {
    await downloadHtmlAsPdf(data.html, taxAdvicePdfFilename);
    if (includeBreakdown && breakdownHtml) {
      await downloadHtmlAsPdf(breakdownHtml, breakdownPdfFilename, 760);
    }
  };

  const prepareTaxAdviceEmail = async () => {
    // Build HTML email body immediately (no PDF). Only convert tax-advice HTML once.
    let pdfBase64 = "";
    let secureViewUrl = "";
    let secureDownloadUrl = "";

    const userFilesPromise = Promise.all(
      attachments.map(async (file) => ({
        filename: file.name,
        content: await fileToBase64(file),
        mimeType: file.type || "application/octet-stream",
      })),
    );

    const breakdownPdfPromise = includeBreakdown && breakdownHtml
      ? htmlToPdfBase64(breakdownHtml, 760).catch((err) => {
          console.warn("Breakdown PDF failed:", err);
          return "";
        })
      : Promise.resolve("");

    try {
      pdfBase64 = await htmlToPdfBase64(data.html);
      const share = await api.createTaxAdviceShare({
        pdfBase64,
        worksheetNum: data.worksheetNum,
        consigneeName: data.consigneeName,
        filename: taxAdvicePdfFilename,
      });
      secureViewUrl = share.viewerUrl || `${share.viewUrl}?view=1`;
      secureDownloadUrl = share.downloadUrl;
    } catch (err) {
      console.warn("Tax advice PDF/share failed:", err);
      if (!pdfBase64) {
        try {
          pdfBase64 = await htmlToPdfBase64(data.html);
        } catch {
          /* no tax advice PDF */
        }
      }
    }

    const [breakdownPdfBase64, userFiles] = await Promise.all([
      breakdownPdfPromise,
      userFilesPromise,
    ]);

    // Never put workers.dev share URLs in customer email — domain filters block them.
    const emailViewUrl = isCustomerSafeShareUrl(secureViewUrl) ? secureViewUrl : "";
    const emailDownloadUrl = isCustomerSafeShareUrl(secureDownloadUrl) ? secureDownloadUrl : "";

    const fullEmailHtmlWithLink = buildTaxEmailHtml(data, note, ec75, currentUserName, {
      secureViewUrl: emailViewUrl || undefined,
      secureDownloadUrl: emailDownloadUrl || undefined,
    });

    const attachmentList: Array<{ filename: string; content: string; mimeType: string }> = [];

    if (pdfBase64) {
      attachmentList.push({
        filename: taxAdvicePdfFilename,
        content: pdfBase64,
        mimeType: "application/pdf",
      });
    }

    if (breakdownPdfBase64) {
      attachmentList.push({
        filename: breakdownPdfFilename,
        content: breakdownPdfBase64,
        mimeType: "application/pdf",
      });
    }

    // Email body stays as HTML in the message — do not attach a duplicate Email Body PDF.
    attachmentList.push(...userFiles);

    const extraLogAttachments: TaxLogAttachment[] = emailViewUrl
      ? [{ name: "Secure PDF link", type: "link", size: emailViewUrl, auto: true }]
      : [];

    return {
      fullEmailHtml: fullEmailHtmlWithLink,
      attachmentList,
      // WhatsApp / internal: only surface branded share URLs (same filter as email)
      secureViewUrl: emailViewUrl,
      secureDownloadUrl: emailDownloadUrl,
      extraLogAttachments,
    };
  };

  const sendPreparedEmail = async (prepared: Awaited<ReturnType<typeof prepareTaxAdviceEmail>>) => {
    if (!emailsAreValid(recipientEmail)) throw new Error("Enter at least one valid recipient email");
    if (!subject.trim()) throw new Error("Subject is required");

    await api.sendEmail({
      to: recipientEmail,
      cc: ccList || undefined,
      subject: subject.trim(),
      html: prepared.fullEmailHtml,
      attachments: prepared.attachmentList,
      fromName: COMPANY_NAME,
      fromAddress: COMPANY_EMAIL,
      replyTo: COMPANY_EMAIL,
    });
  };

  const performDirectEmailSend = async () => {
    const prepared = await prepareTaxAdviceEmail();
    await sendPreparedEmail(prepared);
    return prepared;
  };

  const sendMailto = async () => {
    await downloadSendFiles();

    const plain =
      formatPlainEmailBody(note, ec75) +
      "\n\n---\nTax advice documents are downloaded as PDF files — attach them to your email.\n" +
      (includeBreakdown ? "Tax calculation breakdown PDF is also downloaded.\n" : "") +
      (ec75 ? "Remember to attach the signed EC75 form.\n\n" : "") +
      `${COMPANY_NAME} | ${COMPANY_EMAIL}`;
    const mailto =
      `mailto:${encodeURIComponent(recipientEmail)}` +
      (ccList ? `?cc=${encodeURIComponent(ccList)}&` : "?") +
      `subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(plain)}`;
    window.open(mailto, "_blank");
    logSend("Mail Client", recipientEmail, ccList);
    setSentVia("email");
    setSent(true);
  };

  const sendDirectEmail = async () => {
    setSending(true);
    setSendError(null);
    try {
      const prepared = await performDirectEmailSend();
      logSend("Gmail", recipientEmail, ccList, prepared.extraLogAttachments);
      setSentVia("email-direct");
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  };

  const sendWhatsApp = async () => {
    setSending(true);
    setSendError(null);
    let emailSent = false;
    let prepared: Awaited<ReturnType<typeof prepareTaxAdviceEmail>> | null = null;

    try {
      prepared = await prepareTaxAdviceEmail();

      if (emailConfigured && emailsAreValid(recipientEmail) && subject.trim()) {
        try {
          await sendPreparedEmail(prepared);
          emailSent = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to send email";
          setSendError(`Email could not be sent: ${msg}. WhatsApp will still open with the PDF link.`);
        }
      }

      if (!emailSent) await downloadSendFiles();

      const text = buildWhatsAppTaxMessage(data, {
        consigneeEmail: recipientEmail,
        secureViewUrl: prepared.secureViewUrl,
      });
      openWhatsAppMany(recipientPhones, text);

      const logExtras = prepared.extraLogAttachments;
      const phoneLabel = recipientPhones.join(", ") || data.consigneeName || "WhatsApp";
      if (emailSent) {
        logSend("WhatsApp + Gmail", phoneLabel, recipientEmail, logExtras);
      } else {
        logSend("WhatsApp", phoneLabel, "", logExtras, Boolean(prepared.secureViewUrl));
      }

      setWhatsappEmailSent(emailSent);
      setSentVia("whatsapp");
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    api.getEmailStatus().then((status) => {
      setEmailConfigured(status.configured);
      setEmailFrom(status.from || "");
    }).catch(() => setEmailConfigured(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sent) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sent]);

  useEffect(() => {
    if (sent && !sentNotified.current) {
      sentNotified.current = true;
      onSent?.();
    }
  }, [sent, onSent]);

  return (
    <div
      className="dd-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sent) onClose();
      }}
    >
      <div className="dd-modal-panel max-w-2xl" role="dialog" aria-labelledby="email-modal-title">
        {/* Header */}
        <div className="shrink-0 border-b px-4 py-4 sm:px-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "var(--accent-light)", color: "var(--accent)" }}
              >
                <Mail size={20} />
              </span>
              <div>
                <h2 id="email-modal-title" className="text-base font-bold" style={{ color: "var(--text)" }}>
                  {title || "Send Tax Advice"}
                </h2>
                <p className="text-xs" style={{ color: "var(--text2)" }}>
                  {subtitle ||
                    (hasSavedPhone
                      ? "WhatsApp is selected when a consignee number is saved — uncheck to email instead"
                      : "Choose email or WhatsApp — worksheet details sync to team Reports")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border-none p-1.5 transition hover:opacity-70"
              style={{ color: "var(--text2)", background: "var(--surface2)" }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {data.worksheetNum && (
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: "var(--surface2)", color: "var(--text)" }}>
                {data.worksheetNum}
              </span>
            )}
            {data.consigneeName && (
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
                {data.consigneeName}
              </span>
            )}
            <span className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold" style={{ background: "var(--green-light)", color: "var(--green)" }}>
              {fmtTTD(data.grandTotal)}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {sent ? (
            <div className="animate-fade-up py-4">
              <div className="mb-5 text-center">
                <div
                  className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full"
                  style={{ background: "var(--green-light)", color: "var(--green)" }}
                >
                  <CheckCircle2 size={28} />
                </div>
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--green)" }}>
                  {sentVia === "email-direct"
                    ? "Email sent"
                    : sentVia === "whatsapp" && whatsappEmailSent
                      ? "WhatsApp & email sent"
                      : "Ready to send"}
                </h3>
                <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
                  {sentVia === "email-direct"
                    ? `Email sent to ${recipientEmail} with tax advice PDF and secure link`
                    : sentVia === "whatsapp" && whatsappEmailSent
                      ? `Email sent to ${recipientEmail} — finish the WhatsApp message`
                      : sentVia === "whatsapp"
                        ? "Complete these steps in WhatsApp"
                        : "Complete these steps in your mail client"}
                </p>
              </div>

              <ol className="space-y-2.5">
                {sentVia === "email-direct" ? (
                  <li
                    className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs"
                    style={{ borderColor: "var(--border)", background: "var(--surface2)" }}
                  >
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--green)" }} />
                    <span style={{ color: "var(--text)" }}>
                      Sent from Gmail with tax advice PDF{includeBreakdown ? " and breakdown" : ""}{attachments.length ? " plus your attachments" : ""}{ccList ? ` (CC: ${ccList})` : ""}
                    </span>
                  </li>
                ) : sentVia === "whatsapp" ? (
                [
                  ...(whatsappEmailSent
                    ? [{ done: true, text: `Email sent to ${recipientEmail} with tax advice PDF` }]
                    : recipientEmail && !emailConfigured
                      ? [{ done: false, text: `Email not sent — connect Gmail in Google Apps Script (consignee: ${recipientEmail})`, warn: true }]
                      : recipientEmail
                        ? [{ done: false, text: `Email not sent to ${recipientEmail} — check error above`, warn: true }]
                        : [{ done: false, text: "No consignee email — add email in Consignee Manager for automatic send", warn: true }]),
                  { done: true, text: `WhatsApp opened with total payable and secure PDF link${recipientPhones.length ? ` for ${recipientPhones.join(", ")}` : ""}` },
                  ...(!whatsappEmailSent
                    ? [
                        { done: true, text: "Tax advice PDF link is included in the WhatsApp message" },
                        ...(attachments.length > 0
                          ? attachments.map((f) => ({ done: false, text: `Attach ${f.name} manually in WhatsApp`, warn: false }))
                          : []),
                      ]
                    : []),
                  ...(ec75 ? [{ done: false, text: "EC75 instructions included in email — attach signed form if replying", warn: true }] : []),
                ].map((item, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
                      item.warn && "dd-ec75-panel",
                    )}
                    style={item.warn ? undefined : { borderColor: "var(--border)", background: "var(--surface2)" }}
                  >
                    {item.done ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--green)" }} />
                    ) : (
                      <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: item.warn ? "#7a6000" : "var(--accent)" }} />
                    )}
                    <span style={{ color: "var(--text)" }}>{item.text}</span>
                  </li>
                ))
                ) : (
                [
                  { done: true, text: "Mail client opened for " + recipientEmail },
                  { done: true, text: `Attach ${taxAdvicePdfFilename}` },
                  ...(includeBreakdown ? [{ done: true, text: `Attach ${breakdownPdfFilename}` }] : []),
                  ...(ec75 ? [{ done: false, text: "Attach signed EC75 form", warn: true }] : []),
                  ...(attachments.length > 0
                    ? attachments.map((f) => ({ done: false, text: `Attach ${f.name}`, warn: false }))
                    : []),
                ].map((item, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
                      item.warn && "dd-ec75-panel",
                    )}
                    style={item.warn ? undefined : { borderColor: "var(--border)", background: "var(--surface2)" }}
                  >
                    {item.done ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--green)" }} />
                    ) : (
                      <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: item.warn ? "#7a6000" : "var(--accent)" }} />
                    )}
                    <span style={{ color: "var(--text)" }}>{item.text}</span>
                  </li>
                ))
                )}
              </ol>

              <div className="mt-5 flex justify-center">
                <Button onClick={onClose} className="text-sm" style={{ background: "var(--accent)" }}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {hasSavedPhone ? (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition"
                  style={{ borderColor: sendViaWhatsApp ? "#25D366" : "var(--border)", background: sendViaWhatsApp ? "#dcf8c622" : "var(--surface)" }}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={sendViaWhatsApp}
                    onChange={(e) => setSendViaWhatsApp(e.target.checked)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: sendViaWhatsApp ? "#128c7e" : "var(--text)" }}>
                      <MessageCircle size={14} />
                      Send via WhatsApp
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: "var(--text2)" }}>
                      {data.consigneePhone}
                      {!sendViaWhatsApp && " — unchecked, will send by email instead"}
                    </div>
                  </div>
                </label>
              ) : (
                <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface2)" }}>
                  <button
                    type="button"
                    onClick={() => setModeChoice("email")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md border-none px-3 py-2 text-xs font-semibold transition",
                      modeChoice === "email" ? "dd-tab-active" : "",
                    )}
                    style={modeChoice === "email" ? undefined : { color: "var(--text2)", background: "transparent" }}
                  >
                    <Mail size={14} />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setModeChoice("whatsapp")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md border-none px-3 py-2 text-xs font-semibold transition",
                      modeChoice === "whatsapp" && "font-semibold",
                    )}
                    style={
                      modeChoice === "whatsapp"
                        ? { background: "#dcf8c6", color: "#128c7e" }
                        : { color: "var(--text2)", background: "transparent" }
                    }
                  >
                    <MessageCircle size={14} />
                    WhatsApp
                  </button>
                </div>
              )}

              {/* Step 1: Recipients */}
              <section className="dd-modal-section">
                <SectionTitle
                  step={1}
                  title={mode === "email" ? "Email recipients" : "WhatsApp recipients"}
                  hint={
                    mode === "email"
                      ? emailConfigured
                        ? "Add one or more emails, separated by commas — tax advice attaches automatically"
                        : "Add one or more emails, separated by commas"
                      : emailConfigured && recipientEmail
                        ? "Add one or more WhatsApp numbers — email sends first, then each chat opens"
                        : recipientEmail
                          ? "Add Gmail Apps Script to auto-email — or add consignee email in Manage"
                          : "Add one or more WhatsApp numbers — add email too for automatic send"
                  }
                />
                {mode === "email" ? (
                  <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="dd-label" htmlFor="email-to">
                      To <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <input
                      id="email-to"
                      className="dd-input"
                      type="text"
                      inputMode="email"
                      placeholder="a@company.com, b@company.com"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      autoFocus
                    />
                    <p className="mt-1 text-[10px]" style={{ color: "var(--text2)" }}>
                      Separate multiple addresses with commas
                    </p>
                  </div>
                  <div>
                    <label className="dd-label" htmlFor="email-cc">
                      CC
                    </label>
                    <input
                      id="email-cc"
                      className="dd-input"
                      type="text"
                      inputMode="email"
                      placeholder="cc1@email.com, cc2@email.com"
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                    />
                  </div>
                </div>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text2)" }}>
                  <input
                    type="checkbox"
                    checked={ccBrokerage}
                    onChange={(e) => {
                      toggleCcBrokerage(e.target.checked);
                      const brokerage = "brokerage@pastrinidad.com";
                      const others = parseEmailList(cc).filter(
                        (addr) => addr.toLowerCase() !== brokerage,
                      );
                      setCc(
                        e.target.checked
                          ? formatEmailList([brokerage, ...others])
                          : formatEmailList(others),
                      );
                    }}
                  />
                  Always CC brokerage@pastrinidad.com
                </label>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="dd-label" htmlFor="whatsapp-phone">
                        Mobile / WhatsApp numbers
                      </label>
                      <input
                        id="whatsapp-phone"
                        className="dd-input"
                        type="text"
                        inputMode="tel"
                        placeholder="868-555-1234, 868-555-9876"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        autoFocus
                      />
                      <p className="mt-1 text-[10px]" style={{ color: "var(--text2)" }}>
                        Separate multiple numbers with commas
                      </p>
                    </div>
                    {recipientEmail ? (
                      <p className="text-[11px]" style={{ color: "var(--text2)" }}>
                        ✉ Email{emailConfigured ? " will be sent to" : " on file"}:{" "}
                        <strong style={{ color: "var(--text)" }}>{recipientEmail}</strong>
                      </p>
                    ) : (
                      <p className="text-[11px]" style={{ color: "var(--amber, #b45309)" }}>
                        No consignee email — add one in Manage for automatic email with tax advice
                      </p>
                    )}
                  </div>
                )}
              </section>

              {mode === "email" && (
              <section className="dd-modal-section">
                <SectionTitle step={2} title="Subject" />
                <input
                  className="dd-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="DutyDesk — Tax Advice: …"
                />
              </section>
              )}

              {/* Message + EC75 */}
              <section className="dd-modal-section">
                <SectionTitle
                  step={mode === "email" ? 3 : 2}
                  title="Message"
                  hint="WhatsApp sends total payable, secure PDF link, and directs consignee to email for all documents"
                />

                <button
                  type="button"
                  onClick={() => toggleEc75(!ec75)}
                  className={cn(
                    "mb-3 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                    ec75 && "dd-ec75-panel",
                  )}
                  style={ec75 ? undefined : { borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <div>
                    <div className="text-xs font-semibold">Include EC75 notice</div>
                    <div className="text-[10px] opacity-80">Adds highlighted signing instructions to the email body</div>
                  </div>
                  <div
                    className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", ec75 ? "bg-[#e6c800]" : "")}
                    style={ec75 ? undefined : { background: "var(--border)" }}
                  >
                    <div
                      className={cn("h-4 w-4 rounded-full bg-white shadow transition", ec75 ? "translate-x-4" : "translate-x-0")}
                    />
                  </div>
                </button>

                {canIncludeBreakdown && (
                  <button
                    type="button"
                    onClick={() => setIncludeBreakdown(!includeBreakdown)}
                    className={cn(
                      "mb-3 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                      includeBreakdown && "border-[var(--accent)]",
                    )}
                    style={
                      includeBreakdown
                        ? { background: "var(--accent-light)", borderColor: "var(--accent)" }
                        : { borderColor: "var(--border)", background: "var(--surface)" }
                    }
                  >
                    <div>
                      <div className="text-xs font-semibold">Include tax calculation breakdown</div>
                      <div className="text-[10px] opacity-80">
                        Simple step-by-step summary (CIF, duty, VAT) as a second attachment
                      </div>
                    </div>
                    <div
                      className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", includeBreakdown ? "bg-[var(--accent)]" : "")}
                      style={includeBreakdown ? undefined : { background: "var(--border)" }}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow transition",
                          includeBreakdown ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </div>
                  </button>
                )}

                {ec75 && (
                  <div className="dd-ec75-panel mb-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed">
                    <span className="rounded px-1 font-semibold" style={{ background: "#ffe800" }}>
                      {EC75_NOTICE_TEXT}
                    </span>
                    <div className="mt-1 text-[10px] font-normal opacity-80">
                      Appears highlighted in yellow in the email message body
                    </div>
                  </div>
                )}

                <textarea
                  className="dd-input resize-y leading-relaxed"
                  rows={ec75 ? 7 : 6}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </section>

              {/* Attachments */}
              <section className="dd-modal-section">
                <SectionTitle
                  step={mode === "email" ? 4 : 3}
                  title="Attachments"
                  hint="Tax advice is emailed as PDF — email letter stays in the message body"
                />

                <div className="mb-3 space-y-2">
                  <AttachmentRow
                    icon={FileText}
                    name={taxAdvicePdfFilename}
                    detail="Tax advice — attached to email as PDF"
                    badge="PDF"
                    onDownload={() => downloadHtmlAsPdf(data.html, taxAdvicePdfFilename)}
                  />
                  {includeBreakdown && breakdownHtml && (
                    <AttachmentRow
                      icon={FileText}
                      name={breakdownPdfFilename}
                      detail="How taxes were calculated — PDF attachment"
                      badge="PDF"
                      onDownload={() => downloadHtmlAsPdf(breakdownHtml, breakdownPdfFilename, 760)}
                    />
                  )}
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xml"
                  onChange={handleFiles}
                />

                <div
                  className={cn(
                    "cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center transition",
                    dragOver && "border-[var(--accent)] bg-[var(--accent-light)]",
                  )}
                  style={{ borderColor: dragOver ? undefined : "var(--border)" }}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    addFiles(Array.from(e.dataTransfer.files));
                  }}
                >
                  <Upload size={20} className="mx-auto mb-2" style={{ color: "var(--text3)" }} />
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    Drop files here or click to browse
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text2)" }}>
                    Bill of Lading, invoices, CARICOM, EC75 — PDF, JPG, PNG, DOC, XML
                  </div>
                </div>

                {attachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {attachments.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                      >
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <Paperclip size={14} style={{ color: "var(--text2)" }} />
                          <span className="truncate">{f.name}</span>
                          <span className="shrink-0" style={{ color: "var(--text3)" }}>
                            ({(f.size / 1024).toFixed(1)} KB)
                          </span>
                        </span>
                        <button type="button" onClick={() => removeFile(f.name)} className="shrink-0 border-none bg-transparent p-1" style={{ color: "var(--text2)" }}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        {!sent && (
          <div className="dd-modal-footer">
            {mode === "email" && emailConfigured && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--green)" }}>
                <CheckCircle2 size={13} />
                Direct send enabled · Gmail{emailFrom ? ` · ${emailFrom}` : ""}
              </p>
            )}
            {mode === "email" && emailConfigured === false && (
              <p className="mb-2 text-[11px] leading-relaxed" style={{ color: "var(--text2)" }}>
                Direct send is not set up yet — use Mail App below, or connect the Google Apps Script webhook.
              </p>
            )}
            {sendError && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--red)" }}>
                <AlertCircle size={13} />
                {sendError}
              </p>
            )}
            {mode === "email" && !canSendEmail && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text2)" }}>
                <AlertCircle size={13} />
                Enter at least one valid email and a subject to send
              </p>
            )}
            {mode === "whatsapp" && !recipientPhones.length && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text2)" }}>
                <AlertCircle size={13} />
                Enter at least one WhatsApp number
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void downloadSendFiles()}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition hover:opacity-80"
                  style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                >
                  <Download size={13} />
                  Tax Advice
                </button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="text-xs" onClick={onClose}>
                  Cancel
                </Button>
                {mode === "whatsapp" ? (
                  <Button
                    disabled={sending || !recipientPhones.length}
                    onClick={sendWhatsApp}
                    className="text-xs"
                    style={{ background: "#25D366" }}
                  >
                    <MessageCircle size={14} />
                    {sending ? "Sending…" : emailConfigured && recipientEmail ? "Send Email & WhatsApp" : "Open WhatsApp"}
                  </Button>
                ) : emailConfigured ? (
                  <>
                    <Button
                      variant="ghost"
                      className="text-xs"
                      disabled={!canSendEmail || sending}
                      onClick={sendMailto}
                    >
                      Mail App
                    </Button>
                    <Button
                      disabled={!canSendEmail || sending}
                      onClick={sendDirectEmail}
                      className="text-xs"
                      style={{ background: "var(--accent)" }}
                    >
                      <Send size={14} />
                      {sending ? "Sending…" : "Send Email"}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={!canSendEmail}
                    onClick={sendMailto}
                    className="text-xs"
                    style={{ background: "var(--accent)" }}
                  >
                    <Send size={14} />
                    Open Mail Client
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function buildEmailDataFromAdvice(
  adviceHtml: string,
  opts: Omit<EmailModalData, "html" | "subject" | "toEmail" | "consigneePhone"> & {
    consigneeEmail?: string;
    consigneePhone?: string;
  },
): EmailModalData {
  return {
    html: adviceHtml,
    worksheetNum: opts.worksheetNum,
    consigneeName: opts.consigneeName,
    toEmail: opts.consigneeEmail || "",
    consigneePhone: opts.consigneePhone || "",
    subject: `${COMPANY_SHORT} — Tax Advice: ${opts.worksheetNum}${opts.consigneeName ? ` for ${opts.consigneeName}` : ""}`,
    billOfLading: opts.billOfLading,
    commodity: opts.commodity,
    totalDuty: opts.totalDuty,
    totalVAT: opts.totalVAT,
    depositFee: opts.depositFee,
    cesFee: opts.cesFee,
    userFeeAmt: opts.userFeeAmt,
    grandTotal: opts.grandTotal,
    preparedBy: opts.preparedBy,
    breakdown: opts.breakdown,
  };
}
