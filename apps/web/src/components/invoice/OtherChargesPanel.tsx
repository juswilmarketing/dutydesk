import type { Invoice, InvoiceCharge, InvoiceChargeKind } from "@pas/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  chargeKindLabel,
  createChargeId,
  otherChargesTotal,
  sumCharges,
} from "@/lib/invoice-charges";
import { fmtForeign, normalizeCurrency } from "@/lib/currencies";
import { cn } from "@/lib/cn";

const KINDS: InvoiceChargeKind[] = ["sales_tax", "other"];

interface Props {
  invoice: Invoice | null;
  combineAll: boolean;
  invoices: Invoice[];
  onUpdateInvoice: (invId: number, charges: InvoiceCharge[]) => void;
  onTaxInputsChange: (otherCharges: string) => void;
}

export function OtherChargesPanel({ invoice, combineAll, invoices, onUpdateInvoice, onTaxInputsChange }: Props) {
  const sourceInvoices = combineAll ? invoices : invoice ? [invoice] : [];

  const addCharge = (invId: number, kind: InvoiceChargeKind = "other") => {
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) return;
    const next = [
      ...(inv.meta.charges || []),
      { id: createChargeId(), kind, label: chargeKindLabel(kind), amount: "", includeInCif: true },
    ];
    onUpdateInvoice(invId, next);
  };

  const updateCharge = (invId: number, chargeId: string, patch: Partial<InvoiceCharge>) => {
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) return;
    const next = (inv.meta.charges || []).map((c) => (c.id === chargeId ? { ...c, ...patch } : c));
    onUpdateInvoice(invId, next);
    if (!combineAll) {
      onTaxInputsChange(String(otherChargesTotal(next)));
    }
  };

  const removeCharge = (invId: number, chargeId: string) => {
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) return;
    const next = (inv.meta.charges || []).filter((c) => c.id !== chargeId);
    onUpdateInvoice(invId, next);
    if (!combineAll) {
      onTaxInputsChange(String(otherChargesTotal(next)));
    }
  };

  const totalOther = sourceInvoices.reduce((s, inv) => s + otherChargesTotal(inv.meta.charges || []), 0);
  const totalInCif = sourceInvoices.reduce((s, inv) => s + sumCharges(inv.meta.charges || []), 0);

  return (
    <div className="col-span-full space-y-3">
      <p className="text-[12px]" style={{ color: "var(--text2)" }}>
        Sales taxes and other invoice charges detected during upload appear here. Amounts marked{" "}
        <strong>Include in CIF</strong> are added to the customs value with freight and insurance.
      </p>

      {sourceInvoices.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--text2)" }}>
          Select an invoice to manage other charges.
        </p>
      ) : (
        sourceInvoices.map((inv) => {
          const cur = normalizeCurrency(inv.meta.currency);
          const extra = (inv.meta.charges || []).filter((c) => c.kind === "sales_tax" || c.kind === "other");
          return (
            <div key={inv.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold">{inv.meta.supplier || inv.filename}</div>
                <div className="flex gap-1">
                  <Button variant="secondary" className="text-[10px]" onClick={() => addCharge(inv.id, "sales_tax")}>
                    + Sales tax
                  </Button>
                  <Button variant="secondary" className="text-[10px]" onClick={() => addCharge(inv.id, "other")}>
                    + Other
                  </Button>
                </div>
              </div>
              {extra.length === 0 ? (
                <p className="text-[11px]" style={{ color: "var(--text2)" }}>
                  No sales tax or other charges detected — add manually if on the invoice.
                </p>
              ) : (
                <div className="space-y-2">
                  {extra.map((c) => (
                    <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto_auto] sm:items-center">
                      <Input
                        className="text-xs"
                        value={c.label}
                        onChange={(e) => updateCharge(inv.id, c.id, { label: e.target.value })}
                        placeholder="Label"
                      />
                      <select
                        className="dd-input text-xs"
                        value={c.kind}
                        onChange={(e) => updateCharge(inv.id, c.id, { kind: e.target.value as InvoiceChargeKind })}
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {chargeKindLabel(k)}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="text-xs font-mono"
                        type="number"
                        step="0.01"
                        value={c.amount}
                        onChange={(e) => updateCharge(inv.id, c.id, { amount: e.target.value })}
                        placeholder="0.00"
                      />
                      <label className={cn("flex items-center gap-1 text-[10px] whitespace-nowrap")}>
                        <input
                          type="checkbox"
                          checked={c.includeInCif !== false}
                          onChange={(e) => updateCharge(inv.id, c.id, { includeInCif: e.target.checked })}
                        />
                        In CIF
                      </label>
                      <button
                        type="button"
                        className="text-[11px] hover:opacity-70"
                        style={{ color: "var(--text2)" }}
                        onClick={() => removeCharge(inv.id, c.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {combineAll && extra.length > 0 && (
                <div className="mt-2 text-[11px]" style={{ color: "var(--text2)" }}>
                  Subtotal ({cur}): {fmtForeign(otherChargesTotal(inv.meta.charges || []), cur)}
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="flex flex-wrap gap-4 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border)" }}>
        <span>
          Other charges total: <strong>{fmtForeign(totalOther, invoice ? normalizeCurrency(invoice.meta.currency) : "USD")}</strong>
        </span>
        <span>
          All CIF charges (incl. freight/insurance):{" "}
          <strong>{fmtForeign(totalInCif, invoice ? normalizeCurrency(invoice.meta.currency) : "USD")}</strong>
        </span>
      </div>
    </div>
  );
}
