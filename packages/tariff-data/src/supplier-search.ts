import type { MatchTypeLabel, TariffEntry } from "@pas/shared-types";
import { learnedMatch, normalizeDesc } from "./search";
import type { LearnedLookup } from "./search";

const SUPPLIER_SUFFIXES = new Set([
  "ltd",
  "limited",
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "llc",
  "plc",
  "gmbh",
  "sa",
  "bv",
  "pty",
  "group",
  "holdings",
  "international",
  "intl",
]);

/** Normalize supplier name for lookup keys. */
export function normalizeSupplierName(name: string): string {
  let s = name.toLowerCase().trim();
  s = s.replace(/[.,'"()&]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !SUPPLIER_SUFFIXES.has(w));
  return words.join(" ").trim();
}

/** Try to extract part/model numbers from a line description. */
export function extractPartNumbers(desc: string): { part_number?: string; model_number?: string } {
  const partMatch = desc.match(/\b(?:p\/n|pn|part\s*#?|sku|item\s*#)\s*[:.]?\s*([A-Z0-9][\w./-]{2,})/i);
  const modelMatch = desc.match(/\b(?:model|mdl|mod)\s*[:.]?\s*([A-Z0-9][\w./-]{2,})/i);
  return {
    part_number: partMatch?.[1],
    model_number: modelMatch?.[1],
  };
}

export interface SupplierHistoryRow {
  id: number;
  supplier_name: string;
  normalized_supplier_name: string;
  item_description: string;
  normalized_description: string;
  part_number?: string;
  model_number?: string;
  hs_code: string;
  tariff_description?: string;
  duty_rate: string;
  vat_rate?: string;
  confidence: number;
  match_type: string;
  approved_by_clerk: boolean;
  usage_count: number;
  last_used_at: string;
  disabled?: boolean;
}

export interface SupplierLookupIndex {
  /** normalized_supplier_name → rows */
  bySupplier: Record<string, SupplierHistoryRow[]>;
}

export function buildSupplierLookupIndex(rows: SupplierHistoryRow[]): SupplierLookupIndex {
  const bySupplier: Record<string, SupplierHistoryRow[]> = {};
  for (const row of rows) {
    if (row.disabled) continue;
    const key = row.normalized_supplier_name;
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(row);
  }
  return { bySupplier };
}

export interface SupplierMatchResult {
  code: string;
  duty: string;
  desc: string;
  match_type: MatchTypeLabel;
  source: "supplier_exact" | "supplier_fuzzy";
  confidence: number;
  needs_review: boolean;
  history_id: number;
  usage_count: number;
  last_used_at: string;
  clerk_approved: boolean;
  tariff_description?: string;
  conflict?: boolean;
}

const FUZZY_AUTO_THRESHOLD = 0.85;
const FUZZY_SUGGEST_THRESHOLD = 0.7;

function descSimilarity(a: string, b: string): number {
  const wordsA = normalizeDesc(a).split(" ").filter((w) => w.length > 2);
  const wordsB = normalizeDesc(b).split(" ").filter((w) => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;
  const matches = wordsA.filter((w) => wordsB.includes(w)).length;
  return matches / Math.max(wordsA.length, wordsB.length);
}

function partMatch(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  return 0;
}

export function supplierExactMatch(
  supplierNorm: string,
  desc: string,
  index: SupplierLookupIndex,
  partNumber?: string,
  modelNumber?: string,
): SupplierMatchResult | null {
  const rows = index.bySupplier[supplierNorm];
  if (!rows?.length) return null;
  const normDesc = normalizeDesc(desc);

  const candidates = rows.filter((r) => {
    if (!r.approved_by_clerk) return false;
    if (r.normalized_description !== normDesc) return false;
    if (partNumber && r.part_number && r.part_number.toLowerCase() !== partNumber.toLowerCase()) return false;
    if (modelNumber && r.model_number && r.model_number.toLowerCase() !== modelNumber.toLowerCase()) return false;
    return true;
  });

  if (!candidates.length) return null;

  const conflict = new Set(candidates.map((c) => c.hs_code)).size > 1;
  const best = candidates.sort((a, b) => b.usage_count - a.usage_count)[0];

  return {
    code: best.hs_code,
    duty: best.duty_rate,
    desc: best.tariff_description || desc,
    match_type: "Supplier Exact",
    source: "supplier_exact",
    confidence: 1,
    needs_review: false,
    history_id: best.id,
    usage_count: best.usage_count,
    last_used_at: best.last_used_at,
    clerk_approved: true,
    tariff_description: best.tariff_description,
    conflict,
  };
}

export function supplierFuzzyMatch(
  supplierNorm: string,
  desc: string,
  index: SupplierLookupIndex,
  partNumber?: string,
  modelNumber?: string,
): SupplierMatchResult | null {
  const rows = index.bySupplier[supplierNorm];
  if (!rows?.length) return null;

  let best: SupplierHistoryRow | null = null;
  let bestScore = 0;

  for (const row of rows) {
    if (!row.approved_by_clerk) continue;
    const descScore = descSimilarity(desc, row.item_description);
    const partScore = partMatch(partNumber, row.part_number) || partMatch(modelNumber, row.model_number);
    const score = partScore > 0 ? descScore * 0.6 + partScore * 0.4 : descScore;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || bestScore < FUZZY_SUGGEST_THRESHOLD) return null;

  const autoApprove = bestScore >= FUZZY_AUTO_THRESHOLD;
  const conflictRows = rows.filter(
    (r) =>
      r.approved_by_clerk &&
      descSimilarity(desc, r.item_description) >= FUZZY_SUGGEST_THRESHOLD &&
      r.hs_code !== best!.hs_code,
  );
  const conflict = conflictRows.length > 0;

  return {
    code: best.hs_code,
    duty: best.duty_rate,
    desc: best.tariff_description || desc,
    match_type: "Supplier Fuzzy",
    source: "supplier_fuzzy",
    confidence: Math.round(bestScore * 100) / 100,
    needs_review: !autoApprove || conflict,
    history_id: best.id,
    usage_count: best.usage_count,
    last_used_at: best.last_used_at,
    clerk_approved: true,
    tariff_description: best.tariff_description,
    conflict,
  };
}

export interface ClassifyCascadeResult extends TariffEntry {
  source: "database" | "learned" | "supplier_exact" | "supplier_fuzzy";
  learned?: boolean;
  match_type: MatchTypeLabel;
  confidence: number;
  needs_review: boolean;
  needs_ai: boolean;
  supplier_history_id?: number;
  supplier_usage_count?: number;
  supplier_last_used_at?: string;
  supplier_clerk_approved?: boolean;
  classification_conflict?: boolean;
  competing_headings?: string[];
  why_rejected?: string[];
  heading_considered?: string;
  requires_clerk_review?: boolean;
}

export interface ClassifyCascadeInput {
  desc: string;
  supplierName?: string;
  partNumber?: string;
  modelNumber?: string;
  learnedDb?: LearnedLookup;
  supplierIndex?: SupplierLookupIndex;
}

/**
 * Classification cascade:
 * 1. Supplier exact → 2. Supplier fuzzy → 3. Learned rules → (AI on client)
 */
export function classifyCascade(input: ClassifyCascadeInput): ClassifyCascadeResult | null {
  const { desc, supplierName, partNumber, modelNumber, learnedDb = {}, supplierIndex } = input;
  const supplierNorm = supplierName ? normalizeSupplierName(supplierName) : "";

  if (supplierNorm && supplierIndex) {
    const exact = supplierExactMatch(supplierNorm, desc, supplierIndex, partNumber, modelNumber);
    if (exact) {
      return {
        code: exact.code,
        desc: exact.desc,
        duty: exact.duty,
        source: "supplier_exact",
        match_type: "Supplier Exact",
        confidence: exact.confidence,
        needs_review: exact.needs_review,
        needs_ai: false,
        supplier_history_id: exact.history_id,
        supplier_usage_count: exact.usage_count,
        supplier_last_used_at: exact.last_used_at,
        supplier_clerk_approved: exact.clerk_approved,
        classification_conflict: exact.conflict,
      };
    }

    const fuzzy = supplierFuzzyMatch(supplierNorm, desc, supplierIndex, partNumber, modelNumber);
    if (fuzzy) {
      return {
        code: fuzzy.code,
        desc: fuzzy.desc,
        duty: fuzzy.duty,
        source: "supplier_fuzzy",
        match_type: "Supplier Fuzzy",
        confidence: fuzzy.confidence,
        needs_review: fuzzy.needs_review,
        needs_ai: false,
        supplier_history_id: fuzzy.history_id,
        supplier_usage_count: fuzzy.usage_count,
        supplier_last_used_at: fuzzy.last_used_at,
        supplier_clerk_approved: fuzzy.clerk_approved,
        classification_conflict: fuzzy.conflict,
      };
    }
  }

  const learned = learnedMatch(desc, learnedDb);
  if (learned) {
    return {
      code: learned.tariff_code,
      desc,
      duty: learned.duty_rate,
      source: "learned",
      learned: true,
      match_type: "Learning Rules",
      confidence: 0.9,
      needs_review: false,
      needs_ai: false,
    };
  }

  return null;
}

export { FUZZY_AUTO_THRESHOLD, FUZZY_SUGGEST_THRESHOLD };
