import { useEffect, useState } from "react";
import type { TaxBreakdownData } from "@pas/shared-types";
import { useNavigate, useSearchParams } from "react-router-dom";
import { calculateTaxes, fmtExchangeRate, fmtTTD, fmtUSD, parseExchangeRate, xrAgeWarning, cesFeeFromContainer, formatContainerCesLabel } from "@pas/tax-engine";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { exportTaxReport } from "@/lib/export/tax-report";
import { buildTaxAdviceHtml, openTaxAdvicePrint } from "@/lib/export/tax-advice-report";
import { clerkDisplayName } from "@/lib/clerk";
import { ConsigneeModal } from "@/components/consignee/ConsigneeModal";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { fmtForeign, normalizeCurrency } from "@/lib/currencies";
import { cn } from "@/lib/cn";
import { OtherChargesPanel } from "@/components/invoice/OtherChargesPanel";
import { Tooltip } from "@/components/ui/Tooltip";
import { chargesToTaxStrings, lineItemValue, otherChargesTotal, upsertChargeKind } from "@/lib/invoice-charges";
import { WorkflowProgress } from "@/components/workflow/WorkflowProgress";
import { getWorkflowStages } from "@/lib/workflow-pipeline";
import { parseEmailList, parsePhoneList } from "@/lib/contact-list";
import { SendToFlowBoardModal } from "@/components/flowboard/SendToFlowBoardModal";
import { sendTaxQuoteToFlowBoard } from "@/lib/flowboard-quotes";
import { syncTeamWorkflow } from "@/lib/workflow-sync";

function AdviceTotals({
  totalDuty,
  totalVAT,
  cesFee,
  depositFee,
  userFeeAmt,
  grandTotal,
  containerSize,
}: {
  totalDuty: number;
  totalVAT: number;
  cesFee: number;
  depositFee: number;
  userFeeAmt: number;
  grandTotal: number;
  containerSize: string;
}) {
  return (
    <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
      <div className="ml-auto grid max-w-xl grid-cols-2 gap-2">
        {[
          ["Customs Duty (ICD)", fmtTTD(totalDuty)],
          ["VAT (12.5%)", fmtTTD(totalVAT)],
          ...(cesFee > 0 ? [[`CES Fee (${containerSize})`, fmtTTD(cesFee)]] : []),
          ...(depositFee > 0 ? [["Deposit / Other Fee", fmtTTD(depositFee)]] : []),
          ...(userFeeAmt > 0 ? [["User Fee (UFC)", fmtTTD(userFeeAmt)]] : []),
        ].map(([l, v]) => (
          <div key={l as string} className="flex justify-between rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--text2)" }}>{l}</span>
            <span className="font-mono font-semibold">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-3 text-white" style={{ background: "linear-gradient(90deg, var(--accent2), #6b0000)" }}>
        <span className="text-xs font-semibold uppercase tracking-wide">Total Payable</span>
        <span className="font-mono text-2xl font-bold">{fmtTTD(grandTotal)}</span>
      </div>
    </div>
  );
}

export function TaxCalculatorPage() {
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const setInvoices = useInvoiceStore((s) => s.setInvoices);
  const exchangeRate = useInvoiceStore((s) => s.exchangeRate);
  const setExchangeRate = useInvoiceStore((s) => s.setExchangeRate);
  const itemExemptions = useInvoiceStore((s) => s.itemExemptions);
  const toggleExemption = useInvoiceStore((s) => s.toggleExemption);

  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const setTaxInputs = useWorkflowStore((s) => s.setTaxInputs);
  const consignees = useWorkflowStore((s) => s.consignees);
  const getActiveConsignee = useWorkflowStore((s) => s.getActiveConsignee);
  const addConsignee = useWorkflowStore((s) => s.addConsignee);
  const updateConsignee = useWorkflowStore((s) => s.updateConsignee);
  const removeConsignee = useWorkflowStore((s) => s.removeConsignee);
  const setActiveConsigneeId = useWorkflowStore((s) => s.setActiveConsigneeId);
  const setApprovedTaxSheet = useWorkflowStore((s) => s.setApprovedTaxSheet);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const approvedTaxSheet = useWorkflowStore((s) => s.approvedTaxSheet);

  const user = useAuthStore((s) => s.user);
  const clerkName = clerkDisplayName(user);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [taxInvId, setTaxInvId] = useState<number | null>(null);
  const [xrSaveError, setXrSaveError] = useState("");
  const [xrSaving, setXrSaving] = useState(false);
  const [showConsigneeModal, setShowConsigneeModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteSent, setQuoteSent] = useState(false);
  const [chargesTab, setChargesTab] = useState<"freight_insurance" | "other">("freight_insurance");
  const refreshTaxLog = useWorkflowStore((s) => s.refreshTaxLog);

  const activeConsignee = getActiveConsignee();

  useEffect(() => {
    api.getExchangeRate().then(setExchangeRate).catch(() => null);
  }, [setExchangeRate]);

  useEffect(() => {
    const worksheet = searchParams.get("worksheet");
    const flowboardTaskId = searchParams.get("taskId");
    if (worksheet) {
      setTaxInputs((t) => ({ ...t, worksheetNum: worksheet }));
    }
    if (flowboardTaskId) {
      sessionStorage.setItem("flowboard:taskId", flowboardTaskId);
    }
  }, [searchParams, setTaxInputs]);

  const hasInvoices = invoices.length > 0;
  const combineAll = taxInputs.combineAll && invoices.length > 1;
  const taxInv = combineAll ? null : invoices.find((i) => i.id === (taxInvId ?? activeInvId)) || invoices[0] || null;
  const activeItems = combineAll ? invoices.flatMap((inv) => inv.items) : taxInv?.items || [];
  const teamXr = exchangeRate?.rate || 6.75;
  const manualXr = parseExchangeRate(taxInputs.exchangeRate || "");
  const xr = manualXr ?? teamXr;

  const usdToTtd = xr;
  const missingCurrencyRates = invoices
    .filter((inv) => normalizeCurrency(inv.meta.currency) !== "USD")
    .filter((inv) => !parseExchangeRate(inv.meta.currencyRateToTTD || ""))
    .map((inv) => inv.meta.number || inv.filename);

  const findInvoiceForItem = (itemId: number) => invoices.find((inv) => inv.items.some((it) => it.id === itemId)) || null;

  const fxToUSDForInvoice = (invId: number): number => {
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) return 1;
    const cur = normalizeCurrency(inv.meta.currency);
    if (cur === "USD") return 1;
    const curToTtd = parseExchangeRate(inv.meta.currencyRateToTTD || "");
    if (!curToTtd) return 1;
    return curToTtd / usdToTtd; // convert foreign -> USD equivalent via TTD bridge
  };

  const calcItems = activeItems.map((it) => {
    const inv = combineAll ? findInvoiceForItem(it.id) : taxInv;
    const fx = inv ? fxToUSDForInvoice(inv.id) : 1;
    return {
      id: it.id,
      desc: it.desc,
      tariff_code: it.tariff_code,
      duty_rate: it.duty_rate,
      qty: it.qty,
      price: (lineItemValue(it) / (it.qty || 1)) * fx,
    };
  });
  const fxForSelected = taxInv ? fxToUSDForInvoice(taxInv.id) : 1;
  const calcTaxInputs =
    taxInv && !combineAll && normalizeCurrency(taxInv.meta.currency) !== "USD"
      ? {
          ...taxInputs,
          freight: String((parseFloat(taxInputs.freight || "") || 0) * fxForSelected),
          insurance: String((parseFloat(taxInputs.insurance || "") || 0) * fxForSelected),
          otherCharges: String((parseFloat(taxInputs.otherCharges || "") || 0) * fxForSelected),
        }
      : taxInputs;

  const summary = calculateTaxes(calcItems, calcTaxInputs, xr, itemExemptions);

  // Keep taxInputs charge strings in sync with selected invoice charges (when not combining)
  useEffect(() => {
    if (!taxInv || combineAll) return;
    const strings = chargesToTaxStrings(taxInv.meta.charges || []);
    setTaxInputs((t) => {
      // don't overwrite if user is actively in the process of typing something different
      if (t.freight === strings.freight && t.insurance === strings.insurance && t.otherCharges === strings.otherCharges) return t;
      return { ...t, ...strings };
    });
  }, [combineAll, setTaxInputs, taxInv?.id, taxInv?.meta.charges]);

  useEffect(() => {
    if (!combineAll) return;
    const total = invoices.reduce((s, inv) => s + otherChargesTotal(inv.meta.charges || []), 0);
    setTaxInputs((t) => ({ ...t, otherCharges: String(total || "") }));
  }, [combineAll, invoices, setTaxInputs]);

  const invoiceTotal = summary.invoiceTotal;
  const freight = parseFloat(taxInputs.freight || "") || 0;
  const insurance = parseFloat(taxInputs.insurance || "") || 0;
  const otherCharges = parseFloat(taxInputs.otherCharges || "") || 0;
  const cesFee = cesFeeFromContainer(taxInputs.containerSize, taxInputs.containerCount);
  const containerCesLabel = formatContainerCesLabel(taxInputs.containerSize, taxInputs.containerCount);
  const depositFee = parseFloat(taxInputs.depositFee || "") || 0;
  const userFeeAmt = taxInputs.userFee ? 80 : 0;
  const autoDuty = invoiceTotal > 0 ? summary.totalDuty : 0;
  const autoVAT = invoiceTotal > 0 ? summary.totalVAT : 0;
  const totalDuty = (taxInputs.manualDuty ?? "") !== "" ? parseFloat(taxInputs.manualDuty || "0") || 0 : autoDuty;
  const totalVAT = (taxInputs.manualVat ?? "") !== "" ? parseFloat(taxInputs.manualVat || "0") || 0 : autoVAT;
  const adviceGrandTotal = totalDuty + totalVAT + cesFee + depositFee + userFeeAmt;

  const worksheetNum = taxInputs.worksheetNum || taxInv?.meta.number || "";
  const commodity =
    taxInputs.commodityDesc ||
    (combineAll ? invoices.map((i) => i.meta.supplier || i.filename).join(", ") : taxInv?.meta.supplier || taxInv?.filename || "");
  const billOfLading = taxInputs.billOfLading || taxInv?.meta.number || "";

  const buildAdvice = () =>
    buildTaxAdviceHtml({
      worksheetNum,
      consignee: activeConsignee,
      billOfLading,
      commodity,
      totalDuty,
      totalVAT,
      cesFee,
      depositFee,
      userFeeAmt,
      grandTotal: adviceGrandTotal,
      xr,
      invoiceTotal,
      freight,
      insurance,
      otherCharges,
      totalsMismatch: !!(taxInv && !combineAll && taxInv.meta.totalsMismatch && !taxInv.meta.totalsReviewed),
      cifUSD: summary.cifUSD,
      cifTTD: summary.cifTTD,
      vatExempt: taxInputs.vatExempt,
      preparedBy: clerkName,
      containerCesLabel: containerCesLabel || undefined,
    });

  const buildBreakdown = (): TaxBreakdownData => ({
    worksheetNum,
    consigneeName: activeConsignee?.name || "",
    invoiceTotal,
    freight,
    insurance,
    otherCharges,
    cifUSD: summary.cifUSD,
    xr,
    cifTTD: summary.cifTTD,
    rows: summary.rows.map((row) => ({
      desc: row.desc,
      tariff_code: row.tariff_code,
      duty_rate: row.duty_rate,
      itemCIF: row.itemCIF,
      duty: row.duty,
      vat: row.vat,
      isDutyExempt: row.isDutyExempt,
      isVatExempt: row.isVatExempt,
    })),
    totalDuty,
    totalVAT,
    cesFee,
    depositFee,
    userFeeAmt,
    grandTotal: adviceGrandTotal,
    vatExempt: taxInputs.vatExempt,
    preparedBy: clerkName,
  });

  const handleSendTaxQuote = async (options?: { sentToCustomerVia?: Array<"email" | "whatsapp" | "portal"> }) => {
    setSendingQuote(true);
    setQuoteError("");
    try {
      await sendTaxQuoteToFlowBoard({
        worksheetNum: worksheetNum || `TQ-${Date.now().toString(36).toUpperCase()}`,
        consigneeName: activeConsignee?.name || "",
        billOfLading,
        commodity,
        totalDuty,
        totalVAT,
        depositFee,
        cesFee,
        userFeeAmt,
        grandTotal: adviceGrandTotal,
        sentBy: clerkName,
        worksheetHtml: buildAdvice(),
        breakdown: buildBreakdown(),
        sentToCustomerVia: options?.sentToCustomerVia,
      });
      await syncTeamWorkflow().catch(() => null);
      refreshTaxLog();
      setQuoteSent(true);
      setShowQuoteModal(false);
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "Failed to send tax quote");
    } finally {
      setSendingQuote(false);
    }
  };

  const saveTeamExchangeRate = async () => {
    setXrSaveError("");
    setXrSaving(true);
    try {
      const updated = await api.updateExchangeRate(xr, user?.name || user?.username || "DutyDesk");
      setExchangeRate(updated);
      setTaxInputs((t) => ({ ...t, exchangeRate: "" }));
    } catch (e) {
      setXrSaveError(e instanceof Error ? e.message : "Could not save team rate");
    } finally {
      setXrSaving(false);
    }
  };

  const sendToAsycuda = () => {
    setApprovedTaxSheet({
      invId: taxInv?.id ?? taxInvId,
      combineAll,
      items: summary.rows.map((r) => {
        const src = activeItems.find((i) => i.id === r.id);
        return {
          id: r.id,
          desc: r.desc,
          tariff_code: r.tariff_code,
          duty_rate: r.duty_rate,
          qty: r.qty,
          unit: src?.unit || "EA",
          price: r.price,
          itemCIF: r.itemCIF,
        };
      }),
      cifTTD: summary.cifTTD,
      cifUSD: summary.cifUSD,
      freight,
      insurance,
      xr,
      totalDuty,
      totalVat: totalVAT,
      consignee: activeConsignee,
    });
    navigate("/asycuda");
  };

  const manualPlaceholder = invoiceTotal > 0 ? undefined : "Enter amount";
  const activeInv = taxInv || invoices[0] || null;
  const stages = getWorkflowStages(activeInv, taxInputs, taxLog, approvedTaxSheet);

  return (
    <PageLayout>
      <PageHeader
        icon="🧮"
        title="Duties & Taxes"
        description={
          hasInvoices
            ? "Calculate duties here — send the finished worksheet from the Worksheet tab"
            : "Enter duty and VAT manually or upload an invoice for auto-calculation"
        }
        actions={
          <Badge tone="blue">{fmtTTD(adviceGrandTotal)} payable</Badge>
        }
      />

      <WorkflowProgress stages={stages} />

      {quoteSent && (
        <div className="dd-notif-success mb-4 text-sm">
          Tax quote sent to FlowBoard. Customer delivery is managed in FlowBoard.
        </div>
      )}

      {hasInvoices && (
        <Card className="dd-card border-none p-5 shadow-none">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold" style={{ color: "var(--accent2)" }}>
              Select Invoice(s)
            </div>
            {invoices.length > 1 && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: taxInputs.combineAll ? "var(--green)" : "var(--border)", background: taxInputs.combineAll ? "var(--green-light)" : "var(--surface)" }}>
                <input type="checkbox" checked={!!taxInputs.combineAll} onChange={(e) => setTaxInputs((t) => ({ ...t, combineAll: e.target.checked }))} />
                Combine all invoices
              </label>
            )}
          </div>
          {!taxInputs.combineAll ? (
            <select className="dd-input" value={taxInvId ?? taxInv?.id ?? ""} onChange={(e) => setTaxInvId(Number(e.target.value))}>
              {invoices.map((inv) => {
                const total = inv.items.reduce((s, i) => s + lineItemValue(i), 0);
                const cur = normalizeCurrency(inv.meta.currency);
                return (
                  <option key={inv.id} value={inv.id}>
                    {inv.meta.supplier || inv.filename}
                    {inv.meta.number ? ` #${inv.meta.number}` : ""} · {inv.items.length} items · {fmtForeign(total, cur)}
                  </option>
                );
              })}
            </select>
          ) : (
            <div className="text-xs" style={{ color: "var(--text2)" }}>
              {invoices.length} invoices combined · {fmtUSD(summary.invoiceTotal)}
            </div>
          )}

          {taxInv && !combineAll && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <Label tip="Currency printed on the supplier invoice for line items and charges">Invoice currency</Label>
                <select
                  className="dd-input"
                  value={normalizeCurrency(taxInv.meta.currency)}
                  onChange={(e) => {
                    const currency = normalizeCurrency(e.target.value);
                    setInvoices((p) =>
                      p.map((inv) =>
                        inv.id === taxInv.id ? { ...inv, meta: { ...inv.meta, currency } } : inv,
                      ),
                    );
                  }}
                >
                  {["USD", "EUR", "GBP", "CAD", "CNY", "TTD"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {normalizeCurrency(taxInv.meta.currency) !== "USD" && (
                <div className="sm:col-span-2">
                  <Label tip="How many Trinidad & Tobago dollars equal one unit of the invoice currency. Used to convert goods value to USD for tax calculation.">
                    Invoice exchange rate (1 {normalizeCurrency(taxInv.meta.currency)} = TT$)
                  </Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 7.40215"
                    value={taxInv.meta.currencyRateToTTD || ""}
                    onChange={(e) =>
                      setInvoices((p) =>
                        p.map((inv) =>
                          inv.id === taxInv.id
                            ? { ...inv, meta: { ...inv.meta, currencyRateToTTD: e.target.value } }
                            : inv,
                        ),
                      )
                    }
                  />
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text2)" }}>
                    This rate is used to convert the invoice to USD for calculation, then apply the USD→TTD Customs rate.
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="dd-card border-none p-5 shadow-none">
        <h2 className="mb-4 font-bold" style={{ color: "var(--accent2)" }}>
          🧮 Customs Tax Inputs
        </h2>
        {missingCurrencyRates.length > 0 && (
          <div className="dd-notif-warn mb-3 text-[12px]">
            Some invoices are not USD and are missing a currency rate to TT$:{" "}
            <strong>{missingCurrencyRates.join(", ")}</strong>. Please set the currency and rate on the Review tab (or
            select the invoice and set it above) before combining.
          </div>
        )}
        <div className="mb-4 flex gap-1.5 rounded-lg p-1.5" style={{ background: "var(--surface2)" }}>
          <Tooltip content="Freight and insurance costs that are added to the invoice value to calculate CIF" className="flex flex-1">
            <button
              type="button"
              onClick={() => setChargesTab("freight_insurance")}
              className={cn(
                "flex w-full flex-1 items-center justify-center gap-1.5 rounded-md border-none px-4 py-2.5 text-sm font-semibold transition",
                chargesTab === "freight_insurance" ? "dd-tab-active" : "",
              )}
              style={chargesTab === "freight_insurance" ? undefined : { color: "var(--text2)", background: "transparent" }}
            >
              Freight &amp; Insurance
            </button>
          </Tooltip>
          <Tooltip content="Sales taxes and other charges detected on the invoice — each can be included in CIF" className="flex flex-1">
            <button
              type="button"
              onClick={() => setChargesTab("other")}
              className={cn(
                "flex w-full flex-1 items-center justify-center gap-1.5 rounded-md border-none px-4 py-2.5 text-sm font-semibold transition",
                chargesTab === "other" ? "dd-tab-active" : "",
              )}
              style={chargesTab === "other" ? undefined : { color: "var(--text2)", background: "transparent" }}
            >
              Other Charges
            </button>
          </Tooltip>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {invoiceTotal > 0 && (
            <div className="col-span-full rounded-lg border px-4 py-3" style={{ borderColor: "var(--accent)", background: "var(--accent-light)" }}>
              <Label tip="Sum of all line items from the loaded invoice(s), converted to USD when needed">Invoice Total (Auto)</Label>
              {taxInv && !combineAll && normalizeCurrency(taxInv.meta.currency) !== "USD" ? (
                <div className="space-y-0.5">
                  <div className="font-mono text-lg font-semibold">
                    {fmtForeign(
                      taxInv.items.reduce((s, i) => s + lineItemValue(i), 0),
                      normalizeCurrency(taxInv.meta.currency),
                    )}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text2)" }}>
                    Converted for calculation: <strong>{fmtUSD(invoiceTotal)}</strong>
                  </div>
                </div>
              ) : (
                <div className="font-mono text-lg font-semibold">{fmtUSD(invoiceTotal)}</div>
              )}
            </div>
          )}
          {chargesTab === "freight_insurance" ? (
            <>
              <div>
                <Label tip="International shipping cost added to the customs value (CIF)">Freight Cost ({taxInv && !combineAll ? normalizeCurrency(taxInv.meta.currency) : "USD"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 350.00"
                  value={taxInputs.freight}
                  onChange={(e) => {
                    setTaxInputs((t) => ({ ...t, freight: e.target.value }));
                    if (taxInv && !combineAll) {
                      const amt = parseFloat(e.target.value || "0") || 0;
                      setInvoices((p) =>
                        p.map((inv) =>
                          inv.id === taxInv.id
                            ? {
                                ...inv,
                                meta: {
                                  ...inv.meta,
                                  charges: upsertChargeKind(inv.meta.charges || [], "freight", amt),
                                },
                              }
                            : inv,
                        ),
                      );
                    }
                  }}
                />
              </div>
              <div>
                <Label tip="Marine/air cargo insurance added to CIF">Insurance ({taxInv && !combineAll ? normalizeCurrency(taxInv.meta.currency) : "USD"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 25.00"
                  value={taxInputs.insurance}
                  onChange={(e) => {
                    setTaxInputs((t) => ({ ...t, insurance: e.target.value }));
                    if (taxInv && !combineAll) {
                      const amt = parseFloat(e.target.value || "0") || 0;
                      setInvoices((p) =>
                        p.map((inv) =>
                          inv.id === taxInv.id
                            ? {
                                ...inv,
                                meta: {
                                  ...inv.meta,
                                  charges: upsertChargeKind(inv.meta.charges || [], "insurance", amt),
                                },
                              }
                            : inv,
                        ),
                      );
                    }
                  }}
                />
              </div>
              <div>
                <Label tip="Sales tax and other invoice charges included in the customs value. Use the Other Charges tab for itemized entry.">
                  Sales tax + other charges ({taxInv && !combineAll ? normalizeCurrency(taxInv.meta.currency) : "USD"})
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 42.15"
                  value={taxInputs.otherCharges}
                  onChange={(e) => setTaxInputs((t) => ({ ...t, otherCharges: e.target.value }))} 
                />
                <p className="mt-1 text-[11px]" style={{ color: "var(--text2)" }}>
                  For itemized management (per-invoice), use the <strong>Other Charges</strong> tab above.
                </p>
              </div>
            </>
          ) : (
            <OtherChargesPanel
              invoice={taxInv}
              combineAll={combineAll}
              invoices={invoices}
              onUpdateInvoice={(invId, charges) => {
                setInvoices((p) =>
                  p.map((inv) => (inv.id === invId ? { ...inv, meta: { ...inv.meta, charges } } : inv)),
                );
                if (!combineAll && taxInv && invId === taxInv.id) {
                  const strings = chargesToTaxStrings(charges);
                  setTaxInputs((t) => ({ ...t, ...strings }));
                }
                if (combineAll) {
                  const total = invoices.reduce((s, inv) => s + otherChargesTotal(inv.meta.charges || []), 0);
                  setTaxInputs((t) => ({ ...t, otherCharges: String(total || "") }));
                }
              }}
              onTaxInputsChange={(v) => setTaxInputs((t) => ({ ...t, otherCharges: v }))}
            />
          )}
          <div className={`rounded-lg border p-4 ${xrAgeWarning(exchangeRate?.updated_at) && !manualXr ? "border-amber-400" : ""}`} style={{ borderColor: xrAgeWarning(exchangeRate?.updated_at) && !manualXr ? undefined : "var(--border)", background: "var(--surface2)" }}>
            <Label htmlFor="exchange-rate" tip="Customs Division rate: how many TT dollars equal 1 US dollar. Leave blank to use the team default.">
              Exchange Rate (1 USD = TTD)
            </Label>
            <Input
              id="exchange-rate"
              className="mt-1 max-w-[200px] font-mono text-base"
              type="text"
              inputMode="decimal"
              placeholder={fmtExchangeRate(teamXr)}
              value={taxInputs.exchangeRate}
              onChange={(e) => {
                setXrSaveError("");
                setTaxInputs((t) => ({ ...t, exchangeRate: e.target.value }));
              }}
            />
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--text2)" }}>
              Up to 5 decimal places (e.g. 6.77387).{" "}
              {manualXr
                ? `Using TT$${fmtExchangeRate(manualXr)} for this worksheet.`
                : `Team default: TT$${fmtExchangeRate(teamXr)}${exchangeRate?.updated_by ? ` (set by ${exchangeRate.updated_by})` : ""}`}
            </p>
            {xrAgeWarning(exchangeRate?.updated_at) && !manualXr && (
              <p className="mt-1 text-[11px] text-amber-700">Rate may be outdated — enter the current Customs Division rate above.</p>
            )}
            {manualXr && Math.abs(manualXr - teamXr) > 1 / 10 ** 5 && (
              <Button
                variant="secondary"
                className="mt-2 text-[11px]"
                disabled={xrSaving}
                onClick={saveTeamExchangeRate}
              >
                {xrSaving ? "Saving…" : "Save as team default"}
              </Button>
            )}
            {xrSaveError && <p className="mt-1 text-[11px] text-red-600">{xrSaveError}</p>}
          </div>
          <div className={taxInputs.containerSize === "none" ? "" : "sm:col-span-2"}>
            <Label tip="Container Examination System fee charged by Customs for physical exam of each container">Container Size</Label>
            <div className={cn("grid gap-2", taxInputs.containerSize !== "none" && "grid-cols-1 sm:grid-cols-[1fr_7rem]")}>
              <select
                className="dd-input"
                value={taxInputs.containerSize}
                onChange={(e) => {
                  const containerSize = e.target.value as typeof taxInputs.containerSize;
                  setTaxInputs((t) => ({
                    ...t,
                    containerSize,
                    containerCount: containerSize === "none" ? 1 : t.containerCount || 1,
                  }));
                }}
              >
                <option value="none">No Container Fee</option>
                <option value="20ft">20ft — TT$750 each</option>
                <option value="40ft">40ft — TT$1,050 each</option>
              </select>
              {taxInputs.containerSize !== "none" && (
                <div>
                  <Label tip="Number of containers at this size — CES fee is multiplied">Qty</Label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    className="dd-input"
                    value={taxInputs.containerCount ?? 1}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      setTaxInputs((t) => ({
                        ...t,
                        containerCount: Number.isFinite(raw) ? Math.min(99, Math.max(1, raw)) : 1,
                      }));
                    }}
                  />
                </div>
              )}
            </div>
            {taxInputs.containerSize !== "none" && cesFee > 0 && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--text2)" }}>
                CES total: <strong style={{ color: "var(--text)" }}>{fmtTTD(cesFee)}</strong>
                {" "}
                ({containerCesLabel} × {fmtTTD(cesFee / Math.max(1, taxInputs.containerCount ?? 1))})
              </p>
            )}
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!taxInputs.userFee} onChange={(e) => setTaxInputs((t) => ({ ...t, userFee: e.target.checked }))} />
              User Fee (TT$80)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!taxInputs.vatExempt} onChange={(e) => setTaxInputs((t) => ({ ...t, vatExempt: e.target.checked }))} />
              All VAT Exempt
            </label>
          </div>
        </div>
        {summary.cifUSD > 0 && (
          <div className="mt-4 flex flex-wrap gap-6 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
            <span>Invoice Total: <strong>{fmtUSD(invoiceTotal)}</strong></span>
            <span>CIF (USD): <strong>{fmtUSD(summary.cifUSD)}</strong></span>
            <span>Rate: <strong>1 USD = TT${fmtExchangeRate(xr)}</strong></span>
            <span>CIF (TTD): <strong style={{ color: "var(--green)" }}>{fmtTTD(summary.cifTTD)}</strong></span>
          </div>
        )}
      </Card>

      {invoiceTotal > 0 && summary.rows.length > 0 && (
        <Card className="dd-card overflow-hidden border-none shadow-none">
          <CardHeader>
            <span className="font-bold">Tax Breakdown by Item</span>
            <Badge tone="blue">{summary.rows.length} items</Badge>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-xs">
              <thead>
                <tr>
                  {["#", "Description", "Tariff Code", "Duty Rate", "Value (USD)", "CIF (TTD)", "Duty (TTD)", "VAT (TTD)", "Exemptions", "Total Tax"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((it, idx) => (
                  <tr key={it.id}>
                    <td>{idx + 1}</td>
                    <td className="max-w-[200px]">{it.desc}</td>
                    <td className="font-mono text-[11px]">{it.tariff_code || "—"}</td>
                    <td>{it.isDutyExempt ? "Free" : it.duty_rate || "—"}</td>
                    <td className="font-mono">{fmtUSD(it.itemVal)}</td>
                    <td className="font-mono">{fmtTTD(it.itemCIF)}</td>
                    <td className="font-mono">{it.isDutyExempt ? "—" : fmtTTD(it.duty)}</td>
                    <td className="font-mono">{it.isVatExempt ? "—" : fmtTTD(it.vat)}</td>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        {[
                          ["dutyExempt", "Duty"],
                          ["vatExempt", "VAT"],
                        ].map(([field, label]) => (
                          <label key={field} className="flex cursor-pointer items-center gap-1 text-[10px]">
                            <input type="checkbox" checked={!!itemExemptions[it.id]?.[field as "dutyExempt" | "vatExempt"]} onChange={() => toggleExemption(it.id, field as "dutyExempt" | "vatExempt")} />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="text-right font-mono font-bold">{fmtTTD(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdviceTotals totalDuty={totalDuty} totalVAT={totalVAT} cesFee={cesFee} depositFee={depositFee} userFeeAmt={userFeeAmt} grandTotal={adviceGrandTotal} containerSize={containerCesLabel || taxInputs.containerSize} />
        </Card>
      )}

      {!hasInvoices && (
        <div className="dd-notif-info flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">No invoice loaded</div>
            <div className="text-xs" style={{ color: "var(--text2)" }}>
              Fill in duty &amp; VAT manually below, or upload an invoice for auto-calculation.
            </div>
          </div>
          <Button onClick={() => navigate("/upload")} style={{ background: "var(--accent2)" }}>
            Upload Invoice →
          </Button>
        </div>
      )}

      <Card className="dd-card border-none p-5 shadow-none">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide">📋 Worksheet details</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="dd-label">Worksheet #</label>
            <input className="dd-input" placeholder="e.g. MIM363" value={taxInputs.worksheetNum || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, worksheetNum: e.target.value }))} />
          </div>
          <div>
            <label className="dd-label">Bill of Lading / AWB</label>
            <input className="dd-input" placeholder="e.g. PAS-O-1741747" value={taxInputs.billOfLading || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, billOfLading: e.target.value }))} />
          </div>
          <div>
            <label className="dd-label">Commodity Description</label>
            <input className="dd-input" placeholder="e.g. 39 PCS - AUTOMOTIVE SUPPLIES" value={taxInputs.commodityDesc || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, commodityDesc: e.target.value }))} />
          </div>
          <div>
            <label className="dd-label">Deposit / Other Fee (TTD)</label>
            <input className="dd-input" type="number" placeholder="e.g. 435.31" value={taxInputs.depositFee || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, depositFee: e.target.value }))} />
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="dd-label mb-0">Consignee</label>
            <button type="button" onClick={() => setShowConsigneeModal(true)} className="rounded-md border px-2.5 py-0.5 text-[11px] font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-light)" }}>
              👥 Manage
            </button>
          </div>
          {activeConsignee ? (
            <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
              <strong style={{ color: "var(--text)" }}>{activeConsignee.name}</strong>
              {activeConsignee.code && <span className="ml-2 font-mono text-[10px]" style={{ color: "var(--accent)" }}>{activeConsignee.code}</span>}
              {parseEmailList(activeConsignee.email).map((email) => (
                <div key={email} className="mt-1">✉ {email}</div>
              ))}
              {parsePhoneList(activeConsignee.phone).map((phone) => (
                <div key={phone} className="mt-0.5">📱 {phone}</div>
              ))}
              {activeConsignee.address && <div className="mt-1 whitespace-pre-line">{activeConsignee.address}</div>}
            </div>
          ) : (
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
              {consignees.length === 0 ? "No consignees saved yet — click Manage to add one" : "No consignee selected"}
            </div>
          )}
        </div>
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 text-[11px] font-semibold" style={{ color: "var(--text2)" }}>
            {invoiceTotal > 0 ? "Override Tax Values (leave blank to auto-calculate)" : "Manual Tax Values"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="dd-label">Import Duty / ICD (TTD)</label>
              <input className="dd-input" type="number" placeholder={manualPlaceholder ?? fmtTTD(autoDuty)} value={taxInputs.manualDuty || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, manualDuty: e.target.value }))} />
            </div>
            <div>
              <label className="dd-label">VAT (TTD)</label>
              <input className="dd-input" type="number" placeholder={manualPlaceholder ?? fmtTTD(autoVAT)} value={taxInputs.manualVat || ""} onChange={(e) => setTaxInputs((t) => ({ ...t, manualVat: e.target.value }))} />
            </div>
          </div>
        </div>
      </Card>

      {invoiceTotal === 0 && (
        <Card className="dd-card overflow-hidden border-none shadow-none">
          <CardHeader>
            <span className="font-bold">Manual Tax Advice Summary</span>
          </CardHeader>
          <AdviceTotals totalDuty={totalDuty} totalVAT={totalVAT} cesFee={cesFee} depositFee={depositFee} userFeeAmt={userFeeAmt} grandTotal={adviceGrandTotal} containerSize={containerCesLabel || taxInputs.containerSize} />
        </Card>
      )}

      <Card className="dd-card dd-sticky-actions border-none shadow-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
              Duties &amp; taxes
            </div>
            <div className="mt-0.5 text-[13px] font-semibold" style={{ color: "var(--text)" }}>
              Total payable: <span className="font-mono" style={{ color: "var(--green)" }}>{fmtTTD(adviceGrandTotal)}</span>
              {worksheetNum && (
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--text2)" }}>
                  · {worksheetNum}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
              Prepare and preview here. Manual customer send happens once on Worksheet → Complete Job.
              Use FlowBoard only for an early tax quote handoff.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {invoiceTotal > 0 && (
              <Button variant="secondary" className="text-xs" onClick={() => exportTaxReport(summary, { combineAll, invoices, taxInv, taxInputs, exchangeRate: xr, preparedBy: clerkName })}>
                Itemized Report
              </Button>
            )}
            <Button variant="green" className="text-xs" onClick={() => openTaxAdvicePrint(buildAdvice())}>
              Preview PDF
            </Button>
            <Button
              variant="secondary"
              className="text-xs"
              onClick={() => setShowQuoteModal(true)}
              disabled={adviceGrandTotal <= 0}
            >
              Send Tax Quote to FlowBoard
            </Button>
            <Button className="text-xs" style={{ background: "var(--accent2)" }} onClick={() => navigate("/worksheet")}>
              Continue to Worksheet →
            </Button>
            <Button className="text-xs" style={{ background: "#1B4F8A" }} onClick={sendToAsycuda}>
              Send to ASYCUDA →
            </Button>
          </div>
        </div>
      </Card>

      {showConsigneeModal && (
        <ConsigneeModal
          consignees={consignees}
          activeConsignee={activeConsignee}
          onAdd={addConsignee}
          onUpdate={updateConsignee}
          onRemove={removeConsignee}
          onSelect={(c) => setActiveConsigneeId(c.id)}
          onClose={() => setShowConsigneeModal(false)}
        />
      )}

      <SendToFlowBoardModal
        open={showQuoteModal}
        sending={sendingQuote}
        error={quoteError}
        title="Send Tax Quote to FlowBoard?"
        message="This sends an early duties estimate to FlowBoard for quote tracking. It is not the final worksheet send — complete the customer worksheet from Worksheet → Complete Job."
        confirmLabel="Send Tax Quote to FlowBoard"
        onCancel={() => {
          setShowQuoteModal(false);
          setQuoteError("");
        }}
        onConfirm={handleSendTaxQuote}
      />
    </PageLayout>
  );
}
