import { describe, expect, it } from "vitest";
import {
  PENDING_JOB_CLOSE_KEY,
  enqueuePendingClose,
  readPendingCloses,
  removePendingClose,
  type KeyValueStorage,
} from "./job-close-queue";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("job close queue", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readPendingCloses(memoryStorage())).toEqual([]);
  });

  it("returns an empty list for corrupt data", () => {
    expect(readPendingCloses(memoryStorage({ [PENDING_JOB_CLOSE_KEY]: "{oops" }))).toEqual([]);
  });

  it("ignores malformed entries and keeps valid pending closes", () => {
    const validAbandoned = { jobId: "c", status: "abandoned" as const };
    const validSent = {
      jobId: "d",
      status: "sent" as const,
      jobType: "brokerage_clearance" as const,
      worksheetNum: "WS-4",
    };
    const raw = [
      null,
      { jobId: "a", status: "draft" },
      { jobId: "b", status: "sent", jobType: "other", worksheetNum: "WS" },
      validAbandoned,
      validSent,
    ];
    expect(readPendingCloses(memoryStorage({ [PENDING_JOB_CLOSE_KEY]: JSON.stringify(raw) }))).toEqual([
      validAbandoned,
      validSent,
    ]);
  });

  it("enqueues and replaces entries with the same job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "a", status: "sent", jobType: "classification_only", worksheetNum: "WS-1" });
    enqueuePendingClose(storage, { jobId: "b", status: "abandoned" });
    expect(readPendingCloses(storage)).toEqual([
      { jobId: "a", status: "sent", jobType: "classification_only", worksheetNum: "WS-1" },
      { jobId: "b", status: "abandoned" },
    ]);
  });

  it("removes an entry by job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "b", status: "abandoned" });
    removePendingClose(storage, "a");
    expect(readPendingCloses(storage)).toEqual([{ jobId: "b", status: "abandoned" }]);
  });
});
