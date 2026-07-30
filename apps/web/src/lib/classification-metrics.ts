const METRICS_KEY = "dutydesk_classification_metrics_v1";

export interface ClassificationMetrics {
  supplierHistoryHits: number;
  learnedRuleHits: number;
  aiClassified: number;
  manualReview: number;
  totalLines: number;
  tokensSavedEstimate: number;
  lastUpdated: string;
}

const empty: ClassificationMetrics = {
  supplierHistoryHits: 0,
  learnedRuleHits: 0,
  aiClassified: 0,
  manualReview: 0,
  totalLines: 0,
  tokensSavedEstimate: 0,
  lastUpdated: new Date().toISOString(),
};

export function loadClassificationMetrics(): ClassificationMetrics {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    if (!raw) return { ...empty };
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return { ...empty };
  }
}

export function recordClassificationBatch(stats: Partial<ClassificationMetrics>) {
  const current = loadClassificationMetrics();
  const next: ClassificationMetrics = {
    supplierHistoryHits: current.supplierHistoryHits + (stats.supplierHistoryHits ?? 0),
    learnedRuleHits: current.learnedRuleHits + (stats.learnedRuleHits ?? 0),
    aiClassified: current.aiClassified + (stats.aiClassified ?? 0),
    manualReview: current.manualReview + (stats.manualReview ?? 0),
    totalLines: current.totalLines + (stats.totalLines ?? 0),
    tokensSavedEstimate: current.tokensSavedEstimate + (stats.tokensSavedEstimate ?? 0),
    lastUpdated: new Date().toISOString(),
  };
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify(next));
  } catch {
    /* non-critical */
  }
  return next;
}

export function classificationAccuracyEstimate(m: ClassificationMetrics): number {
  const auto = m.supplierHistoryHits + m.learnedRuleHits;
  if (m.totalLines === 0) return 0;
  return Math.round((auto / m.totalLines) * 100);
}
