import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

type ResolverAnalytics = Awaited<ReturnType<typeof api.getProductResolverAnalytics>>;

export function LearningStatsPage() {
  const [total, setTotal] = useState(0);
  const [byIndustry, setByIndustry] = useState<Array<{ key: string | null; count: number }>>([]);
  const [byChapter, setByChapter] = useState<Array<{ key: string | null; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [resolver, setResolver] = useState<ResolverAnalytics | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [data, resolverData] = await Promise.all([
        api.getLearningStats(),
        api.getProductResolverAnalytics(),
      ]);
      setTotal(data.total);
      setByIndustry(data.by_industry);
      setByChapter(data.by_chapter);
      setResolver(resolverData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <PageLayout>
      <PageHeader
        icon="📈"
        title="Learning Statistics"
        description="Product resolver learning, supplier catalogue growth and classification events"
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide dd-text-muted">Classification learning events</div>
          <div className="mt-1 text-2xl font-bold">{total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide dd-text-muted">Products learned today</div>
          <div className="mt-1 text-2xl font-bold">{resolver?.productsLearnedToday || 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide dd-text-muted">Unknown product terms</div>
          <div className="mt-1 text-2xl font-bold">{resolver?.unknownProducts.length || 0}</div>
        </Card>
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="p-4">
          <div className="mb-2 font-semibold">Top products</div>
          <div className="space-y-2 text-sm">
            {resolver?.topProducts.map((row) => (
              <div key={row.id} className="flex justify-between gap-3">
                <span className="truncate">{row.canonical_name}</span>
                <strong>{row.import_count} imports</strong>
              </div>
            ))}
            {!resolver?.topProducts.length && <div className="dd-text-muted">No product approvals yet.</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold">Most corrected products</div>
          <div className="space-y-2 text-sm">
            {resolver?.mostCorrected.map((row) => (
              <div key={row.id} className="flex justify-between gap-3">
                <span className="truncate">{row.canonical_name}</span>
                <strong>{row.correction_count}</strong>
              </div>
            ))}
            {!resolver?.mostCorrected.length && <div className="dd-text-muted">No corrections recorded.</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold">Unknown products</div>
          <div className="space-y-2 text-sm">
            {resolver?.unknownProducts.map((row) => (
              <div key={row.name} className="flex justify-between gap-3">
                <span className="truncate">{row.name}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
            {!resolver?.unknownProducts.length && <div className="dd-text-muted">No unresolved products.</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold">Most common aliases</div>
          <div className="space-y-2 text-sm">
            {resolver?.commonAliases.map((row) => (
              <div key={row.alias} className="flex justify-between gap-3">
                <span className="truncate">{row.alias}</span>
                <strong>{row.usage_count}</strong>
              </div>
            ))}
            {!resolver?.commonAliases.length && <div className="dd-text-muted">Aliases learn as clerks approve products.</div>}
          </div>
        </Card>
        <Card className="p-4 md:col-span-2">
          <div className="mb-2 font-semibold">Supplier catalogue growth</div>
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            {resolver?.supplierCatalogueGrowth.map((row) => (
              <div key={row.supplier_name} className="flex justify-between gap-3 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                <span className="truncate">{row.supplier_name}</span>
                <strong>{row.products} products · {row.imports} imports</strong>
              </div>
            ))}
            {!resolver?.supplierCatalogueGrowth.length && <div className="dd-text-muted">Supplier catalogues populate from approvals.</div>}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 font-semibold">By industry</div>
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Industry</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {byIndustry.map((r, i) => (
                <tr key={i}>
                  <td>{r.key || "—"}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold">By chapter</div>
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Chapter</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {byChapter.map((r, i) => (
                <tr key={i}>
                  <td>{r.key || "—"}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageLayout>
  );
}
