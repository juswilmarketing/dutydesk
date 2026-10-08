import type { WorksheetSourceLine } from "@pas/shared-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LineItem } from "@pas/shared-types";
import type { TaxRow } from "@pas/tax-engine";
import {
  autoGroupByClassification,
  batchEditLines,
  buildGroupedLines,
  initSourceLinesFromTax,
  loadWorksheetLines,
  manualGroupLines,
  mergeSourceLines,
  saveWorksheetLines,
  ungroupSelectedLines,
  updateGroupDescription,
  updateLineDescription,
  validateWorksheetLines,
  type BatchEditPatch,
} from "@/lib/worksheet-lines";

interface UseWorksheetLinesArgs {
  worksheetNum: string;
  taxRows: TaxRow[];
  activeItems: LineItem[];
  vatExempt: boolean;
}

export function useWorksheetLines({
  worksheetNum,
  taxRows,
  activeItems,
  vatExempt,
}: UseWorksheetLinesArgs) {
  const [sourceLines, setSourceLines] = useState<WorksheetSourceLine[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const fingerprint = useMemo(
    () =>
      taxRows
        .map(
          (r) =>
            `${r.id}:${r.tariff_code || ""}:${r.duty_rate || ""}:${r.duty.toFixed(2)}:${r.vat.toFixed(2)}:${r.itemCIF.toFixed(2)}`,
        )
        .join("|"),
    [taxRows],
  );

  const activeItemsRef = useRef(activeItems);
  activeItemsRef.current = activeItems;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!taxRows.length) {
      setSourceLines([]);
      return;
    }
    const fresh = initSourceLinesFromTax(taxRows, activeItemsRef.current, vatExempt);
    const saved = worksheetNum ? loadWorksheetLines(worksheetNum) : null;
    const merged = saved ? mergeSourceLines(saved, fresh) : fresh;
    setSourceLines((prev) => (linesEqual(prev, merged) ? prev : merged));
  }, [worksheetNum, fingerprint, vatExempt, taxRows.length]);

  useEffect(() => {
    if (!worksheetNum || !sourceLines.length) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveWorksheetLines(worksheetNum, sourceLines);
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [worksheetNum, sourceLines]);

  const groupedLines = useMemo(() => buildGroupedLines(sourceLines), [sourceLines]);
  const validation = useMemo(
    () => validateWorksheetLines(sourceLines, groupedLines),
    [sourceLines, groupedLines],
  );
  const hasErrors = validation.some((v) => v.level === "error");

  const persist = useCallback((next: WorksheetSourceLine[]) => setSourceLines(next), []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => setSelectedIds(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleGroupExpand = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const applyAutoGroup = useCallback(() => {
    persist(autoGroupByClassification(sourceLines));
    clearSelection();
  }, [sourceLines, persist, clearSelection]);

  const applyManualGroup = useCallback(() => {
    if (selectedIds.size < 2) return;
    persist(manualGroupLines(sourceLines, [...selectedIds]));
    clearSelection();
  }, [sourceLines, selectedIds, persist, clearSelection]);

  const applyUngroup = useCallback(() => {
    persist(ungroupSelectedLines(sourceLines, [...selectedIds]));
    clearSelection();
  }, [sourceLines, selectedIds, persist, clearSelection]);

  const applyBatchEdit = useCallback(
    (patch: BatchEditPatch) => {
      if (!selectedIds.size) return;
      persist(batchEditLines(sourceLines, [...selectedIds], patch));
      clearSelection();
    },
    [sourceLines, selectedIds, persist, clearSelection],
  );

  const editDescription = useCallback((lineId: number, description: string) => {
    setSourceLines((prev) => updateLineDescription(prev, lineId, description));
  }, []);

  const editGroupDescription = useCallback((groupId: string, description: string) => {
    setSourceLines((prev) => updateGroupDescription(prev, groupId, description));
  }, []);

  const editLineField = useCallback(
    (lineId: number, field: keyof WorksheetSourceLine, value: string) => {
      setSourceLines((prev) =>
        prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)),
      );
    },
    [],
  );

  return {
    sourceLines,
    groupedLines,
    validation,
    hasErrors,
    selectedIds,
    expandedGroups,
    toggleSelect,
    selectAll,
    clearSelection,
    toggleGroupExpand,
    applyAutoGroup,
    applyManualGroup,
    applyUngroup,
    applyBatchEdit,
    editDescription,
    editGroupDescription,
    editLineField,
    setSourceLines: persist,
  };
}

function linesEqual(a: WorksheetSourceLine[], b: WorksheetSourceLine[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, i) => {
    const other = b[i];
    return (
      line.id === other.id &&
      line.worksheet_description === other.worksheet_description &&
      line.hs_code === other.hs_code &&
      line.duty_rate === other.duty_rate &&
      line.vat_rate === other.vat_rate &&
      line.group_id === other.group_id &&
      line.reviewed_status === other.reviewed_status &&
      Math.abs(line.value - other.value) < 0.01
    );
  });
}
