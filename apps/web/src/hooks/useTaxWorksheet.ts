import type { TaxBreakdownData } from "@pas/shared-types";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  calculateTaxes,
  cesFeeFromContainer,
  formatContainerCesLabel,
  parseExchangeRate,
} from "@pas/tax-engine";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { chargesToTaxStrings, lineItemValue, otherChargesTotal } from "@/lib/invoice-charges";
import { normalizeCurrency } from "@/lib/currencies";
import { buildTaxAdviceHtml } from "@/lib/export/tax-advice-report";
import { setFlowBoardContext } from "@/lib/flowboard-client";

export function useTaxWorksheet(clerkName: string) {
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const exchangeRate = useInvoiceStore((s) => s.exchangeRate);
  const itemExemptions = useInvoiceStore((s) => s.itemExemptions);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const setTaxInputs = useWorkflowStore((s) => s.setTaxInputs);
  const getActiveConsignee = useWorkflowStore((s) => s.getActiveConsignee);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const worksheet = searchParams.get("worksheet");
    const flowboardTaskId = searchParams.get("taskId");
    const projectId = searchParams.get("projectId");
    if (worksheet) setTaxInputs((t) => ({ ...t, worksheetNum: worksheet }));
    if (flowboardTaskId) setFlowBoardContext(flowboardTaskId, projectId || undefined);
  }, [searchParams, setTaxInputs]);

  const activeConsignee = getActiveConsignee();
  const combineAll = taxInputs.combineAll && invoices.length > 1;
  const taxInv = combineAll
    ? null
    : invoices.find((i) => i.id === activeInvId) || invoices[0] || null;
  const activeItems = combineAll ? invoices.flatMap((inv) => inv.items) : taxInv?.items || [];
  const teamXr = exchangeRate?.rate || 6.75;
  const manualXr = parseExchangeRate(taxInputs.exchangeRate || "");
  const xr = manualXr ?? teamXr;

  const findInvoiceForItem = (itemId: number) =>
    invoices.find((inv) => inv.items.some((it) => it.id === itemId)) || null;

  const fxToUSDForInvoice = (invId: number): number => {
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) return 1;
    const cur = normalizeCurrency(inv.meta.currency);
    if (cur === "USD") return 1;
    const curToTtd = parseExchangeRate(inv.meta.currencyRateToTTD || "");
    if (!curToTtd) return 1;
    return curToTtd / xr;
  };

  const calcItems = activeItems.map((it) => {
    const inv = combineAll ? findInvoiceForItem(it.id) : taxInv;
    const fx = inv ? fxToUSDForInvoice(inv.id) : 1;
    return {
      id: it.id,
      desc: it.desc,
      tariff_code: it.tariff_code,
      duty_rate: it.duty_rate,
      vat_rate: it.vat_rate,
      levy_rate: it.levy_rate,
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

  const summary = useMemo(
    () => calculateTaxes(calcItems, calcTaxInputs, xr, itemExemptions),
    [calcItems, calcTaxInputs, xr, itemExemptions],
  );

  useEffect(() => {
    if (!taxInv || combineAll) return;
    const strings = chargesToTaxStrings(taxInv.meta.charges || []);
    setTaxInputs((t) => {
      if (
        t.freight === strings.freight &&
        t.insurance === strings.insurance &&
        t.otherCharges === strings.otherCharges
      ) {
        return t;
      }
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
  const totalDuty =
    (taxInputs.manualDuty ?? "") !== "" ? parseFloat(taxInputs.manualDuty || "0") || 0 : autoDuty;
  const totalVAT =
    (taxInputs.manualVat ?? "") !== "" ? parseFloat(taxInputs.manualVat || "0") || 0 : autoVAT;
  const adviceGrandTotal = totalDuty + totalVAT + cesFee + depositFee + userFeeAmt;

  const worksheetNum = taxInputs.worksheetNum || taxInv?.meta.number || "";
  const commodity =
    taxInputs.commodityDesc ||
    (combineAll
      ? invoices.map((i) => i.meta.supplier || i.filename).join(", ")
      : taxInv?.meta.supplier || taxInv?.filename || "");
  const billOfLading = taxInputs.billOfLading || taxInv?.meta.number || "";
  const supplierName = taxInv?.meta.supplier || invoices[0]?.meta.supplier || "";
  const invoiceNumber = taxInv?.meta.number || invoices[0]?.meta.number || "";

  const adviceData = useMemo(
    () => ({
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
    }),
    [
      worksheetNum,
      activeConsignee,
      billOfLading,
      commodity,
      totalDuty,
      totalVAT,
      cesFee,
      depositFee,
      userFeeAmt,
      adviceGrandTotal,
      xr,
      invoiceTotal,
      freight,
      insurance,
      otherCharges,
      taxInv,
      combineAll,
      summary.cifUSD,
      summary.cifTTD,
      taxInputs.vatExempt,
      clerkName,
      containerCesLabel,
    ],
  );

  const buildAdvice = () => buildTaxAdviceHtml(adviceData);

  const breakdownData = useMemo(
    (): TaxBreakdownData => ({
      worksheetNum,
      consigneeName: activeConsignee?.name || "",
      supplierName,
      invoiceNumber,
      shipmentReference: billOfLading,
      currency: taxInv?.meta.currency || (combineAll ? "USD" : invoices[0]?.meta.currency),
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
    }),
    [
      worksheetNum,
      activeConsignee?.name,
      supplierName,
      invoiceNumber,
      billOfLading,
      taxInv?.meta.currency,
      combineAll,
      invoices,
      invoiceTotal,
      freight,
      insurance,
      otherCharges,
      summary.cifUSD,
      summary.cifTTD,
      summary.rows,
      totalDuty,
      totalVAT,
      cesFee,
      depositFee,
      userFeeAmt,
      adviceGrandTotal,
      taxInputs.vatExempt,
      clerkName,
      xr,
    ],
  );

  const buildBreakdown = () => breakdownData;

  return {
    invoices,
    taxInv,
    combineAll,
    activeItems,
    activeConsignee,
    taxInputs,
    setTaxInputs,
    summary,
    invoiceTotal,
    freight,
    insurance,
    otherCharges,
    cesFee,
    containerCesLabel,
    depositFee,
    userFeeAmt,
    totalDuty,
    totalVAT,
    adviceGrandTotal,
    worksheetNum,
    commodity,
    billOfLading,
    supplierName,
    invoiceNumber,
    xr,
    buildAdvice,
    adviceData,
    buildBreakdown,
    breakdownData,
  };
}
