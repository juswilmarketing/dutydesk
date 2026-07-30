const FLOWBOARD_API_URL =
  (import.meta.env.VITE_FLOWBOARD_API_URL as string | undefined) ||
  "https://flowboardtt.mwilson-561.workers.dev";

const FLOWBOARD_OPS_URL =
  (import.meta.env.VITE_FLOWBOARD_OPS_URL as string | undefined) ||
  "https://flowboard-ops.mwilson-561.workers.dev";

export type FlowboardJobSummary = {
  id: string;
  reference: string;
  title: string;
  customerName: string;
  customerEmail?: string;
  columnId?: string;
  status?: string;
  publicStatus?: string;
};

export function getFlowBoardTaskId(): string | undefined {
  return sessionStorage.getItem("flowboard:taskId") || sessionStorage.getItem("flowboard:jobId") || undefined;
}

export function getFlowBoardJobId(): string | undefined {
  return sessionStorage.getItem("flowboard:jobId") || sessionStorage.getItem("flowboard:taskId") || undefined;
}

export function getFlowBoardProjectId(): string | undefined {
  return sessionStorage.getItem("flowboard:projectId") || undefined;
}

export function setFlowBoardContext(jobOrTaskId: string, projectId?: string) {
  sessionStorage.setItem("flowboard:jobId", jobOrTaskId);
  sessionStorage.setItem("flowboard:taskId", jobOrTaskId);
  if (projectId) sessionStorage.setItem("flowboard:projectId", projectId);
}

export function openFlowboardJobCard(jobId?: string) {
  const id = jobId || getFlowBoardJobId();
  if (!id) {
    window.open(FLOWBOARD_OPS_URL, "_blank", "noopener");
    return;
  }
  window.open(`${FLOWBOARD_OPS_URL.replace(/\/$/, "")}/app/jobs/${id}`, "_blank", "noopener");
}

/** @deprecated Prefer openFlowboardJobCard */
export function openInFlowBoard(jobOrTaskId?: string, _projectId?: string) {
  openFlowboardJobCard(jobOrTaskId);
}

export function flowboardReferenceFor(worksheetNum: string, taskId?: string): string {
  if (taskId) return `FB-${taskId.slice(0, 8).toUpperCase()}`;
  return `FB-${worksheetNum.replace(/\W/g, "").slice(0, 12).toUpperCase() || Date.now().toString(36).toUpperCase()}`;
}

export function getFlowBoardAppUrl() {
  return FLOWBOARD_API_URL;
}

export function getFlowBoardOpsUrl() {
  return FLOWBOARD_OPS_URL;
}

export function resolveFlowboardJobUrl(jobId?: string, relativeUrl?: string) {
  if (relativeUrl?.startsWith("http")) return relativeUrl;
  if (relativeUrl) return `${FLOWBOARD_OPS_URL.replace(/\/$/, "")}${relativeUrl}`;
  if (jobId) return `${FLOWBOARD_OPS_URL.replace(/\/$/, "")}/app/jobs/${jobId}`;
  return FLOWBOARD_OPS_URL;
}
