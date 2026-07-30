import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { calculateBrokerage, fmtBrokerage } from "@/lib/brokerage";
import { printBrokerageReport } from "@/lib/export/brokerage-report";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { SendToFlowBoardModal } from "@/components/flowboard/SendToFlowBoardModal";
import { sendBrokerageQuoteToFlowBoard } from "@/lib/flowboard-quotes";
import { openFlowboardJobCard } from "@/lib/flowboard-client";
import { syncTeamWorkflow } from "@/lib/workflow-sync";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clerkDisplayName } from "@/lib/clerk";
import type { TaxLogEntry } from "@pas/shared-types";

export function BrokeragePage() {
  const user = useAuthStore((s) => s.user);
  const clerkName = clerkDisplayName(user);
  const inputs = useWorkflowStore((s) => s.brokerageInputs);
  const setBrokerageInputs = useWorkflowStore((s) => s.setBrokerageInputs);
  const refreshTaxLog = useWorkflowStore((s) => s.refreshTaxLog);

  const [showSendModal, setShowSendModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentEntry, setSentEntry] = useState<TaxLogEntry | null>(null);

  const r = calculateBrokerage(inputs);
  const cif = parseFloat(inputs.cifUSD) || 0;

  const set = (key: keyof typeof inputs, val: string | boolean) =>
    setBrokerageInputs((b) => ({ ...b, [key]: val }));

  const handleSendQuote = async (options?: { sentToCustomerVia?: Array<"email" | "whatsapp" | "portal"> }) => {
    setSending(true);
    setSendError("");
    try {
      const entry = await sendBrokerageQuoteToFlowBoard(inputs, clerkName, {
        sentToCustomerVia: options?.sentToCustomerVia,
      });
      await syncTeamWorkflow().catch(() => null);
      refreshTaxLog();
      setSentEntry(entry);
      setShowSendModal(false);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send quote to FlowBoard");
    } finally {
      setSending(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        icon="⚓"
        title="Brokerage Fee Estimator"
        description="Estimate customs brokerage charges — send the quote once via FlowBoard"
        actions={
          cif > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="text-xs" onClick={() => printBrokerageReport(inputs)}>
                Print Quote
              </Button>
              <Button className="text-xs" style={{ background: "var(--accent2)" }} onClick={() => setShowSendModal(true)}>
                Send Quote to FlowBoard
              </Button>
            </div>
          ) : undefined
        }
      />

      {sentEntry && (
        <Card className="dd-card mb-4 border-none p-4 shadow-none" style={{ borderLeft: "4px solid var(--green)" }}>
          <div className="font-semibold" style={{ color: "var(--green)" }}>
            Brokerage quote sent to FlowBoard successfully.
          </div>
          <div className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
            Reference: <span className="font-mono font-semibold">{sentEntry.flowboardReference}</span>
            {" · "}
            {new Date(sentEntry.sentAt).toLocaleString()}
          </div>
          <Button variant="secondary" className="mt-3 text-xs" onClick={() => openFlowboardJobCard(sentEntry.flowboardJobId || sentEntry.taskId)}>
            Open Job Card
          </Button>
          <p className="mt-2 text-xs" style={{ color: "var(--text2)" }}>
            Customer email and WhatsApp delivery are managed in FlowBoard.
          </p>
        </Card>
      )}

      <div className="dd-card p-5">
        <div className="dd-section-title">Customer Information</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["custName", "Customer Name", "e.g. John Smith"],
              ["custCompany", "Company", "e.g. ABC Trading Ltd"],
              ["custEmail", "Email Address", "e.g. john@abc.com"],
              ["custPhone", "Phone", "e.g. 868-XXX-XXXX"],
            ] as const
          ).map(([k, l, p]) => (
            <div key={k}>
              <label className="dd-label">{l}</label>
              <input className="dd-input" placeholder={p} value={inputs[k]} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="dd-label">Address</label>
            <input className="dd-input" placeholder="12 Main Street, Port of Spain" value={inputs.custAddress} onChange={(e) => set("custAddress", e.target.value)} />
          </div>
          <div>
            <label className="dd-label">Quote / Reference No.</label>
            <input className="dd-input" value={inputs.invoiceNo} onChange={(e) => set("invoiceNo", e.target.value)} />
          </div>
          <div>
            <label className="dd-label">Commodity</label>
            <input className="dd-input" value={inputs.commodity} onChange={(e) => set("commodity", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="dd-label">Prepared By</label>
            <input className="dd-input" placeholder="Clerk name" value={inputs.preparedBy || user?.name || ""} onChange={(e) => set("preparedBy", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="dd-card p-5">
        <div className="dd-section-title">Shipment Details</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="dd-label">C.I.F. Value (TT$)</label>
            <input className="dd-input text-base font-semibold" type="number" step="0.01" value={inputs.cifUSD} onChange={(e) => set("cifUSD", e.target.value)} />
          </div>
          <div>
            <label className="dd-label">Payless Discount</label>
            <select className="dd-input" value={inputs.paylessDiscount} onChange={(e) => set("paylessDiscount", e.target.value)}>
              <option value="NO">NO — Standard Rate (0.5% on remainder)</option>
              <option value="YES">YES — Payless Rate (0.25% on remainder)</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="dd-label mb-0">Processing Fee (TT$500)</label>
            <button type="button" onClick={() => set("baseChargeOn", !inputs.baseChargeOn)} className="ml-auto rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: inputs.baseChargeOn ? "#1B4F8A" : "#ccc" }}>
              {inputs.baseChargeOn ? "ON" : "OFF"}
            </button>
          </div>
          <div className="sm:col-span-2">
            <label className="dd-label">Less Discount (TT$ or %)</label>
            <div className="flex gap-2">
              <input className="dd-input" type="number" placeholder="Amount TT$" value={inputs.discount} onChange={(e) => setBrokerageInputs((b) => ({ ...b, discount: e.target.value, discountPct: "" }))} />
              <span className="self-center text-xs" style={{ color: "var(--text2)" }}>
                or
              </span>
              <input className="dd-input" type="number" placeholder="%" value={inputs.discountPct} onChange={(e) => setBrokerageInputs((b) => ({ ...b, discountPct: e.target.value, discount: "" }))} />
            </div>
          </div>
        </div>
      </div>

      {cif > 0 && (
        <div className="dd-card overflow-hidden">
          <div className="px-4 py-3 text-[15px] font-bold text-white" style={{ background: "#0d1f35" }}>
            BROKERAGE FEES
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ background: "var(--gold-light)" }}>
                  {["Description", "Applicable Amount", "Fee"].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-bold uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["2% of first", r.c22, r.d22],
                  ["1.5% of next", r.c23, r.d23],
                  ["1% of next", r.c24, r.d24],
                  [`${r.payless ? ".25%" : ".5%"} thereafter`, r.c25, r.d25],
                  [".75% – Special", r.c26, r.d26],
                  ["0.25% – Special", r.c27, r.d27],
                ].map(([desc, app, fee], i) => (
                  <tr key={desc as string} style={{ background: i % 2 ? "var(--surface2)" : "transparent" }}>
                    <td className="px-2 py-1.5">{desc as string}</td>
                    <td className="px-2 py-1.5 font-mono">{(app as number) > 0 ? fmtBrokerage(app as number) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono font-bold">{(fee as number) > 0 ? fmtBrokerage(fee as number) : "—"}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--accent2-light)" }}>
                  <td className="px-2 py-1.5 font-semibold">PROCESSING FEE</td>
                  <td className="px-2 py-1.5 font-mono">TT$500</td>
                  <td className="px-2 py-1.5 font-mono font-bold">{r.baseChargeOn ? fmtBrokerage(r.d28) : "—"}</td>
                </tr>
                {r.d29 < 0 && (
                  <tr>
                    <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--red)" }}>
                      LESS DISCOUNT
                    </td>
                    <td />
                    <td className="px-2 py-1.5 font-mono font-bold" style={{ color: "var(--red)" }}>
                      ({fmtBrokerage(-r.d29)})
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 flex justify-between rounded-lg px-3 py-2 text-[13px] font-bold" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
              <span>TOTAL BROKERAGE</span>
              <span className="font-mono">{fmtBrokerage(r.d30)}</span>
            </div>

            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
              Other Charges
            </div>
            {[
              ["DOCUMENTATION", r.d33, null],
              ["HANDLING CHARGES", r.d34, null],
              ["BDC", r.d35, "bdc"],
              ["USER FEE", r.d36, "userFee"],
              ["WEIGH BRIDGE FEE", r.d37, "weighBridge"],
              ["CLERK OVERTIME", r.d38, "clerkOvertime"],
              ["CUSTOMS OVERTIME", r.d39, "customsOvertime"],
              ["CERTIFICATE OF ORIGIN", r.d40, "certOrigin"],
            ].map(([label, val, key]) => (
              <div key={label as string} className="flex items-center justify-between border-b py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>
                <span style={{ color: "var(--text2)" }}>{label as string}</span>
                {key ? (
                  <input
                    type="number"
                    className="dd-input w-32 text-right font-mono text-xs"
                    value={inputs[key as keyof typeof inputs] as string}
                    onChange={(e) => set(key as keyof typeof inputs, e.target.value)}
                  />
                ) : (
                  <span className="font-mono font-semibold">{fmtBrokerage(val as number)}</span>
                )}
              </div>
            ))}
            <div className="mt-3 flex justify-between rounded-lg px-3 py-2 text-[13px] font-bold" style={{ background: "var(--surface2)" }}>
              <span>TOTAL DUE (before VAT)</span>
              <span className="font-mono">{fmtBrokerage(r.d42)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-3 text-white" style={{ background: "#0d1f35" }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide">Plus VAT 12.5% — Total Payable</span>
              <span className="font-mono text-xl font-extrabold">{fmtBrokerage(r.d45)}</span>
            </div>
          </div>
        </div>
      )}

      {cif > 0 && (
        <Card className="dd-card dd-sticky-actions mt-4 border-none shadow-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm" style={{ color: "var(--text2)" }}>
              Quote total: <span className="font-mono font-bold" style={{ color: "var(--green)" }}>{fmtBrokerage(r.d45)}</span>
              <div className="mt-1 text-xs">
                Customer delivery is handled by FlowBoard — do not email the quote from another tab.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="text-xs" onClick={() => printBrokerageReport(inputs)}>
                Print Quote
              </Button>
              <Button className="text-xs" style={{ background: "var(--accent2)" }} onClick={() => setShowSendModal(true)}>
                Send Quote to FlowBoard
              </Button>
            </div>
          </div>
        </Card>
      )}

      <SendToFlowBoardModal
        open={showSendModal}
        sending={sending}
        error={sendError}
        title="Send Brokerage Quote to FlowBoard?"
        message="This sends the brokerage fee estimate to FlowBoard once. FlowBoard owns customer email/WhatsApp — this is not duplicated on Duties & Taxes or Worksheet."
        confirmLabel="Send Quote to FlowBoard"
        onCancel={() => {
          setShowSendModal(false);
          setSendError("");
        }}
        onConfirm={handleSendQuote}
      />
    </PageLayout>
  );
}
