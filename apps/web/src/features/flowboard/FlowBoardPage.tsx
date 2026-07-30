import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkflowStore } from "@/stores/workflow-store";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  deriveFlowBoardStatus,
  flowBoardStatusLabel,
  isDirectCustomerSend,
} from "@/lib/workflow-pipeline";
import { FlowBoardStatusBadge } from "@/components/workflow/StatusBadge";
import { openInFlowBoard } from "@/lib/flowboard-client";
import type { TaxLogEntry } from "@pas/shared-types";
import { fmtTTD } from "@pas/tax-engine";

function queueRows(taxLog: TaxLogEntry[]) {
  const worksheets = taxLog.filter(
    (e) => e.method === "FlowBoard" || (e.method.includes("FlowBoard") && !e.method.includes("Quote")),
  );
  const quotes = taxLog.filter((e) => e.method.includes("Quote") || e.documentType?.includes("quote"));
  const emailed = taxLog.filter(
    (e) => isDirectCustomerSend(e) && e.worksheetNum && e.grandTotal > 0,
  );
  return { worksheets, quotes, emailed };
}

function directSendMethodLabel(entry: TaxLogEntry): string {
  const m = entry.method || "";
  if (m.includes("WhatsApp") && m.includes("Gmail")) return "Email + WhatsApp";
  if (m.includes("WhatsApp")) return "WhatsApp";
  if (m.includes("Mail Client")) return "Mail client";
  if (m.includes("Gmail")) return "Email";
  return m || "Email";
}

export function FlowBoardPage() {
  const navigate = useNavigate();
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const { worksheets, quotes, emailed } = useMemo(() => queueRows(taxLog), [taxLog]);

  const retrySend = (entry: TaxLogEntry) => {
    navigate(`/worksheet?worksheet=${encodeURIComponent(entry.worksheetNum)}`);
  };

  return (
    <PageLayout>
      <PageHeader
        icon="🔀"
        title="FlowBoard"
        description="Worksheets sent to FlowBoard or completed directly via email — customer follow-up for clearance jobs lives in FlowBoard"
        actions={
          <Button variant="secondary" className="text-xs" onClick={() => openInFlowBoard()}>
            Open in FlowBoard
          </Button>
        }
      />

      <Card className="dd-card mb-4 border-none p-4 shadow-none">
        <p className="text-sm" style={{ color: "var(--text2)" }}>
          Classification-only jobs can be emailed from Duty Desk (status: Sent via Email). Brokerage clearance
          packages go to FlowBoard for delivery, WhatsApp, approvals, and document storage.
        </p>
      </Card>

      {emailed.length > 0 && (
        <Card className="dd-card mb-4 overflow-hidden border-none shadow-none">
          <div className="border-b px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--border)" }}>
            Sent via email
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Worksheet ID</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Grand total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {emailed.map((row) => {
                  const status = deriveFlowBoardStatus(row);
                  return (
                    <tr key={row.id}>
                      <td className="font-mono">{row.worksheetNum}</td>
                      <td>{row.consigneeName || "—"}</td>
                      <td>{row.billOfLading || row.commodity || "—"}</td>
                      <td className="text-xs">{directSendMethodLabel(row)}</td>
                      <td>
                        <FlowBoardStatusBadge status={status} />
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {row.sentAt ? new Date(row.sentAt).toLocaleString() : "—"}
                      </td>
                      <td className="font-mono">{fmtTTD(row.grandTotal)}</td>
                      <td>
                        <Button
                          variant="secondary"
                          className="text-xs"
                          onClick={() => navigate(`/worksheet?worksheet=${encodeURIComponent(row.worksheetNum)}`)}
                        >
                          View Worksheet
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="dd-card mb-4 overflow-hidden border-none shadow-none">
        <div className="border-b px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--border)" }}>
          Quotes sent to FlowBoard
        </div>
        {quotes.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: "var(--text2)" }}>
            No quotes sent yet. Use Brokerage or Duties &amp; Taxes → Send Tax Quote to FlowBoard.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((row) => {
                  const status = deriveFlowBoardStatus(row);
                  const typeLabel =
                    row.documentType === "brokerage_quote" ? "Brokerage" : "Tax quote";
                  return (
                    <tr key={row.id}>
                      <td className="font-mono">{row.worksheetNum}</td>
                      <td>{typeLabel}</td>
                      <td>{row.consigneeName || "—"}</td>
                      <td><FlowBoardStatusBadge status={status} /></td>
                      <td className="text-xs whitespace-nowrap">{new Date(row.sentAt).toLocaleString()}</td>
                      <td className="font-mono">{fmtTTD(row.grandTotal)}</td>
                      <td>
                        <Button variant="secondary" className="text-xs" onClick={() => openInFlowBoard(row.taskId)}>
                          Open in FlowBoard
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="dd-card overflow-hidden border-none shadow-none">
        <div className="border-b px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--border)" }}>
          Worksheets sent to FlowBoard
        </div>
        {worksheets.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--text2)" }}>
            No worksheets sent to FlowBoard yet. Complete a worksheet and use Send to FlowBoard.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Worksheet ID</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Sent time</th>
                  <th>FlowBoard ref</th>
                  <th>Last activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {worksheets.map((row) => {
                  const status = deriveFlowBoardStatus(row);
                  return (
                    <tr key={row.id}>
                      <td className="font-mono">{row.worksheetNum}</td>
                      <td>{row.consigneeName || "—"}</td>
                      <td>{row.invoiceNumber || row.billOfLading || "—"}</td>
                      <td><FlowBoardStatusBadge status={status} /></td>
                      <td className="whitespace-nowrap text-xs">
                        {row.sentAt ? new Date(row.sentAt).toLocaleString() : "—"}
                      </td>
                      <td className="font-mono text-xs">{row.flowboardReference || row.id}</td>
                      <td className="text-xs">
                        {row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString() : flowBoardStatusLabel(status)}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" className="text-xs" onClick={() => navigate(`/worksheet?worksheet=${encodeURIComponent(row.worksheetNum)}`)}>
                            View
                          </Button>
                          {status === "failed" && (
                            <Button variant="secondary" className="text-xs" onClick={() => retrySend(row)}>
                              Retry Send
                            </Button>
                          )}
                          <Button variant="secondary" className="text-xs" onClick={() => openInFlowBoard(row.taskId)}>
                            Open in FlowBoard
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
