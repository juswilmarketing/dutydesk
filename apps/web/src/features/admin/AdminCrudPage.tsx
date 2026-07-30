import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

type Column<T> = { key: string; label: string; render?: (row: T) => ReactNode };

type Props<T extends { id?: number }> = {
  title: string;
  description: string;
  columns: Column<T>[];
  load: () => Promise<T[]>;
  onCreate?: () => Promise<void> | void;
  createLabel?: string;
  extraActions?: ReactNode;
};

export function AdminCrudPage<T extends { id?: number }>({
  title,
  description,
  columns,
  load,
  onCreate,
  createLabel = "Add entry",
  extraActions,
}: Props<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await load());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <PageLayout>
      <PageHeader
        icon="🧠"
        title={title}
        description={description}
        actions={
          <div className="flex gap-2">
            {extraActions}
            {onCreate && (
              <Button
                onClick={async () => {
                  await onCreate();
                  setMessage("Saved");
                  await refresh();
                }}
              >
                {createLabel}
              </Button>
            )}
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        }
      />
      {message && <div className="mb-3 text-sm dd-text-muted">{message}</div>}
      <Card className="overflow-x-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={(row.id as number) ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render
                      ? c.render(row)
                      : String((row as Record<string, unknown>)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="dd-text-muted">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </PageLayout>
  );
}
