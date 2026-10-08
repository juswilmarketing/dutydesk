import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@pas/shared-types";

// The stores touch localStorage at import time and node has none, so install one before any module loads.
const memory = vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
  const g = globalThis as unknown as { localStorage: unknown; window: unknown };
  g.localStorage = storage;
  g.window = globalThis; // zustand's persist middleware is a no-op (and warns) without a window
  return { map };
});

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    api: {
      getCurrentJob: vi.fn(),
      saveCurrentJob: vi.fn(),
      markJobSent: vi.fn(),
      abandonJob: vi.fn(),
    },
  };
});

const PENDING_KEY = "dutydesk-pending-job-close";
const TOO_LARGE = "This job is too large to save to the server. It is kept in this browser only.";
const RETRYING = "Not saved — retrying";

const invoices = [{ id: 1 }] as unknown as Invoice[];
const serverState = {
  invoices: [{ id: 7 }],
  activeInvId: 7,
  itemExemptions: {},
  taxInputs: {},
  brokerageInputs: {},
  approvedTaxSheet: null,
  activeConsigneeId: null,
};

type Sync = typeof import("./job-sync");
type ApiModule = typeof import("@/lib/api-client");
type InvoiceModule = typeof import("@/stores/invoice-store");
type JobSyncStoreModule = typeof import("@/stores/job-sync-store");

let sync: Sync;
let api: ApiModule["api"];
let ApiError: ApiModule["ApiError"];
let useInvoiceStore: InvoiceModule["useInvoiceStore"];
let useJobSyncStore: JobSyncStoreModule["useJobSyncStore"];
let stop: (() => void) | null;

function pendingKeys(): string[] {
  return (JSON.parse(memory.map.get(PENDING_KEY) ?? "[]") as { jobId: string }[]).map((e) => e.jobId);
}

function queueClose(entry: Record<string, unknown>) {
  queueCloses({ userId: 1, ...entry });
}

function queueCloses(...entries: Record<string, unknown>[]) {
  memory.map.set(PENDING_KEY, JSON.stringify(entries));
}

function loadInvoices() {
  useInvoiceStore.setState({ invoices, activeInvId: 1 });
}

beforeEach(async () => {
  memory.map.clear();
  vi.useFakeTimers();
  vi.resetModules();
  vi.resetAllMocks(); // the mocked api-client factory result is cached across resetModules()
  sync = await import("./job-sync");
  ({ api, ApiError } = await import("@/lib/api-client"));
  ({ useInvoiceStore } = await import("@/stores/invoice-store"));
  ({ useJobSyncStore } = await import("@/stores/job-sync-store"));
  vi.mocked(api.getCurrentJob).mockResolvedValue({ job: null });
  vi.mocked(api.saveCurrentJob).mockResolvedValue({ id: "j1", updatedAt: "now" });
  vi.mocked(api.markJobSent).mockResolvedValue({ ok: true, status: "sent" });
  vi.mocked(api.abandonJob).mockResolvedValue({ ok: true, status: "abandoned" });
  sync.setJobSyncUser(1);
  stop = null;
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe("autosave", () => {
  it("saves once, 1000 ms after the invoices change", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(999);
    expect(api.saveCurrentJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    expect(useJobSyncStore.getState().saveState).toBe("saved");
  });

  it("never saves a job with no invoices", async () => {
    stop = sync.startJobAutosave();
    useInvoiceStore.setState({ activeInvId: 5 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.saveCurrentJob).not.toHaveBeenCalled();
  });

  it("shows 'Not saved — retrying' on failure and retries after 5000 ms", async () => {
    vi.mocked(api.saveCurrentJob).mockRejectedValueOnce(new ApiError("boom", 500));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useJobSyncStore.getState()).toMatchObject({ saveState: "error", error: RETRYING });
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(2);
    expect(useJobSyncStore.getState().saveState).toBe("saved");
  });

  it("treats a server 409 like any other failure and retries", async () => {
    vi.mocked(api.saveCurrentJob).mockRejectedValueOnce(new ApiError("conflict", 409));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useJobSyncStore.getState().error).toBe(RETRYING);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(2);
  });

  it("keeps a 413 job in the browser only and does not retry", async () => {
    vi.mocked(api.saveCurrentJob).mockRejectedValue(new ApiError("too big", 413));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useJobSyncStore.getState()).toMatchObject({ saveState: "error", error: TOO_LARGE });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
  });

  it("does not write while a close is still queued and the server is unreachable", async () => {
    queueClose({ jobId: "old", status: "abandoned" });
    vi.mocked(api.abandonJob).mockRejectedValue(new ApiError("down", 503));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveCurrentJob).not.toHaveBeenCalled();
    expect(useJobSyncStore.getState().error).toBe(RETRYING);
    vi.mocked(api.abandonJob).mockResolvedValue({ ok: true, status: "abandoned" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    expect(pendingKeys()).toEqual([]);
  });

  describe("when saveNow throws unexpectedly", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    function throwOnceOnSaving() {
      const original = useJobSyncStore.getState().setSaveState;
      let thrown = false;
      useJobSyncStore.setState({
        setSaveState: (state, error) => {
          if (!thrown && state === "saving") {
            thrown = true;
            throw new Error("store exploded");
          }
          original(state, error);
        },
      });
    }

    it("keeps the chain alive: error state, retry after 5000 ms, later save succeeds", async () => {
      throwOnceOnSaving();
      stop = sync.startJobAutosave();
      loadInvoices();
      await vi.advanceTimersByTimeAsync(1000);
      expect(useJobSyncStore.getState()).toMatchObject({ saveState: "error", error: RETRYING });
      expect(api.saveCurrentJob).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith("[job-sync] autosave failed", expect.any(Error));
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
      expect(useJobSyncStore.getState().saveState).toBe("saved");
    });

    it("still lets finishJob close and clear the job", async () => {
      throwOnceOnSaving();
      stop = sync.startJobAutosave();
      loadInvoices();
      vi.mocked(api.getCurrentJob).mockResolvedValue({ job: { id: "j1", state: serverState, updatedAt: "now" } });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(sync.finishJob({ status: "abandoned" })).resolves.toBeUndefined();
      expect(useInvoiceStore.getState().invoices).toEqual([]);
      expect(api.abandonJob).toHaveBeenCalledWith("j1");
    });
  });
});

describe("hydrateJobFromServer", () => {
  const serverJob = { job: { id: "j1", state: serverState, updatedAt: "now" } };

  it("applies the server job when the browser has no invoices", async () => {
    vi.mocked(api.getCurrentJob).mockResolvedValue(serverJob);
    await sync.hydrateJobFromServer();
    expect(useInvoiceStore.getState().invoices).toEqual(serverState.invoices);
    expect(useInvoiceStore.getState().activeInvId).toBe(7);
  });

  it("does not overwrite invoices already loaded in the browser", async () => {
    loadInvoices();
    vi.mocked(api.getCurrentJob).mockResolvedValue(serverJob);
    await sync.hydrateJobFromServer();
    expect(useInvoiceStore.getState().invoices).toEqual(invoices);
  });

  it("skips a job whose close is still pending", async () => {
    queueClose({ jobId: "j1", status: "abandoned" });
    vi.mocked(api.abandonJob).mockRejectedValue(new ApiError("down", 503));
    vi.mocked(api.getCurrentJob).mockResolvedValue(serverJob);
    await sync.hydrateJobFromServer();
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    expect(pendingKeys()).toEqual(["j1"]);
  });

  it("flushes pending closes before fetching the current job", async () => {
    queueClose({ jobId: "j1", status: "sent", jobType: "classification_only", worksheetNum: "W-1" });
    await sync.hydrateJobFromServer();
    expect(api.markJobSent).toHaveBeenCalledWith("j1", { jobType: "classification_only", worksheetNum: "W-1" });
    expect(pendingKeys()).toEqual([]);
    const sentOrder = vi.mocked(api.markJobSent).mock.invocationCallOrder[0];
    const fetchOrder = vi.mocked(api.getCurrentJob).mock.invocationCallOrder[0];
    expect(sentOrder).toBeLessThan(fetchOrder);
  });
});

describe("pending closes", () => {
  const sent = { jobId: "j1", status: "sent", jobType: "classification_only", worksheetNum: "W-1" };

  it("drops a queued sent close when the job is gone (404)", async () => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("gone", 404));
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual([]);
  });

  it("abandons the job when the server rejects a queued sent close (400), removing the entry only afterwards", async () => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("bad payload", 400));
    let queuedDuringAbandon: string[] = [];
    vi.mocked(api.abandonJob).mockImplementation(async () => {
      queuedDuringAbandon = pendingKeys();
      return { ok: true, status: "abandoned" };
    });
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).toHaveBeenCalledWith("j1");
    expect(queuedDuringAbandon).toEqual(["j1"]);
    expect(pendingKeys()).toEqual([]);
  });

  it("removes a rejected sent close when the abandon fallback finds the job gone (404)", async () => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("bad payload", 400));
    vi.mocked(api.abandonJob).mockRejectedValue(new ApiError("gone", 404));
    await sync.hydrateJobFromServer();
    expect(pendingKeys()).toEqual([]);
  });

  it("keeps a rejected sent close queued when the abandon fallback fails", async () => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("bad payload", 400));
    vi.mocked(api.abandonJob).mockRejectedValue(new Error("network down"));
    vi.mocked(api.getCurrentJob).mockResolvedValue({ job: { id: "j1", state: serverState, updatedAt: "now" } });
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).toHaveBeenCalledWith("j1");
    expect(pendingKeys()).toEqual(["j1"]);
    expect(useInvoiceStore.getState().invoices).toEqual([]); // still pending: never re-hydrated
  });

  it.each([500, 503, 409])("keeps a queued close after a transient failure (%i)", async (status) => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("nope", status));
    await sync.hydrateJobFromServer();
    expect(pendingKeys()).toEqual(["j1"]);
  });

  it("unblocks autosave once a permanently rejected close is dropped", async () => {
    queueClose(sent);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("bad payload", 400));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    expect(pendingKeys()).toEqual([]);
  });
});

describe("pending closes owned by another user", () => {
  const theirs = { jobId: "theirs", userId: 2, status: "abandoned" };

  it("neither flushes nor removes another user's entry during hydrate, and does not block autosave", async () => {
    queueCloses(theirs);
    stop = sync.startJobAutosave();
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(api.markJobSent).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual(["theirs"]);
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual(["theirs"]);
  });

  it("flushes and removes the entry once its owner becomes the current user", async () => {
    queueCloses(theirs);
    await sync.hydrateJobFromServer();
    expect(pendingKeys()).toEqual(["theirs"]);
    sync.resetJobSync();
    sync.setJobSyncUser(2);
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).toHaveBeenCalledWith("theirs");
    expect(pendingKeys()).toEqual([]);
  });

  it("processes nothing when there is no current user", async () => {
    queueCloses({ ...theirs, userId: 1 });
    sync.setJobSyncUser(null);
    await sync.hydrateJobFromServer();
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual(["theirs"]);
  });

  it("finishJob with no current user clears the screen and enqueues nothing", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000); // saves as j1
    sync.setJobSyncUser(null);
    await sync.finishJob({ status: "sent", jobType: "classification_only", worksheetNum: "W-3" });
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    expect(memory.map.get(PENDING_KEY) ?? "[]").toBe("[]");
    expect(api.markJobSent).not.toHaveBeenCalled();
    expect(api.abandonJob).not.toHaveBeenCalled();
  });

  it("finishJob stamps the queued close with the current user id", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    vi.mocked(api.abandonJob).mockRejectedValue(new ApiError("down", 503));
    await sync.finishJob({ status: "abandoned" });
    expect(JSON.parse(memory.map.get(PENDING_KEY) ?? "[]")).toEqual([{ jobId: "j1", userId: 1, status: "abandoned" }]);
  });
});
describe("finishJob", () => {
  it("queues the close, clears the screen, closes on the server and dequeues", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000); // saves as j1
    let queuedDuringClose: string[] = [];
    vi.mocked(api.markJobSent).mockImplementation(async () => {
      queuedDuringClose = pendingKeys();
      return { ok: true, status: "sent" };
    });
    await sync.finishJob({ status: "sent", jobType: "brokerage_clearance", worksheetNum: "W-9" });
    expect(queuedDuringClose).toEqual(["j1"]);
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    expect(api.markJobSent).toHaveBeenCalledWith("j1", { jobType: "brokerage_clearance", worksheetNum: "W-9" });
    expect(pendingKeys()).toEqual([]);
    expect(useJobSyncStore.getState().saveState).toBe("idle");
  });

  it("still clears the screen when the server close fails, leaving the close queued", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("down", 503));
    await sync.finishJob({ status: "sent", jobType: "classification_only", worksheetNum: "W-2" });
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    expect(pendingKeys()).toEqual(["j1"]);
  });

  it("does not autosave the cleared job afterwards", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    await sync.finishJob({ status: "abandoned" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
  });
});

describe("resetJobSync", () => {
  it("forgets the current job id so it cannot leak to the next user, but keeps the close queue", async () => {
    vi.mocked(api.getCurrentJob).mockResolvedValue({ job: { id: "j1", state: serverState, updatedAt: "now" } });
    await sync.hydrateJobFromServer(); // currentJobId = j1
    queueClose({ jobId: "other", status: "abandoned" });
    vi.mocked(api.abandonJob).mockRejectedValue(new ApiError("down", 503));
    sync.resetJobSync();
    vi.mocked(api.getCurrentJob).mockResolvedValue({ job: null });
    await sync.finishJob({ status: "abandoned" });
    expect(pendingKeys()).toEqual(["other"]);
  });

  it("cancels a pending autosave timer", async () => {
    stop = sync.startJobAutosave();
    loadInvoices();
    sync.resetJobSync();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.saveCurrentJob).not.toHaveBeenCalled();
  });

  it("ignores a hydrate that was in flight when the session was reset", async () => {
    let resolveJob!: (v: Awaited<ReturnType<typeof api.getCurrentJob>>) => void;
    vi.mocked(api.getCurrentJob).mockReturnValue(new Promise((r) => (resolveJob = r)));
    const hydrating = sync.hydrateJobFromServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getCurrentJob).toHaveBeenCalledTimes(1);
    sync.resetJobSync();
    resolveJob({ job: { id: "old-user-job", state: serverState, updatedAt: "now" } });
    await hydrating;
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    vi.mocked(api.getCurrentJob).mockResolvedValue({ job: null });
    await sync.finishJob({ status: "abandoned" });
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual([]);
  });

  it("does not adopt the job id of a save that was in flight when the session was reset", async () => {
    let resolveSave!: (v: Awaited<ReturnType<typeof api.saveCurrentJob>>) => void;
    vi.mocked(api.saveCurrentJob).mockReturnValue(new Promise((r) => (resolveSave = r)));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    sync.resetJobSync();
    resolveSave({ id: "old-user-job", updatedAt: "now" });
    await vi.advanceTimersByTimeAsync(0);
    useInvoiceStore.setState({ invoices: [], activeInvId: null });
    vi.mocked(api.getCurrentJob).mockResolvedValue({ job: null });
    await sync.finishJob({ status: "abandoned" });
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(pendingKeys()).toEqual([]);
  });

  it("stops flushing the old user's closes when the session changes mid-flush", async () => {
    const a1 = { jobId: "a1", status: "sent", jobType: "classification_only", worksheetNum: "W-1" };
    const a2 = { jobId: "a2", status: "abandoned" };
    queueCloses({ userId: 1, ...a1 }, { userId: 1, ...a2 });
    let rejectSent!: (e: unknown) => void;
    vi.mocked(api.markJobSent).mockReturnValue(new Promise((_, rej) => (rejectSent = rej)));
    const hydrating = sync.hydrateJobFromServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.markJobSent).toHaveBeenCalledTimes(1);
    sync.resetJobSync();
    sync.setJobSyncUser(2);
    // The old user's request, sent under the new session, comes back 404 (jobs are user-scoped).
    rejectSent(new ApiError("gone", 404));
    await hydrating;
    expect(pendingKeys()).toEqual(["a1", "a2"]);
    expect(api.markJobSent).toHaveBeenCalledTimes(1);
    expect(api.abandonJob).not.toHaveBeenCalled();
    expect(api.getCurrentJob).not.toHaveBeenCalled();
  });

  it("does not remove an entry or fall back to abandon when the session changes during a 400 fallback", async () => {
    queueClose({ jobId: "a1", status: "sent", jobType: "classification_only", worksheetNum: "W-1" });
    vi.mocked(api.markJobSent).mockRejectedValue(new ApiError("bad payload", 400));
    let resolveAbandon!: (v: { ok: true; status: "abandoned" }) => void;
    vi.mocked(api.abandonJob).mockReturnValue(new Promise((r) => (resolveAbandon = r)));
    const hydrating = sync.hydrateJobFromServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.abandonJob).toHaveBeenCalledTimes(1);
    sync.resetJobSync();
    sync.setJobSyncUser(2);
    resolveAbandon({ ok: true, status: "abandoned" });
    await hydrating;
    expect(pendingKeys()).toEqual(["a1"]);
  });

  it("does not schedule a retry for a save that failed after the session was reset", async () => {
    let rejectSave!: (e: unknown) => void;
    vi.mocked(api.saveCurrentJob).mockReturnValue(new Promise((_, rej) => (rejectSave = rej)));
    stop = sync.startJobAutosave();
    loadInvoices();
    await vi.advanceTimersByTimeAsync(1000);
    sync.resetJobSync();
    rejectSave(new ApiError("boom", 500));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.saveCurrentJob).toHaveBeenCalledTimes(1);
    expect(useJobSyncStore.getState().saveState).not.toBe("error");
  });
});
