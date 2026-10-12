import type { ClassificationRecommendationCandidate, LineItem } from "@pas/shared-types";
import { normalizeDesc } from "@pas/tariff-data";
import { isAutoApplyable, isLineApplied, recommendationCandidates } from "./classification-helpers";

export const GENERATION_CONCURRENCY = 4;

const TERMINAL_STATUSES = new Set(["Failed", "Needs Manual Review"]);

/** Runs `worker` over `items` with at most `limit` in flight. A worker that throws does not stop the others. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onError?: (item: T, error: unknown) => void,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await worker(item);
      } catch (error) {
        onError?.(item, error);
      }
    }
  });
  await Promise.all(runners);
}

export function needsSuggestion(item: LineItem): boolean {
  if (!item.desc?.trim()) return false;
  if (item.classification_recommendation) return false;
  if (isLineApplied(item)) return false;
  return !TERMINAL_STATUSES.has(item.classification_status || "");
}

export function duplicateKey(item: LineItem): string {
  const desc = normalizeDesc(item.desc || "");
  if (!desc) return `id:${item.id}`;
  return `${desc}|${String(item.part_number || "").trim().toUpperCase()}`;
}

export interface DuplicateGroup {
  leader: LineItem;
  followers: LineItem[];
}

/** First line of each duplicate set leads; the rest reuse its suggestion. */
export function groupDuplicates(items: readonly LineItem[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const item of items) {
    const key = duplicateKey(item);
    const group = groups.get(key);
    if (group) group.followers.push(item);
    else groups.set(key, { leader: item, followers: [] });
  }
  return [...groups.values()];
}

export interface ClassificationProgress {
  total: number;
  ready: number;
  failed: number;
  complete: boolean;
}

export function classificationProgress(
  items: readonly LineItem[],
  busyIds: ReadonlySet<number>,
): ClassificationProgress {
  let ready = 0;
  let failed = 0;
  let busy = false;
  for (const item of items) {
    if (busyIds.has(item.id)) busy = true;
    const status = item.classification_status || "";
    if (status === "Failed" && !item.classification_recommendation) failed += 1;
    if (
      !item.desc?.trim() ||
      item.classification_recommendation ||
      isLineApplied(item) ||
      TERMINAL_STATUSES.has(status)
    ) {
      ready += 1;
    }
  }
  return { total: items.length, ready, failed, complete: ready === items.length && !busy };
}

export interface StrongMatch {
  item: LineItem;
  candidate: ClassificationRecommendationCandidate;
}

export function strongMatches(items: readonly LineItem[]): StrongMatch[] {
  return items.flatMap((item) => {
    if (isLineApplied(item)) return [];
    const candidate = recommendationCandidates(item.classification_recommendation)[0];
    return candidate && isAutoApplyable(item, candidate) ? [{ item, candidate }] : [];
  });
}

export function splitQueue(items: readonly LineItem[]): { exceptions: LineItem[]; applied: LineItem[] } {
  const exceptions: LineItem[] = [];
  const applied: LineItem[] = [];
  for (const item of items) (isLineApplied(item) ? applied : exceptions).push(item);
  return { exceptions, applied };
}

export function shouldOfferStrongConfirm(
  progress: ClassificationProgress,
  strongCount: number,
  alreadyOffered: boolean,
): boolean {
  return progress.complete && strongCount > 0 && !alreadyOffered;
}

export function strongConfirmTitle(count: number): string {
  return count === 1
    ? "1 line is a strong match. Apply it?"
    : `${count} lines are strong matches. Apply them?`;
}

export function batchApplySummary(result: { applied: number; skipped: number; failed: number }): string {
  const parts: string[] = [];
  if (result.applied) parts.push(`Applied ${result.applied} line${result.applied === 1 ? "" : "s"}`);
  if (result.skipped) parts.push(`${result.skipped} not strong match${result.skipped === 1 ? "" : "es"}, review individually`);
  if (result.failed) parts.push(`${result.failed} failed, see the line for the reason`);
  return parts.length ? `${parts.join(" · ")}.` : "Nothing to apply.";
}
