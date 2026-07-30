import { Fragment, useState } from "react";
import { fmtTTD } from "@pas/tax-engine";
import type { TaxBreakdownData, WorksheetGroupedLine, WorksheetSourceLine, WorksheetValidationIssue } from "@pas/shared-types";
import type { TaxAdviceData } from "@/lib/export/tax-advice-report";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { isDescriptionEdited } from "@/lib/worksheet-lines";

type TabId = "tax-advice" | "grouped" | "source";

interface Props {
  advice: TaxAdviceData;
  breakdown: TaxBreakdownData;
  sourceLines: WorksheetSourceLine[];
  groupedLines: WorksheetGroupedLine[];
  validation: WorksheetValidationIssue[];
  selectedIds: Set<number>;
  expandedGroups: Set<string>;
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onClearSelection: () => void;
  onToggleGroupExpand: (groupId: string) => void;
  onEditDescription: (lineId: number, desc: string) => void;
  onEditGroupDescription: (groupId: string, desc: string) => void;
  onEditLineField: (lineId: number, field: keyof WorksheetSourceLine, value: string) => void;
  onAutoGroup: () => void;
  onManualGroup: () => void;
  onUngroup: () => void;
  onBatchEdit: () => void;
}

export function WorksheetPreview({
  advice,
  breakdown: _breakdown,
  sourceLines,
  groupedLines,
  validation,
  selectedIds,
  expandedGroups,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onToggleGroupExpand,
  onEditDescription,
  onEditGroupDescription,
  onEditLineField,
  onAutoGroup,
  onManualGroup,
  onUngroup,
  onBatchEdit,
}: Props) {
  const [tab, setTab] = useState<TabId>("grouped");

  const tabs: { id: TabId; label: string }[] = [
    { id: "tax-advice", label: "Tax Advice" },
    { id: "grouped", label: "Grouped Worksheet" },
    { id: "source", label: "Original Invoice Lines" },
  ];

  const errors = validation.filter((v) => v.level === "error");
  const warnings = validation.filter((v) => v.level === "warning");

  return (
    <Card className="dd-card mt-4 overflow-hidden border-none shadow-none">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
        <div className="text-sm font-bold">Worksheet preview</div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                tab === t.id ? "text-white" : "",
              )}
              style={
                tab === t.id
                  ? { background: "var(--accent2)" }
                  : { background: "var(--surface2)", color: "var(--text2)" }
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="border-b px-4 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
          {errors.map((e, i) => (
            <div key={`e-${i}`} style={{ color: "var(--red)" }}>
              {e.message}
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} style={{ color: "var(--amber, #b45309)" }}>
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <Button variant="secondary" className="text-xs" onClick={onAutoGroup}>
          Auto Group (HS + Duty + VAT)
        </Button>
        <Button variant="secondary" className="text-xs" onClick={onManualGroup} disabled={selectedIds.size < 2}>
          Group Selected
        </Button>
        <Button variant="secondary" className="text-xs" onClick={onUngroup} disabled={!selectedIds.size}>
          Ungroup Selected
        </Button>
        <Button variant="secondary" className="text-xs" onClick={onBatchEdit} disabled={!selectedIds.size}>
          Batch Edit
        </Button>
        {selectedIds.size > 0 && (
          <button type="button" className="text-xs underline" style={{ color: "var(--text2)" }} onClick={onClearSelection}>
            Clear selection ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="overflow-x-auto p-4">
        {tab === "tax-advice" && <TaxAdviceTab advice={advice} />}
        {tab === "grouped" && (
          <GroupedTab
            groupedLines={groupedLines}
            sourceLines={sourceLines}
            expandedGroups={expandedGroups}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelectAll={onSelectAll}
            onToggleGroupExpand={onToggleGroupExpand}
            onEditDescription={onEditDescription}
            onEditGroupDescription={onEditGroupDescription}
            onEditLineField={onEditLineField}
          />
        )}
        {tab === "source" && <SourceTab sourceLines={sourceLines} />}
      </div>
    </Card>
  );
}

function TaxAdviceTab({ advice }: { advice: TaxAdviceData }) {
  const fmt2 = (n: number) => n.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="grid gap-4 lg:grid-cols-2 text-sm">
      <dl className="grid gap-1.5">
        {[
          ["Worksheet #", advice.worksheetNum],
          ["Consignee", advice.consignee?.name],
          ["Bill of Lading / AWB", advice.billOfLading],
          ["Commodity", advice.commodity],
          ["Prepared by", advice.preparedBy],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b py-1" style={{ borderColor: "var(--border)" }}>
            <dt style={{ color: "var(--text2)" }}>{k}</dt>
            <dd className="text-right">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-1.5">
        {[
          ["Import duty", fmtTTD(advice.totalDuty)],
          ["VAT", fmtTTD(advice.totalVAT)],
          ["CES", fmtTTD(advice.cesFee)],
          ["Deposit / other", fmtTTD(advice.depositFee + advice.userFeeAmt)],
          ["Total payable", fmtTTD(advice.grandTotal)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b py-1" style={{ borderColor: "var(--border)" }}>
            <dt style={{ color: "var(--text2)" }}>{k}</dt>
            <dd className="font-mono font-semibold text-right">{v}</dd>
          </div>
        ))}
        {advice.invoiceTotal != null && advice.invoiceTotal > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--text3)" }}>
            CIF context: Invoice {fmt2(advice.invoiceTotal)} USD
            {advice.cifTTD ? ` · CIF TT$${fmt2(advice.cifTTD)}` : ""}
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--text3)" }}>
          Page 1 uses the existing Tax Advice template — calculations and wording are unchanged.
        </p>
      </dl>
    </div>
  );
}

function GroupedTab({
  groupedLines,
  sourceLines,
  expandedGroups,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onToggleGroupExpand,
  onEditDescription,
  onEditGroupDescription,
  onEditLineField,
}: {
  groupedLines: WorksheetGroupedLine[];
  sourceLines: WorksheetSourceLine[];
  expandedGroups: Set<string>;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onToggleGroupExpand: (groupId: string) => void;
  onEditDescription: (lineId: number, desc: string) => void;
  onEditGroupDescription: (groupId: string, desc: string) => void;
  onEditLineField: (lineId: number, field: keyof WorksheetSourceLine, value: string) => void;
}) {
  const lineById = new Map(sourceLines.map((l) => [l.id, l]));

  return (
    <table className="data-table w-full text-sm">
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              checked={sourceLines.length > 0 && sourceLines.every((l) => selectedIds.has(l.id))}
              onChange={(e) =>
                e.target.checked ? onSelectAll(sourceLines.map((l) => l.id)) : onSelectAll([])
              }
            />
          </th>
          <th />
          <th>Worksheet Description</th>
          <th>HS Code</th>
          <th>Qty</th>
          <th className="text-right">CIF Value</th>
          <th>Duty rate</th>
          <th>VAT rate</th>
          <th className="text-right">Total Duty</th>
          <th className="text-right">Total VAT</th>
          <th>Source lines</th>
        </tr>
      </thead>
      <tbody>
        {groupedLines.map((group) => {
          const isMulti = group.source_line_ids.length > 1;
          const expanded = expandedGroups.has(group.group_id);
          const primaryId = group.source_line_ids[0];
          const primary = lineById.get(primaryId);

          const isRealGroup = isMulti && group.group_id.startsWith("grp_");
          const edited = primary ? isDescriptionEdited(primary) : false;

          return (
            <Fragment key={group.group_id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    checked={group.source_line_ids.every((id) => selectedIds.has(id))}
                    onChange={() => {
                      const allSelected = group.source_line_ids.every((id) => selectedIds.has(id));
                      group.source_line_ids.forEach((id) => {
                        if (allSelected && selectedIds.has(id)) onToggleSelect(id);
                        else if (!allSelected && !selectedIds.has(id)) onToggleSelect(id);
                      });
                    }}
                  />
                </td>
                <td>
                  {isMulti && (
                    <button
                      type="button"
                      className="text-xs"
                      onClick={() => onToggleGroupExpand(group.group_id)}
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      {expanded ? "▼" : "▶"}
                    </button>
                  )}
                </td>
                <td className="min-w-[180px]">
                  {primary ? (
                    <div>
                      <input
                        className="dd-input w-full text-xs"
                        value={group.worksheet_description}
                        onChange={(e) =>
                          isRealGroup
                            ? onEditGroupDescription(group.group_id, e.target.value)
                            : onEditDescription(primary.id, e.target.value)
                        }
                      />
                      {edited && <EditedBadge />}
                    </div>
                  ) : (
                    group.worksheet_description
                  )}
                  {isMulti && (
                    <div className="mt-0.5 text-[10px]" style={{ color: "var(--text3)" }}>
                      {group.source_line_ids.length} invoice lines grouped
                    </div>
                  )}
                </td>
                <td>
                  {primary ? (
                    <input
                      className="dd-input w-24 font-mono text-xs"
                      value={primary.hs_code || ""}
                      onChange={(e) => onEditLineField(primary.id, "hs_code", e.target.value)}
                    />
                  ) : (
                    <span className="font-mono text-xs">{group.hs_code || "—"}</span>
                  )}
                </td>
                <td>{isMulti ? `${group.source_line_ids.length} lines` : group.total_quantity}</td>
                <td className="text-right font-mono">{fmtTTD(group.total_value)}</td>
                <td>
                  {primary ? (
                    <input
                      className="dd-input w-16 text-xs"
                      value={primary.duty_rate || ""}
                      onChange={(e) => onEditLineField(primary.id, "duty_rate", e.target.value)}
                    />
                  ) : (
                    group.duty_rate || "—"
                  )}
                </td>
                <td>
                  {primary ? (
                    <input
                      className="dd-input w-16 text-xs"
                      value={primary.vat_rate || ""}
                      onChange={(e) => onEditLineField(primary.id, "vat_rate", e.target.value)}
                    />
                  ) : (
                    group.vat_rate || "—"
                  )}
                </td>
                <td className="text-right font-mono">{fmtTTD(group.total_duty)}</td>
                <td className="text-right font-mono">{fmtTTD(group.total_vat)}</td>
                <td className="text-xs">{group.source_line_numbers.join(", ")}</td>
              </tr>
              {expanded &&
                isMulti &&
                group.source_line_ids.map((id) => {
                  const line = lineById.get(id);
                  if (!line) return null;
                  return (
                    <tr key={`${group.group_id}-${id}`} style={{ background: "var(--surface2)" }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(line.id)}
                          onChange={() => onToggleSelect(line.id)}
                        />
                      </td>
                      <td colSpan={9} className="text-xs pl-6">
                        <span className="dd-text-muted">Line {line.source_line_number}:</span>{" "}
                        {line.original_description}
                        <span className="ml-2 font-mono" style={{ color: "var(--text2)" }}>
                          {fmtTTD(line.value)} · Duty {fmtTTD(line.duty_amount)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function SourceTab({ sourceLines }: { sourceLines: WorksheetSourceLine[] }) {
  return (
    <table className="data-table w-full text-sm">
      <thead>
        <tr>
          <th>#</th>
          <th>Original description</th>
          <th>Worksheet description</th>
          <th>HS Code</th>
          <th>Qty</th>
          <th className="text-right">Value</th>
          <th>Group ID</th>
          <th>Review</th>
        </tr>
      </thead>
      <tbody>
        {sourceLines.map((line) => (
          <tr key={line.id}>
            <td className="dd-text-muted">{line.source_line_number}</td>
            <td>{line.original_description}</td>
            <td>
              {line.worksheet_description}
              {isDescriptionEdited(line) && <EditedBadge />}
            </td>
            <td className="font-mono text-xs">{line.hs_code || "—"}</td>
            <td>{line.quantity}</td>
            <td className="text-right font-mono">{fmtTTD(line.value)}</td>
            <td className="font-mono text-xs">{line.group_id || "—"}</td>
            <td>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  background: line.reviewed_status === "reviewed" ? "var(--green-light)" : "var(--surface2)",
                  color: line.reviewed_status === "reviewed" ? "var(--green)" : "var(--text2)",
                }}
              >
                {line.reviewed_status === "reviewed" ? "Reviewed" : "Pending"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EditedBadge() {
  return (
    <span
      className="ml-1 inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase"
      style={{ background: "var(--amber-light, #fef3c7)", color: "var(--amber, #b45309)" }}
    >
      edited
    </span>
  );
}
