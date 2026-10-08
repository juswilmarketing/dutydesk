import type { DutyDeskJobType } from "@pas/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { hasJobContent, isJobState, pickJobState, type JobState } from "@/lib/job-state";
import { enqueuePendingClose, readPendingClosesForUser, removePendingClose } from "@/lib/job-close-queue";
import { clearActiveJob } from "@/lib/session-reset";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useJobSyncStore } from "@/stores/job-sync-store";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;
const NOT_SAVED_RETRYING = "Not saved — retrying";
const TOO_LARGE_MESSAGE = "This job is too large to save to the server. It is kept in this browser only.";
const CLOSED_ELSEWHERE_MESSAGE =
  "This job was already sent or closed in another tab. The screen has been cleared.";

export const START_NEW_JOB_CONFIRM =
  "Discard this job and start a new one? The current invoice, classifications and tax entries will be cleared.";

export type FinishJobInput =
  | { status: "sent"; jobType: DutyDeskJobType; worksheetNum: string }
  | { status: "abandoned" };

let currentJobId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let suspended = false;
/** Owner of this session's pending closes. Entries queued by other users are never touched. */
let currentUserId: number | null = null;
/** Bumped by resetJobSync(); async work that started under an older generation must not touch module state. */
let generation = 0;

export function setJobSyncUser(userId: number | null) {
  currentUserId = userId;
}

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

/** Retry the current user's queued closes. Returns ids that are still pending (server unreachable). */
async function flushPendingJobCloses(): Promise<Set<string>> {
  const stillPending = new Set<string>();
  if (currentUserId === null) return stillPending;
  const gen = generation;
  const entries = readPendingClosesForUser(localStorage, currentUserId);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // The session changed mid-flush: any further call would carry the new user's cookie. Stop touching the
    // queue and report this and every later entry as still pending.
    const abortIfStale = () => {
      if (gen === generation) return false;
      for (const rest of entries.slice(i)) stillPending.add(rest.jobId);
      return true;
    };
    if (abortIfStale()) return stillPending;
    try {
      if (entry.status === "sent") {
        try {
          await api.markJobSent(entry.jobId, { jobType: entry.jobType, worksheetNum: entry.worksheetNum });
        } catch (err) {
          if (abortIfStale()) return stillPending;
          // 400: the server rejected the payload before touching the job, so it is still an open draft.
          // Abandon it so a later autosave or hydrate can never reopen a job the user already sent.
          if (err instanceof ApiError && err.status === 400) {
            await api.abandonJob(entry.jobId);
          } else {
            throw err;
          }
        }
      } else {
        await api.abandonJob(entry.jobId);
      }
      if (abortIfStale()) return stillPending;
      removePendingClose(localStorage, entry.jobId);
    } catch (err) {
      if (abortIfStale()) return stillPending;
      // 404: job is gone. Anything else (network, 5xx, ...) keeps the close queued.
      if (err instanceof ApiError && err.status === 404) {
        removePendingClose(localStorage, entry.jobId);
      } else {
        stillPending.add(entry.jobId);
      }
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
  const gen = generation;

  // Never write into a draft that is still waiting to be closed as sent/abandoned.
  if (currentUserId !== null && readPendingClosesForUser(localStorage, currentUserId).length > 0) {
    const stillPending = await flushPendingJobCloses();
    if (gen !== generation) return;
    if (stillPending.size > 0) {
      sync.setSaveState("error", NOT_SAVED_RETRYING);
      schedule(RETRY_DELAY_MS);
      return;
    }
  }

  sync.setSaveState("saving");
  try {
    const res = await api.saveCurrentJob(state, useWorkflowStore.getState().serverJobId);
    if (gen !== generation) return;
    currentJobId = res.id;
    useWorkflowStore.getState().setServerJobId(res.id);
    useJobSyncStore.getState().setSaveState("saved");
  } catch (err) {
    if (gen !== generation) return;
    if (err instanceof ApiError && err.status === 413) {
      useJobSyncStore.getState().setSaveState("error", TOO_LARGE_MESSAGE);
      return;
    }
    // Another tab or device already sent/closed this job: saving again would reopen it, so drop it here too.
    if (err instanceof ApiError && err.status === 409 && err.code === "job_closed") {
      clearActiveJob();
      currentJobId = null;
      useJobSyncStore.getState().setSaveState("closed", CLOSED_ELSEWHERE_MESSAGE);
      return;
    }
    useJobSyncStore.getState().setSaveState("error", NOT_SAVED_RETRYING);
    schedule(RETRY_DELAY_MS);
  }
}

/** Serialises saves. The chain never rejects: an unexpected failure is surfaced and retried instead. */
function enqueueSave(): Promise<void> {
  chain = chain.then(saveNow).catch((err) => {
    console.error("[job-sync] autosave failed", err);
    try {
      useJobSyncStore.getState().setSaveState("error", NOT_SAVED_RETRYING);
    } catch {
      // Status reporting must never break the chain.
    }
    schedule(RETRY_DELAY_MS);
  });
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

/** Forget per-user module state (e.g. on logout). Leaves the pending-close queue alone: it must survive. */
export function resetJobSync() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  currentJobId = null;
  currentUserId = null;
  generation++;
}

export async function hydrateJobFromServer(): Promise<void> {
  const gen = generation;
  const pending = await flushPendingJobCloses();
  if (gen !== generation) return;
  const { job } = await api.getCurrentJob();
  if (gen !== generation) return;
  if (!job || pending.has(job.id)) return;
  const workflow = useWorkflowStore.getState();
  if (hasJobContent(currentState())) {
    // Local work that already belongs to a server job keeps that id, so a closed one is rejected on save.
    if (workflow.serverJobId === null) workflow.setServerJobId(job.id);
    currentJobId = useWorkflowStore.getState().serverJobId;
    return;
  }
  currentJobId = job.id;
  if (isJobState(job.state)) {
    applyJobState(job.state);
    workflow.setServerJobId(job.id);
  }
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
    // Without a known owner the close could be flushed under the wrong session, so it is not queued.
    const userId = currentUserId;
    let queued = false;
    if (jobId !== null && userId !== null) {
      enqueuePendingClose(localStorage, { jobId, userId, ...close });
      queued = true;
    }
    clearActiveJob();
    currentJobId = null;
    useJobSyncStore.getState().setSaveState("idle");
    if (queued) await flushPendingJobCloses();
  } finally {
    suspended = false;
  }
}
