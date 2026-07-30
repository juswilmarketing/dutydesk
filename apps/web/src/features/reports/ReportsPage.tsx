import { useMemo, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { syncTeamWorkflow } from "@/lib/workflow-sync";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

export function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const refreshTaxLog = useWorkflowStore((s) => s.refreshTaxLog);

  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");
  const [filterBy, setFilterBy] = useState<"all" | "me">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const me = user?.name || user?.username || "";

  const syncLog = async () => {
    setSyncing(true);
    try {
      await syncTeamWorkflow();
    } catch {
      refreshTaxLog();
    }
    setSyncing(false);
  };

  const fmt = (n: number) => (n || 0).toLocaleString("en-TT", { minimumFractionDigits: 2 });
  const fmtDate = (s: string) => {
    try {
      return new Date(s).toLocaleString("en-TT", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return s || "";
    }
  };
  const fileIcon = (t: string) => (t?.includes("pdf") ? "📄" : t?.includes("image") ? "🖼" : "📎");

  const filtered = useMemo(
    () =>
      taxLog.filter((e) => {
        if (filterBy === "me" && e.sentBy !== me) return false;
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          (e.worksheetNum || "").toLowerCase().includes(q) ||
          (e.consigneeName || "").toLowerCase().includes(q) ||
          (e.sentTo || "").toLowerCase().includes(q) ||
          (e.sentBy || "").toLowerCase().includes(q) ||
          (e.billOfLading || "").toLowerCase().includes(q) ||
          (e.commodity || "").toLowerCase().includes(q)
        );
      }),
    [taxLog, filter, filterBy, me],
  );

  const totalDuty = filtered.reduce((s, e) => s + (e.totalDuty || 0), 0);
  const totalVAT = filtered.reduce((s, e) => s + (e.totalVAT || 0), 0);
  const totalPayable = filtered.reduce((s, e) => s + (e.grandTotal || 0), 0);

  const exportCSV = () => {
    const rows = [
      [
        "Date",
        "Worksheet #",
        "Consignee",
        "Bill of Lading",
        "Commodity",
        "Sent To",
        "Sent CC",
        "Sent By",
        "Method",
        "ICD (TTD)",
        "VAT (TTD)",
        "CES Fee",
        "Deposit Fee",
        "User Fee",
        "Total Payable (TTD)",
        "Attachments",
      ],
      ...filtered.map((e) => [
        fmtDate(e.sentAt),
        e.worksheetNum || "",
        e.consigneeName || "",
        e.billOfLading || "",
        e.commodity || "",
        e.sentTo || "",
        e.sentCc || "",
        e.sentBy || "",
        e.method || "",
        (e.totalDuty || 0).toFixed(2),
        (e.totalVAT || 0).toFixed(2),
        (e.cesFee || 0).toFixed(2),
        (e.depositFee || 0).toFixed(2),
        (e.userFeeAmt || 0).toFixed(2),
        (e.grandTotal || 0).toFixed(2),
        (e.attachments || []).map((a) => a.name).join("; "),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `DutyDesk_Tax_Log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <PageLayout>
      <PageHeader
        icon="📊"
        title="Tax Advice Log"
        description={`${taxLog.length} records · synced across team on login and send`}
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={syncLog} disabled={syncing} className="rounded-[10px] border px-3.5 py-2 text-xs font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-light)" }}>
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button type="button" onClick={exportCSV} disabled={!filtered.length} className="rounded-[10px] border px-3.5 py-2 text-xs font-semibold" style={{ borderColor: "var(--green)", color: "var(--green)", background: "var(--green-light)" }}>
              Export CSV
            </button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Worksheets Sent", String(filtered.length)],
          ["Total ICD", `TT$${fmt(totalDuty)}`],
          ["Total VAT", `TT$${fmt(totalVAT)}`],
          ["Total Payable", `TT$${fmt(totalPayable)}`],
        ].map(([label, val]) => (
          <div key={label} className="rounded-[10px] px-3.5 py-3 text-center" style={{ background: "var(--surface2)" }}>
            <div className="mb-1 text-[11px]" style={{ color: "var(--text2)" }}>
              {label}
            </div>
            <div className="text-sm font-semibold">{val}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input className="dd-input min-w-[200px] flex-1 text-[13px]" placeholder="Search worksheet, consignee, B/L, commodity…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="dd-input w-auto text-[13px]" value={filterBy} onChange={(e) => setFilterBy(e.target.value as "all" | "me")}>
          <option value="all">All clerks</option>
          <option value="me">My sends only</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center" style={{ color: "var(--text2)" }}>
          <div className="mb-2 text-3xl">📭</div>
          <div className="text-[13px]">{taxLog.length === 0 ? "No tax advice sent yet — records appear here after sending" : "No results match your filter"}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((e) => {
            const isExp = expanded === e.id;
            const atts = e.attachments || [];
            return (
              <div key={e.id} className="dd-card overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-none bg-transparent px-4 py-3 text-left"
                  onClick={() => setExpanded(isExp ? null : e.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-bold">{e.worksheetNum || "—"}</span>
                      <span className="text-xs font-semibold">{e.consigneeName || "—"}</span>
                      <span className="text-[11px]" style={{ color: "var(--text2)" }}>
                        → {e.sentTo || "—"}
                      </span>
                      <span className="dd-badge" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                        {e.method || "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px]" style={{ color: "var(--text2)" }}>
                      <span>🕐 {fmtDate(e.sentAt)}</span>
                      <span style={{ color: "var(--accent)" }}>by {e.sentBy || "—"}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13px] font-bold">TT${fmt(e.grandTotal)}</div>
                    <div className="text-[10px]" style={{ color: "var(--text2)" }}>
                      Total payable
                    </div>
                  </div>
                  <span className="text-xs" style={{ color: "var(--text3)" }}>
                    {isExp ? "▲" : "▼"}
                  </span>
                </button>
                {isExp && (
                  <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
                          Fee Breakdown
                        </div>
                        <table className="w-full text-xs">
                          <tbody>
                            {[
                              ["Import Duty (ICD)", e.totalDuty],
                              ["VAT", e.totalVAT],
                              ["CES Fee", e.cesFee],
                              ["Deposit / Other", e.depositFee],
                              ["User Fee", e.userFeeAmt],
                            ].map(([label, val]) => (
                              <tr key={label as string}>
                                <td className="py-1" style={{ color: "var(--text2)" }}>
                                  {label}
                                </td>
                                <td className="py-1 text-right font-mono">TT${fmt(val as number)}</td>
                              </tr>
                            ))}
                            <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                              <td className="py-2 font-bold">TOTAL PAYABLE</td>
                              <td className="py-2 text-right font-mono font-bold" style={{ color: "var(--red)" }}>
                                TT${fmt(e.grandTotal)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
                          Attachments ({atts.length})
                        </div>
                        {atts.length === 0 ? (
                          <div className="text-xs" style={{ color: "var(--text3)" }}>
                            No attachments recorded
                          </div>
                        ) : (
                          atts.map((a, ai) => (
                            <div key={ai} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>
                              <span>{fileIcon(a.type)}</span>
                              <span className="truncate">{a.name}</span>
                            </div>
                          ))
                        )}
                        {e.sentCc && (
                          <div className="mt-2 text-[11px]" style={{ color: "var(--text2)" }}>
                            CC: {e.sentCc}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
