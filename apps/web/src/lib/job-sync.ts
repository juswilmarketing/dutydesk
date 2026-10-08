import type { DutyDeskJobType } from "@pas/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { hasJobContent, isJobState, pickJobState, type JobState } from "@/lib/job-state";
import { enqueuePendingClose, readPendingCloses, removePendingClose } from "@/lib/job-close-queue";
import { clearActiveJob } from "@/lib/session-reset";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useJobSyncStore } from "@/stores/job-sync-store";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;

export const START_NEW_JOB_CONFIRM =
  "Discard this job and start a new one? The current invoice, classifications and tax entries will be cleared.";

export type FinishJobInput =
  | { status: "sent"; jobType: DutyDeskJobType; worksheetNum: string }
  | { status: "abandoned" };

let currentJobId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let suspended = false;

function currentState(): JobState {
  return pickJobState(useInvoiceStore.getState(), useWorkflowStore.getState());
}

function applyJobState(state: JobState) {
  useInvoiceStore.setState({
    invoices: state.invoices,
    activeInvId: state.activeInvId,
    itemExemptions: state.itemExemptions,
  });
  useWorkflowStore.setState({
    taxInputs: state.taxInputs,
    brokerageInputs: state.brokerageInputs,
    approvedTaxSheet: state.approvedTaxSheet,
    activeConsigneeId: state.activeConsigneeId,
  });
}

/** Retry queued closes. Returns ids that are still pending (server unreachable). */
async function flushPendingJobCloses(): Promise<Set<string>> {
  const stillPending = new Set<string>();
  for (const entry of readPendingCloses(localStorage)) {
    try {
      if (entry.status === "sent") {
        await api.markJobSent(entry.jobId, { jobType: entry.jobType, worksheetNum: entry.worksheetNum });
      } else {
        await api.abandonJob(entry.jobId);
      }
      removePendingClose(localStorage, entry.jobId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) removePendingClose(localStorage, entry.jobId);
      else stillPending.add(entry.jobId);
    }
  }
  return stillPending;
}

function schedule(delay = AUTOSAVE_DELAY_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void enqueueSave();
  }, delay);
}

async function saveNow(): Promise<void> {
  if (suspended) return;
  const state = currentState();
  if (!hasJobContent(state)) return;
  const sync = useJobSyncStore.getState();

  // Never write into a draft that is still waiting to be closed as sent/abandoned.
  if (readPendingCloses(localStorage).length > 0 && (await flushPendingJobCloses()).size > 0) {
    sync.setSaveState("error", "Not saved — retrying");
    schedule(RETRY_DELAY_MS);
    return;
  }

  sync.setSaveState("saving");
  try {
    const res = await api.saveCurrentJob(state);
    currentJobId = res.id;
    useJobSyncStore.getState().setSaveState("saved");
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) {
      useJobSyncStore
        .getState()
        .setSaveState("error", "This job is too large to save to the server. It is kept in this browser only.");
      return;
    }
    useJobSyncStore.getState().setSaveState("error", "Not saved — retrying");
    schedule(RETRY_DELAY_MS);
  }
}

function enqueueSave(): Promise<void> {
  chain = chain.then(saveNow);
  return chain;
}

export async function flushJobAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    await enqueueSave();
    return;
  }
  await chain;
}

export function startJobAutosave(): () => void {
  const unsubInvoices = useInvoiceStore.subscribe((s, prev) => {
    if (s.invoices !== prev.invoices || s.activeInvId !== prev.activeInvId || s.itemExemptions !== prev.itemExemptions) {
      schedule();
    }
  });
  const unsubWorkflow = useWorkflowStore.subscribe((s, prev) => {
    if (
      s.taxInputs !== prev.taxInputs ||
      s.brokerageInputs !== prev.brokerageInputs ||
      s.approvedTaxSheet !== prev.approvedTaxSheet ||
      s.activeConsigneeId !== prev.activeConsigneeId
    ) {
      schedule();
    }
  });
  return () => {
    unsubInvoices();
    unsubWorkflow();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export async function hydrateJobFromServer(): Promise<void> {
  const pending = await flushPendingJobCloses();
  const { job } = await api.getCurrentJob();
  if (!job || pending.has(job.id)) return;
  currentJobId = job.id;
  if (hasJobContent(currentState())) return;
  if (isJobState(job.state)) applyJobState(job.state);
}

/** Close the current job on the server (queued if offline) and clear it from the screen. */
export async function finishJob(close: FinishJobInput): Promise<void> {
  suspended = true;
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await chain;
    let jobId = currentJobId;
    if (!jobId) {
      jobId = (await api.getCurrentJob().catch(() => ({ job: null }))).job?.id ?? null;
    }
    if (jobId) enqueuePendingClose(localStorage, { jobId, ...close });
    clearActiveJob();
    currentJobId = null;
    useJobSyncStore.getState().setSaveState("idle");
    if (jobId) await flushPendingJobCloses();
  } finally {
    suspended = false;
  }
}
