import { useEffect, useMemo, useState } from "react";
import type { SupplierClassificationEntry } from "@pas/shared-types";
import { useInvoiceStore } from "@/stores/invoice-store";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

export function SupplierHistoryPage() {
  const setSupplierHistory = useInvoiceStore((s) => s.setSupplierHistory);
  const [entries, setEntries] = useState<SupplierClassificationEntry[]>([]);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { entries: rows } = await api.getSupplierHistory({
        q: query || undefined,
        supplier: supplierFilter || undefined,
        limit: 2000,
      });
      setEntries(rows);
      setSupplierHistory(rows);
      return rows.length;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const suppliers = useMemo(() => {
    const set = new Set(entries.map((e) => e.supplier_name));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (supplierFilter && e.supplier_name !== supplierFilter) return false;
      if (!q) return true;
      return (
        e.supplier_name.toLowerCase().includes(q) ||
        e.item_description.toLowerCase().includes(q) ||
        e.hs_code.includes(q)
      );
    });
  }, [entries, query, supplierFilter]);

  const disableEntry = async (id: number) => {
    await api.updateSupplierHistory(id, { disabled: true });
    await load();
  };

  const editHs = async (entry: SupplierClassificationEntry) => {
    const hs = window.prompt("New HS code", entry.hs_code);
    if (!hs?.trim()) return;
    await api.updateSupplierHistory(entry.id, { hs_code: hs.trim() });
    await load();
  };

  const mergeSuppliers = async () => {
    if (!mergeFrom.trim() || !mergeTo.trim()) return;
    await api.mergeSuppliers(mergeFrom.trim(), mergeTo.trim());
    setMessage(`Merged "${mergeFrom}" into "${mergeTo}"`);
    setMergeFrom("");
    setMergeTo("");
    await load();
  };

  const exportHistory = async () => {
    const data = await api.exportSupplierHistory();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageLayout>
      <PageHeader
        icon="🏭"
        title="Supplier History"
        description="Per-supplier classification memory — reduces AI usage for repeat suppliers"
        actions={<Badge tone="blue">{entries.length} entries</Badge>}
      />

      <Card className="dd-card mb-4 border-none p-4 shadow-none">
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            className="dd-input"
            placeholder="Search supplier, description, HS code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="dd-input"
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        {message && <p className="mt-2 text-sm" style={{ color: "var(--green)" }}>{message}</p>}
      </Card>

      <Card className="dd-card mb-4 border-none p-4 shadow-none">
        <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text2)" }}>
          Merge duplicate suppliers
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="dd-input flex-1 min-w-[140px]" placeholder="From supplier" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} />
          <input className="dd-input flex-1 min-w-[140px]" placeholder="Into supplier" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} />
          <Button onClick={mergeSuppliers}>Merge</Button>
          <Button variant="secondary" onClick={exportHistory}>Export JSON</Button>
        </div>
      </Card>

      <Card className="dd-card overflow-hidden border-none shadow-none">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Description</th>
                <th>HS Code</th>
                <th>Duty</th>
                <th>Uses</th>
                <th>Last used</th>
                <th>Approved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="max-w-[140px] truncate font-medium">{e.supplier_name}</td>
                  <td className="max-w-[200px] truncate">{e.item_description}</td>
                  <td className="font-mono text-xs">{e.hs_code}</td>
                  <td>{e.duty_rate}</td>
                  <td>{e.usage_count}</td>
                  <td className="text-xs dd-text-muted">{new Date(e.last_used_at).toLocaleDateString()}</td>
                  <td>{e.approved_by_clerk ? "✓" : "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      <Button variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => editHs(e)}>
                        Edit HS
                      </Button>
                      <Button variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => disableEntry(e.id)}>
                        Disable
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="py-8 text-center dd-text-muted">
                    No supplier history yet — approve classifications on the Classification page to build memory.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageLayout>
  );
}
