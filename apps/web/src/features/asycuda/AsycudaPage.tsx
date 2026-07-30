import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Invoice } from "@pas/shared-types";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  blankAsycudaHeader,
  blankAsycudaItem,
  downloadAsycudaXml,
  prorateAsycudaItems,
  type AsycudaHeader,
  type AsycudaItem,
} from "@/lib/asycuda";
import { fmtTTD } from "@pas/tax-engine";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="dd-card mb-4 p-4">
      <div className="mb-3 flex items-center gap-2 border-b pb-2 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
        <span>{emoji}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function LabelInput({
  label,
  value,
  onChange,
  type = "text",
  mono,
  tall,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  tall?: boolean;
}) {
  const cls = `dd-input ${mono ? "font-mono" : ""} ${tall ? "h-[70px] resize-y" : ""}`;
  return (
    <div className="mb-3">
      <label className="dd-label">{label}</label>
      {tall ? (
        <textarea className={cls} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function AsycudaPage() {
  const navigate = useNavigate();
  const invoices = useInvoiceStore((s) => s.invoices);
  const approvedTaxSheet = useWorkflowStore((s) => s.approvedTaxSheet);
  const getActiveConsignee = useWorkflowStore((s) => s.getActiveConsignee);

  const [header, setHeader] = useState<AsycudaHeader>(blankAsycudaHeader);
  const [items, setItems] = useState<AsycudaItem[]>([blankAsycudaItem()]);
  const [sourceInvId, setSourceInvId] = useState("");
  const [generated, setGenerated] = useState(false);

  const setH = (k: keyof AsycudaHeader, v: string) => setHeader((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, k: keyof AsycudaItem, v: string) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const loadFromInvoice = (inv: Invoice) => {
    setH("exporterName", inv.meta.supplier || "");
    setH("referenceNumber", inv.meta.number ? `C4PAS-${inv.meta.number}` : "");
    setH("supplierInvoiceNbr", inv.meta.number || "");
    setH("supplierInvoiceDate", inv.meta.date || "0/0/00");
    setItems(inv.items.map((it) => blankAsycudaItem(it.desc, it.tariff_code || "")));
    setSourceInvId(String(inv.id));
  };

  const loadFromTaxSheet = () => {
    if (!approvedTaxSheet) return;
    const inv = invoices.find((i) => i.id === approvedTaxSheet.invId) || invoices[0];
    if (inv) {
      setH("exporterName", inv.meta.supplier || "");
      setH("referenceNumber", inv.meta.number ? `C4PAS-${inv.meta.number}` : "");
      setH("supplierInvoiceNbr", inv.meta.number || "");
      setH("supplierInvoiceDate", inv.meta.date || "0/0/00");
    }
    setH("currencyCode", "TTD");
    setH("currencyName", "No foreign currency");
    setH("currencyRate", "1.00");
    const mapped = approvedTaxSheet.items.map((it) => ({
      ...blankAsycudaItem(it.desc, it.tariff_code || ""),
      cif: it.itemCIF ? it.itemCIF.toFixed(2) : "0.00",
      originCode: it.originCode || "CN",
      suppUnitCode:
        it.unit && !["EA", "ea"].includes(it.unit)
          ? ["PR", "PAIR", "PRS"].includes((it.unit || "").toUpperCase())
            ? "NPR"
            : "NMB"
          : "",
      suppUnitName:
        it.unit && !["EA", "ea"].includes(it.unit)
          ? ["PR", "PAIR", "PRS"].includes((it.unit || "").toUpperCase())
            ? "Number of Pairs"
            : "Number of Articles"
          : "",
      suppQty: it.qty ? String(Math.round(it.qty)) : "0",
    }));
    setItems(mapped.length > 0 ? mapped : [blankAsycudaItem()]);
    setSourceInvId(String(approvedTaxSheet.invId || ""));
    const c = approvedTaxSheet.consignee || getActiveConsignee();
    if (c) {
      setH("consigneeCode", c.code || "");
      setH("consigneeName", c.name + (c.address ? `\n${c.address}` : ""));
    }
  };

  useEffect(() => {
    const c = approvedTaxSheet?.consignee || getActiveConsignee();
    if (c) {
      setH("consigneeCode", c.code || "");
      setH("consigneeName", c.name + (c.address ? `\n${c.address}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedTaxSheet]);

  useEffect(() => {
    if (approvedTaxSheet) loadFromTaxSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCif = items.reduce((s, it) => s + (parseFloat(it.cif) || 0), 0);

  return (
    <PageLayout>
      <PageHeader
        icon="🛃"
        title="ASYCUDA XML Generator"
        description="Generate ASYCUDA World-compatible XML for T&T Customs"
        actions={
          <div className="flex flex-wrap gap-2">
          {approvedTaxSheet && (
            <button type="button" onClick={loadFromTaxSheet} className="rounded-[10px] border-none px-3.5 py-2 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>
              Load Approved Worksheet
            </button>
          )}
          {invoices.length > 0 && (
            <select
              className="dd-input w-auto min-w-[180px] text-xs"
              value={sourceInvId}
              onChange={(e) => {
                const inv = invoices.find((i) => String(i.id) === e.target.value);
                if (inv) loadFromInvoice(inv);
                else setSourceInvId("");
              }}
            >
              <option value="">⬇ Load from invoice…</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.meta.supplier || inv.filename} ({inv.items.length} items)
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => {
              downloadAsycudaXml(header, items);
              setGenerated(true);
            }}
            className="rounded-[10px] border-none px-4 py-2 text-[13px] font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            Download XML
          </button>
          </div>
        }
      />

      {approvedTaxSheet && sourceInvId === String(approvedTaxSheet.invId || "") && (
        <div className="dd-notif-info mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <div>
            <strong>✓ Loaded from approved tax worksheet</strong>
            <span className="ml-3 text-xs" style={{ color: "var(--text2)" }}>
              Total CIF: <strong>{fmtTTD(approvedTaxSheet.cifTTD)}</strong> · Duty: <strong>{fmtTTD(approvedTaxSheet.totalDuty)}</strong> · VAT:{" "}
              <strong>{fmtTTD(approvedTaxSheet.totalVat)}</strong>
            </span>
          </div>
        </div>
      )}

      {generated && <div className="dd-notif-warn mb-3 text-[13px] font-medium" style={{ color: "var(--green)" }}>✓ XML downloaded — ready to import into ASYCUDA World</div>}

      {!invoices.length && !approvedTaxSheet && (
        <div className="dd-notif-info mb-4">
          No invoice loaded.{" "}
          <button type="button" className="font-semibold underline" style={{ color: "var(--accent)" }} onClick={() => navigate("/upload")}>
            Upload an invoice
          </button>{" "}
          or approve a worksheet from the Tax Calculator.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Section title="Declaration Header" emoji="📋">
            <div className="grid gap-0 sm:grid-cols-2 sm:gap-x-4">
              <LabelInput label="Office Code" value={header.officeCode} onChange={(v) => setH("officeCode", v)} />
              <LabelInput label="Office Name" value={header.officeName} onChange={(v) => setH("officeName", v)} />
              <LabelInput label="Declaration Type" value={header.declarationType} onChange={(v) => setH("declarationType", v)} />
              <LabelInput label="Procedure Code" value={header.procedureCode} onChange={(v) => setH("procedureCode", v)} />
              <LabelInput label="Reference Number" value={header.referenceNumber} onChange={(v) => setH("referenceNumber", v)} mono />
              <LabelInput label="Summary Declaration No." value={header.summaryDecl} onChange={(v) => setH("summaryDecl", v)} mono />
            </div>
          </Section>
          <Section title="Exporter / Supplier" emoji="🏭">
            <LabelInput label="Exporter Name" value={header.exporterName} onChange={(v) => setH("exporterName", v)} />
            <div className="grid gap-0 sm:grid-cols-2 sm:gap-x-4">
              <LabelInput label="Export Country Code" value={header.exportCountryCode} onChange={(v) => setH("exportCountryCode", v)} />
              <LabelInput label="Export Country Name" value={header.exportCountryName} onChange={(v) => setH("exportCountryName", v)} />
              <LabelInput label="Supplier Invoice No." value={header.supplierInvoiceNbr} onChange={(v) => setH("supplierInvoiceNbr", v)} mono />
              <LabelInput label="Supplier Invoice Date" value={header.supplierInvoiceDate} onChange={(v) => setH("supplierInvoiceDate", v)} />
            </div>
          </Section>
          <Section title="Consignee" emoji="📦">
            <LabelInput label="Consignee Code" value={header.consigneeCode} onChange={(v) => setH("consigneeCode", v)} mono />
            <LabelInput label="Consignee Name / Address" value={header.consigneeName} onChange={(v) => setH("consigneeName", v)} tall />
          </Section>
        </div>
        <div>
          <Section title="Transport" emoji="🚢">
            <div className="grid gap-0 sm:grid-cols-2 sm:gap-x-4">
              <LabelInput label="Vessel / Aircraft Name" value={header.vesselName} onChange={(v) => setH("vesselName", v)} />
              <LabelInput label="Vessel Nationality" value={header.vesselNat} onChange={(v) => setH("vesselNat", v)} />
              <LabelInput label="Transport Mode" value={header.transportMode} onChange={(v) => setH("transportMode", v)} />
              <LabelInput label="INCOTERM" value={header.incoterm} onChange={(v) => setH("incoterm", v)} />
              <LabelInput label="Border Office Code" value={header.borderOfficeCode} onChange={(v) => setH("borderOfficeCode", v)} mono />
              <LabelInput label="Border Office Name" value={header.borderOfficeName} onChange={(v) => setH("borderOfficeName", v)} />
            </div>
          </Section>
          <Section title="Financial & Packages" emoji="💰">
            <div className="grid gap-0 sm:grid-cols-2 sm:gap-x-4">
              <LabelInput label="Currency Code" value={header.currencyCode} onChange={(v) => setH("currencyCode", v)} mono />
              <LabelInput label="Currency Rate" value={header.currencyRate} onChange={(v) => setH("currencyRate", v)} type="number" />
              <LabelInput label="Total Packages" value={header.totalPackages} onChange={(v) => setH("totalPackages", v)} type="number" />
              <LabelInput label="Package Kind" value={header.pkgKind} onChange={(v) => setH("pkgKind", v)} />
            </div>
            <LabelInput label="Total Gross Weight (kg)" value={header.totalGrossWeight} onChange={(v) => setH("totalGrossWeight", v)} type="number" />
          </Section>
        </div>
      </div>

      <div className="dd-card p-4">
        <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
          <span className="text-xs font-bold">📋 Line Items ({items.length})</span>
          <button type="button" onClick={() => setItems((p) => [...p, blankAsycudaItem()])} className="rounded-lg border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-light)" }}>
            + Add Item
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-xs">
            <thead>
              <tr style={{ background: "#0d1420", color: "#fff" }}>
                {["#", "Description", "HS Code", "CIF (TTD)", "Gross kg", "Net kg", "Origin", ""].map((h) => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-bold uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const prorated = prorateAsycudaItems(header, items);
                const grossPh = prorated[i]?.grossWeight;
                const netPh = prorated[i]?.netWeight;
                return (
                  <tr key={i} style={{ background: i % 2 ? "var(--surface2)" : "transparent" }}>
                    <td className="px-2 py-1 text-center" style={{ color: "var(--text2)" }}>
                      {i + 1}
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input text-xs" value={it.desc} onChange={(e) => setItem(i, "desc", e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input font-mono text-[11px]" value={it.tariff_code} onChange={(e) => setItem(i, "tariff_code", e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input w-20 text-xs" type="number" value={it.cif} onChange={(e) => setItem(i, "cif", e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input w-16 text-xs" type="number" placeholder={grossPh} value={it.grossWeight} onChange={(e) => setItem(i, "grossWeight", e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input w-16 text-xs" type="number" placeholder={netPh} value={it.netWeight} onChange={(e) => setItem(i, "netWeight", e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input className="dd-input w-12 font-mono text-xs" value={it.originCode} onChange={(e) => setItem(i, "originCode", e.target.value)} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {items.length > 1 && (
                        <button type="button" className="border-none bg-transparent text-sm" style={{ color: "var(--text3)" }} onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-6 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
          <span>
            Items: <strong>{items.length}</strong>
          </span>
          <span>
            Total CIF: <strong>{fmtTTD(totalCif)}</strong>
          </span>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setHeader(blankAsycudaHeader());
            setItems([blankAsycudaItem()]);
            setGenerated(false);
            setSourceInvId("");
          }}
          className="rounded-[10px] border px-4 py-2 text-[13px]"
          style={{ borderColor: "var(--border)", color: "var(--text2)" }}
        >
          🗑 Reset
        </button>
        <button
          type="button"
          onClick={() => {
            downloadAsycudaXml(header, items);
            setGenerated(true);
          }}
          className="rounded-[10px] border-none px-5 py-2 text-[13px] font-semibold text-white"
          style={{ background: "#1B4F8A" }}
        >
          ⬇ Download ASYCUDA XML
        </button>
      </div>
    </PageLayout>
  );
}
