import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { bestMatch, catFromCode } from "@pas/tariff-data";
import type { LineItem } from "@pas/shared-types";
import { SearchInput } from "@/features/manual-entry/SearchInput";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useInvoiceStore } from "@/stores/invoice-store";
import { InfoBanner } from "@/components/ui/banners";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { emptyInvoiceMetaExtras } from "@/lib/invoice-charges";

export function ManualEntryPage() {
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const setInvoices = useInvoiceStore((s) => s.setInvoices);
  const setActiveInvId = useInvoiceStore((s) => s.setActiveInvId);
  const learnedMap = useInvoiceStore((s) => s.learnedMap);
  const activeInv = invoices.find((inv) => inv.id === activeInvId) || null;
  const navigate = useNavigate();

  const learnedDb = Object.fromEntries(
    Object.entries(learnedMap).map(([k, v]) => [
      k,
      { tariff_code: v.tariff_code, duty_rate: v.duty_rate, category: v.category, uses: v.uses },
    ]),
  );

  const getOrCreateInvoice = () => {
    if (activeInv) return activeInvId!;
    const newId = Date.now();
    setInvoices((p) => [
      ...p,
      {
        id: newId,
        filename: "Quick Entry",
        meta: {
          number: "",
          date: "",
          supplier: "",
          from: "",
          to: "",
          clerk: "",
          currency: "USD",
          currencyRateToTTD: "",
          ...emptyInvoiceMetaExtras(),
        },
        items: [],
        status: "done",
      },
    ]);
    setActiveInvId(newId);
    return newId;
  };

  const addItem = (item: LineItem) => {
    const invId = getOrCreateInvoice();
    setInvoices((p) => p.map((inv) => (inv.id === invId ? { ...inv, items: [...inv.items, item] } : inv)));
    setDesc("");
    setQty("");
    setUnit("");
    setPrice("");
  };

  const onSelect = (r: { code: string; desc: string; duty: string }) => {
    addItem({
      id: Date.now(),
      desc: r.desc,
      qty: parseFloat(qty) || 1,
      unit: unit || "EA",
      price: parseFloat(price) || 0,
      tariff_code: r.code,
      duty_rate: r.duty,
      category: catFromCode(r.code),
      notes: "Matched from official T&T Customs tariff",
      status: "done",
      source: "database",
    });
  };

  const onAI = async () => {
    if (!desc.trim() || loading) return;
    setLoading(true);
    setError("");
    const dbMatch = bestMatch(desc.trim(), learnedDb);
    if (dbMatch) {
      addItem({
        id: Date.now(),
        desc: desc.trim(),
        qty: parseFloat(qty) || 1,
        unit: unit || "EA",
        price: parseFloat(price) || 0,
        tariff_code: dbMatch.code,
        duty_rate: dbMatch.duty,
        category: catFromCode(dbMatch.code),
        notes: "Matched from official T&T Customs tariff",
        status: "done",
        source: dbMatch.score === 100 ? "learned" : "database",
      });
      setLoading(false);
      return;
    }
    try {
      const r = await api.classify(desc.trim());
      addItem({
        id: Date.now(),
        desc: desc.trim(),
        qty: parseFloat(qty) || 1,
        unit: unit || "EA",
        price: parseFloat(price) || 0,
        tariff_code: r.tariff_code,
        duty_rate: r.duty_rate,
        category: r.category,
        notes: r.notes,
        status: "done",
        source: "ai",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    }
    setLoading(false);
  };

  return (
    <PageLayout>
      <PageHeader
        icon="✏️"
        title="Manual Classification"
        description="Search the tariff database and add classified line items"
      />

    <Card className="p-6">
      {activeInv ? (
        <InfoBanner tone="warn" className="mb-3.5">
          Adding items to:{" "}
          <strong>
            {activeInv.meta.supplier || activeInv.filename}
            {activeInv.meta.number && ` (#${activeInv.meta.number})`}
          </strong>
        </InfoBanner>
      ) : (
        <InfoBanner tone="info" className="mb-3.5">
          💡 No invoice loaded — items will be added to a new Quick Entry list. Or{" "}
          <button
            type="button"
            onClick={() => navigate("/upload")}
            className="border-none bg-transparent p-0 font-semibold underline"
            style={{ color: "var(--accent)" }}
          >
            upload an invoice
          </button>{" "}
          first.
        </InfoBanner>
      )}

      {error && (
        <InfoBanner tone="error" className="mb-3" onDismiss={() => setError("")}>
          ⚠ {error}
        </InfoBanner>
      )}

      <div className="mb-3">
        <Label tip="Describe the product. The official T&T tariff database is searched first; AI is used only when no match is found.">
          Item Description
        </Label>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <SearchInput value={desc} onChange={setDesc} onSelect={onSelect} onEnter={onAI} />
        <div className="w-24 shrink-0">
          <Label tip="Quantity on the invoice or packing list">Qty</Label>
          <Input type="number" placeholder="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="w-24 shrink-0">
          <Label tip="Unit of measure (e.g. EA, PCS, SET)">Unit</Label>
          <Input placeholder="EA" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="w-36 shrink-0">
          <Label tip="Unit price in US dollars for customs valuation">Unit Price (USD)</Label>
          <Input type="number" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <Button
          onClick={onAI}
          disabled={loading || !desc.trim()}
          className="mb-0.5 h-[2.75rem] min-w-[140px]"
          style={loading || !desc.trim() ? { background: "var(--border)" } : { background: "var(--gold)" }}
        >
          {loading ? "⟳ Classifying…" : "+ Add Item"}
        </Button>
      </div>
    </Card>
    </PageLayout>
  );
}
