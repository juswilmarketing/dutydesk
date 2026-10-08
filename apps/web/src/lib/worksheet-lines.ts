import type {
  LineItem,
  TaxBreakdownRow,
  WorksheetGroupedLine,
  WorksheetReviewStatus,
  WorksheetSourceLine,
  WorksheetValidationIssue,
} from "@pas/shared-types";
import type { TaxRow } from "@pas/tax-engine";

export const DEFAULT_VAT_RATE = "12.5%";

const STORAGE_PREFIX = "dutydesk_worksheet_lines_v1:";

export function normalizeHsCode(code: string | null | undefined): string {
  return (code || "").replace(/[\s.]/g, "").toUpperCase();
}

export function isDescriptionEdited(line: WorksheetSourceLine): boolean {
  return line.worksheet_description.trim() !== line.original_description.trim();
}

export function vatRateForRow(row: TaxRow, vatExempt: boolean): string {
  if (vatExempt || row.isVatExempt) return "Exempt";
  return DEFAULT_VAT_RATE;
}

export function initSourceLinesFromTax(
  taxRows: TaxRow[],
  items: LineItem[],
  vatExempt: boolean,
): WorksheetSourceLine[] {
  const itemById = new Map(items.map((it) => [it.id, it]));
  return taxRows.map((row, idx) => {
    const item = itemById.get(row.id);
    const desc = row.desc || item?.desc || "";
    return {
      id: row.id,
      source_line_number: idx + 1,
      original_description: desc,
      worksheet_description: desc,
      hs_code: row.tariff_code,
      duty_rate: row.duty_rate,
      vat_rate: item?.vat_rate || vatRateForRow(row, vatExempt),
      quantity: row.qty,
      value: row.itemCIF,
      duty_amount: row.duty,
      vat_amount: row.vat,
      group_id: null,
      reviewed_status: row.tariff_code ? "pending" : "pending",
      match_confidence: item?.match_confidence,
      requires_clerk_review: item?.requires_clerk_review,
      source: item?.source,
    };
  });
}

export function mergeSourceLines(
  existing: WorksheetSourceLine[],
  fresh: WorksheetSourceLine[],
): WorksheetSourceLine[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  return fresh.map((line) => {
    const prev = byId.get(line.id);
    if (!prev) return line;
    const classificationChanged =
      normalizeHsCode(prev.hs_code) !== normalizeHsCode(line.hs_code)
      || (prev.duty_rate || "") !== (line.duty_rate || "")
      || Math.abs((prev.duty_amount || 0) - (line.duty_amount || 0)) > 0.009;

    // Always refresh classification + tax amounts from the live tariff calculation.
    // Preserve clerk worksheet edits (description, grouping, review notes) only.
    return {
      ...line,
      original_description: prev.original_description || line.original_description,
      worksheet_description: isDescriptionEdited(prev)
        ? prev.worksheet_description
        : line.worksheet_description,
      hs_code: line.hs_code,
      duty_rate: line.duty_rate,
      vat_rate: line.vat_rate,
      duty_amount: line.duty_amount,
      vat_amount: line.vat_amount,
      value: line.value,
      quantity: line.quantity,
      group_id: classificationChanged && !prev.auto_group_exempt ? null : prev.group_id,
      reviewed_status: classificationChanged ? "pending" : prev.reviewed_status,
      internal_notes: prev.internal_notes,
      auto_group_exempt: prev.auto_group_exempt,
    };
  });
}

export function buildGroupedLines(sourceLines: WorksheetSourceLine[]): WorksheetGroupedLine[] {
  const groups = new Map<string, WorksheetSourceLine[]>();
  const ungrouped: WorksheetSourceLine[] = [];

  for (const line of sourceLines) {
    if (line.group_id) {
      const list = groups.get(line.group_id) || [];
      list.push(line);
      groups.set(line.group_id, list);
    } else {
      ungrouped.push(line);
    }
  }

  const result: WorksheetGroupedLine[] = [];

  for (const [groupId, lines] of groups) {
    result.push(aggregateGroup(groupId, lines));
  }

  for (const line of ungrouped) {
    result.push({
      group_id: `solo_${line.id}`,
      hs_code: line.hs_code,
      worksheet_description: line.worksheet_description,
      source_line_ids: [line.id],
      source_line_numbers: [line.source_line_number],
      total_quantity: line.quantity,
      total_value: line.value,
      duty_rate: line.duty_rate,
      vat_rate: line.vat_rate,
      total_duty: line.duty_amount,
      total_vat: line.vat_amount,
      reviewed_status: line.reviewed_status,
      internal_notes: line.internal_notes,
    });
  }

  return result.sort((a, b) => a.source_line_numbers[0] - b.source_line_numbers[0]);
}

function aggregateGroup(groupId: string, lines: WorksheetSourceLine[]): WorksheetGroupedLine {
  const sorted = [...lines].sort((a, b) => a.source_line_number - b.source_line_number);
  const descriptions = [...new Set(sorted.map((l) => l.worksheet_description.trim()))];
  const worksheetDescription =
    descriptions.length === 1
      ? descriptions[0]
      : sorted[0].worksheet_description;

  const dutyRates = [...new Set(sorted.map((l) => l.duty_rate || ""))];
  const vatRates = [...new Set(sorted.map((l) => l.vat_rate || ""))];

  return {
    group_id: groupId,
    hs_code: sorted[0].hs_code,
    worksheet_description: worksheetDescription,
    source_line_ids: sorted.map((l) => l.id),
    source_line_numbers: sorted.map((l) => l.source_line_number),
    total_quantity: sorted.reduce((s, l) => s + l.quantity, 0),
    total_value: sorted.reduce((s, l) => s + l.value, 0),
    duty_rate: dutyRates.length === 1 ? dutyRates[0] : sorted[0].duty_rate,
    vat_rate: vatRates.length === 1 ? vatRates[0] : sorted[0].vat_rate,
    total_duty: sorted.reduce((s, l) => s + l.duty_amount, 0),
    total_vat: sorted.reduce((s, l) => s + l.vat_amount, 0),
    reviewed_status: sorted.every((l) => l.reviewed_status === "reviewed") ? "reviewed" : "pending",
    internal_notes: sorted.map((l) => l.internal_notes).filter(Boolean).join("; ") || undefined,
  };
}

function classificationKey(line: WorksheetSourceLine): string | null {
  const hs = normalizeHsCode(line.hs_code);
  if (!hs) return null;
  const duty = (line.duty_rate || "").trim();
  const vat = (line.vat_rate || "").trim();
  return `${hs}|${duty}|${vat}`;
}

/** Auto-group only when HS code, duty rate, and VAT rate are all identical. */
export function autoGroupByClassification(lines: WorksheetSourceLine[]): WorksheetSourceLine[] {
  const next = lines.map((l) => ({
    ...l,
    group_id: l.auto_group_exempt ? l.group_id : (null as string | null),
  }));
  const buckets = new Map<string, WorksheetSourceLine[]>();

  for (const line of next) {
    if (line.auto_group_exempt) continue;
    const key = classificationKey(line);
    if (!key) continue;
    const list = buckets.get(key) || [];
    list.push(line);
    buckets.set(key, list);
  }

  for (const [key, groupLines] of buckets) {
    if (groupLines.length < 2) continue;
    const groupId = `grp_auto_${key.replace(/[^A-Z0-9]/gi, "_")}`;
    for (const line of groupLines) {
      line.group_id = groupId;
    }
  }

  return next;
}

/** @deprecated Use autoGroupByClassification */
export const autoGroupByHsCode = autoGroupByClassification;

export function manualGroupLines(
  lines: WorksheetSourceLine[],
  selectedIds: number[],
): WorksheetSourceLine[] {
  if (selectedIds.length < 2) return lines;
  const groupId = `grp_manual_${Date.now()}`;
  const idSet = new Set(selectedIds);
  return lines.map((line) =>
    idSet.has(line.id) ? { ...line, group_id: groupId, auto_group_exempt: false } : line,
  );
}

export function ungroupLines(
  lines: WorksheetSourceLine[],
  groupId: string,
): WorksheetSourceLine[] {
  return lines.map((line) =>
    line.group_id === groupId ? { ...line, group_id: null } : line,
  );
}

export function ungroupSelectedLines(
  lines: WorksheetSourceLine[],
  selectedIds: number[],
): WorksheetSourceLine[] {
  const idSet = new Set(selectedIds);
  const groupIds = new Set(
    lines.filter((l) => idSet.has(l.id) && l.group_id).map((l) => l.group_id!),
  );
  if (!groupIds.size) return lines;
  return lines.map((line) =>
    line.group_id && groupIds.has(line.group_id)
      ? { ...line, group_id: null, auto_group_exempt: true }
      : line,
  );
}

export interface BatchEditPatch {
  worksheet_description?: string;
  hs_code?: string;
  duty_rate?: string;
  vat_rate?: string;
  reviewed_status?: WorksheetReviewStatus;
  internal_notes?: string;
}

export function batchEditLines(
  lines: WorksheetSourceLine[],
  selectedIds: number[],
  patch: BatchEditPatch,
): WorksheetSourceLine[] {
  const idSet = new Set(selectedIds);
  return lines.map((line) => {
    if (!idSet.has(line.id)) return line;
    const updated = { ...line };
    if (patch.worksheet_description !== undefined && patch.worksheet_description !== "") {
      updated.worksheet_description = patch.worksheet_description;
    }
    if (patch.hs_code !== undefined && patch.hs_code !== "") {
      updated.hs_code = patch.hs_code;
    }
    if (patch.duty_rate !== undefined && patch.duty_rate !== "") {
      updated.duty_rate = patch.duty_rate;
    }
    if (patch.vat_rate !== undefined && patch.vat_rate !== "") {
      updated.vat_rate = patch.vat_rate;
    }
    if (patch.reviewed_status !== undefined) {
      updated.reviewed_status = patch.reviewed_status;
    }
    if (patch.internal_notes !== undefined && patch.internal_notes !== "") {
      updated.internal_notes = patch.internal_notes;
    }
    return updated;
  });
}

export function updateGroupDescription(
  lines: WorksheetSourceLine[],
  groupId: string,
  description: string,
): WorksheetSourceLine[] {
  return lines.map((line) =>
    line.group_id === groupId ? { ...line, worksheet_description: description } : line,
  );
}

export function updateLineDescription(
  lines: WorksheetSourceLine[],
  lineId: number,
  description: string,
): WorksheetSourceLine[] {
  return lines.map((line) =>
    line.id === lineId ? { ...line, worksheet_description: description } : line,
  );
}

export function validateWorksheetLines(
  sourceLines: WorksheetSourceLine[],
  groupedLines: WorksheetGroupedLine[],
): WorksheetValidationIssue[] {
  const issues: WorksheetValidationIssue[] = [];

  for (const group of groupedLines) {
    if (!group.hs_code?.trim()) {
      issues.push({
        level: "error",
        message: `Grouped line "${group.worksheet_description || "—"}" is missing HS/tariff code`,
        lineIds: group.source_line_ids,
        groupId: group.group_id,
      });
    }
    if (!group.duty_rate?.trim()) {
      issues.push({
        level: "error",
        message: `Grouped line "${group.worksheet_description || "—"}" is missing duty rate`,
        lineIds: group.source_line_ids,
        groupId: group.group_id,
      });
    }
    if (!group.vat_rate?.trim()) {
      issues.push({
        level: "error",
        message: `Grouped line "${group.worksheet_description || "—"}" is missing VAT rate`,
        lineIds: group.source_line_ids,
        groupId: group.group_id,
      });
    }
    if (!group.worksheet_description?.trim()) {
      issues.push({
        level: "error",
        message: `Grouped line (HS ${group.hs_code || "—"}) is missing worksheet description`,
        lineIds: group.source_line_ids,
        groupId: group.group_id,
      });
    }

    if (group.source_line_ids.length > 1) {
      const members = sourceLines.filter((l) => group.source_line_ids.includes(l.id));
      const dutyRates = new Set(members.map((l) => l.duty_rate || ""));
      const vatRates = new Set(members.map((l) => l.vat_rate || ""));
      const descriptions = new Set(members.map((l) => l.worksheet_description.trim()));

      if (dutyRates.size > 1) {
        issues.push({
          level: "warning",
          message: `Group "${group.worksheet_description}" has lines with different duty rates`,
          lineIds: group.source_line_ids,
          groupId: group.group_id,
        });
      }
      if (vatRates.size > 1) {
        issues.push({
          level: "warning",
          message: `Group "${group.worksheet_description}" has lines with different VAT rates`,
          lineIds: group.source_line_ids,
          groupId: group.group_id,
        });
      }
      if (descriptions.size > 1 && normalizeHsCode(group.hs_code)) {
        issues.push({
          level: "warning",
          message: `HS ${group.hs_code} group has conflicting descriptions — review before generating`,
          lineIds: group.source_line_ids,
          groupId: group.group_id,
        });
      }
    }

    const lowConfidence = sourceLines.filter(
      (l) =>
        group.source_line_ids.includes(l.id) &&
        (l.requires_clerk_review || (l.match_confidence !== undefined && l.match_confidence < 0.7)),
    );
    if (lowConfidence.length) {
      issues.push({
        level: "warning",
        message: `Low-confidence classification on line(s) ${lowConfidence.map((l) => l.source_line_number).join(", ")}`,
        lineIds: lowConfidence.map((l) => l.id),
        groupId: group.group_id,
      });
    }
  }

  return issues;
}

export function groupedToBreakdownRows(grouped: WorksheetGroupedLine[]): TaxBreakdownRow[] {
  return grouped.map((g) => ({
    desc: g.worksheet_description,
    worksheet_description: g.worksheet_description,
    tariff_code: g.hs_code,
    duty_rate: g.duty_rate,
    vat_rate: g.vat_rate,
    qty: g.total_quantity,
    itemCIF: g.total_value,
    duty: g.total_duty,
    vat: g.total_vat,
    isDutyExempt: g.duty_rate === "Free",
    isVatExempt: g.vat_rate === "Exempt",
    source_line_ids: g.source_line_ids,
    source_line_numbers: g.source_line_numbers,
    source_line_number: g.source_line_numbers[0],
    group_id: g.group_id,
  }));
}

export function sourceToBreakdownRows(lines: WorksheetSourceLine[]): TaxBreakdownRow[] {
  return lines.map((l) => ({
    desc: l.worksheet_description,
    worksheet_description: l.worksheet_description,
    original_description: l.original_description,
    tariff_code: l.hs_code,
    duty_rate: l.duty_rate,
    vat_rate: l.vat_rate,
    qty: l.quantity,
    itemCIF: l.value,
    duty: l.duty_amount,
    vat: l.vat_amount,
    isDutyExempt: l.duty_rate === "Free",
    isVatExempt: l.vat_rate === "Exempt",
    source_line_number: l.source_line_number,
    group_id: l.group_id || undefined,
  }));
}

export function loadWorksheetLines(worksheetNum: string): WorksheetSourceLine[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${worksheetNum.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sourceLines?: WorksheetSourceLine[] };
    return Array.isArray(parsed.sourceLines) ? parsed.sourceLines : null;
  } catch {
    return null;
  }
}

export function saveWorksheetLines(worksheetNum: string, sourceLines: WorksheetSourceLine[]) {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${worksheetNum.toLowerCase()}`,
      JSON.stringify({ sourceLines, updatedAt: new Date().toISOString() }),
    );
  } catch {
    /* non-critical */
  }
}
