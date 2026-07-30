export interface ActivityLogEntry {
  id: string;
  at: string;
  message: string;
  actor?: string;
}

const KEY_PREFIX = "dutydesk_activity_v1:";

function keyFor(worksheetNum: string) {
  return `${KEY_PREFIX}${(worksheetNum || "default").toLowerCase()}`;
}

export function loadActivity(worksheetNum: string): ActivityLogEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(worksheetNum));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function logActivity(worksheetNum: string, message: string, actor?: string): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    message,
    actor,
  };
  const existing = loadActivity(worksheetNum);
  const next = [entry, ...existing].slice(0, 100);
  try {
    localStorage.setItem(keyFor(worksheetNum), JSON.stringify(next));
  } catch {
    /* storage full — non-critical */
  }
  return entry;
}

/** Append several activity messages at once (keeps distinct timestamps/order). */
export function logActivityBatch(worksheetNum: string, messages: string[], actor?: string) {
  messages.forEach((m) => logActivity(worksheetNum, m, actor));
}
