import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useInvoiceStore } from "@/stores/invoice-store";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoBanner } from "@/components/ui/banners";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

export function LearnedPage() {
  const learnedMap = useInvoiceStore((s) => s.learnedMap);
  const setLearnedMap = useInvoiceStore((s) => s.setLearnedMap);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const load = async () => {
    setSyncing(true);
    try {
      const { entries } = await api.getLearned();
      setLearnedMap(entries);
      return entries.length;
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const entries = Object.values(learnedMap).sort((a, b) => (b.uses || 0) - (a.uses || 0));

  const doPull = async () => {
    setSyncMsg("Pulling from shared DB…");
    const count = await load();
    setSyncMsg(`✓ Synced ${count} entries`);
    setTimeout(() => setSyncMsg(""), 5000);
  };

  const doPush = async () => {
    setSyncMsg("✓ All classifications are stored on the team server automatically");
    setTimeout(() => setSyncMsg(""), 5000);
  };

  const deleteEntry = async (key: string) => {
    await api.deleteLearned(key);
    await load();
  };

  const clearAll = async () => {
    if (!window.confirm("Clear all learned classifications?")) return;
    await api.clearLearned();
    await load();
  };

  const usesBadgeStyle = (uses: number): CSSProperties => {
    if (uses >= 5) return { background: "var(--green-light)", color: "var(--green)" };
    if (uses >= 2) return { background: "var(--gold-light)", color: "var(--gold)" };
    return { background: "var(--surface2)", color: "var(--text2)" };
  };

  return (
    <PageLayout>
      <PageHeader
        icon="🧠"
        title="Learning Rules"
        description="Team-saved tariff codes from confirmed reviews"
        actions={<Badge tone="blue">{entries.length} entries</Badge>}
      />

    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b px-4 py-3.5" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="mb-0.5 flex items-center gap-2">
              <span className="text-[13px] font-semibold">Shared Sync</span>
              <Badge tone="green">Connected</Badge>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text2)" }}>Sync learned classifications across all team devices</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" className="text-xs" onClick={doPull} disabled={syncing}>
              ⬇ Pull Updates
            </Button>
            <Button className="text-xs" onClick={doPush} disabled={syncing}>
              ⬆ Push to Team
            </Button>
          </div>
        </div>
        {syncMsg && (
          <div
            className="border-t px-4 py-2.5 text-xs"
            style={{
              borderColor: "var(--border)",
              background: syncMsg.startsWith("✓") ? "var(--green-light)" : "var(--gold-light)",
              color: syncMsg.startsWith("✓") ? "var(--green)" : "var(--gold)",
            }}
          >
            {syncing && <span className="mr-1.5 inline-block animate-spin">⟳</span>}
            {syncMsg}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <span className="text-base font-bold">Classification History</span>
          <div className="flex items-center gap-2">
            <Badge tone="blue">{entries.length} entries</Badge>
            {entries.length > 0 && (
              <Button
                variant="ghost"
                className="h-auto border px-2.5 py-1 text-[11px]"
                style={{ borderColor: "color-mix(in srgb, white 25%, transparent)", background: "color-mix(in srgb, white 10%, transparent)", color: "white" }}
                onClick={clearAll}
              >
                🗑 Clear All
              </Button>
            )}
          </div>
        </CardHeader>

        {entries.length === 0 ? (
          <div className="empty-state px-8 py-12 text-center">
            <div className="empty-icon mb-2 text-4xl">🧠</div>
            <p className="text-[13px] font-medium">No classifications learned yet</p>
            <p className="mx-auto mt-2 max-w-md text-xs" style={{ color: "var(--text2)" }}>
              When you pick a code from the similar codes dropdown or manually confirm a tariff code in Review, it gets
              saved here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {["Item Description", "Tariff Code", "Duty Rate", "Category", "Used", "Learned On", ""].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((val) => (
                  <tr key={val.normalized_desc}>
                    <td className="max-w-[260px] leading-snug">{val.normalized_desc}</td>
                    <td>
                      <span className="code-chip">{val.tariff_code}</span>
                    </td>
                    <td>
                      <Badge tone="gold">{val.duty_rate}</Badge>
                    </td>
                    <td className="text-xs" style={{ color: "var(--text2)" }}>{val.category || "—"}</td>
                    <td className="text-center">
                      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={usesBadgeStyle(val.uses || 1)}>
                        {val.uses || 1}×
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs dd-text-muted">
                      {new Date(val.learned_at).toLocaleDateString("en-TT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => deleteEntry(val.normalized_desc)}
                        className="border-none bg-transparent dd-text-muted hover:opacity-70"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {entries.length > 0 && (
        <InfoBanner tone="warn">
          <strong>How learning works:</strong> Classifications confirmed in Review are saved here and auto-applied to
          future similar items. Use count tracks frequency. Delete any entry to stop using it.
        </InfoBanner>
      )}
    </div>
    </PageLayout>
  );
}
