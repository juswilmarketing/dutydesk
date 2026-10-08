import { describe, expect, it } from "vitest";
import {
  PENDING_JOB_CLOSE_KEY,
  enqueuePendingClose,
  readPendingCloses,
  readPendingClosesForUser,
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
    const validAbandoned = { jobId: "c", userId: 1, status: "abandoned" as const };
    const validSent = {
      jobId: "d",
      userId: 1,
      status: "sent" as const,
      jobType: "brokerage_clearance" as const,
      worksheetNum: "WS-4",
    };
    const raw = [
      null,
      { jobId: "a", userId: 1, status: "draft" },
      { jobId: "b", userId: 1, status: "sent", jobType: "other", worksheetNum: "WS" },
      validAbandoned,
      validSent,
    ];
    expect(readPendingCloses(memoryStorage({ [PENDING_JOB_CLOSE_KEY]: JSON.stringify(raw) }))).toEqual([
      validAbandoned,
      validSent,
    ]);
  });

  it("drops entries without a finite numeric userId", () => {
    const valid = { jobId: "ok", userId: 3, status: "abandoned" as const };
    const raw = [
      { jobId: "no-user", status: "abandoned" },
      { jobId: "string-user", userId: "3", status: "abandoned" },
      { jobId: "null-user", userId: null, status: "abandoned" },
      { jobId: "nan-user", userId: Number.NaN, status: "abandoned" },
      { jobId: "sent-no-user", status: "sent", jobType: "classification_only", worksheetNum: "W" },
      valid,
    ];
    expect(readPendingCloses(memoryStorage({ [PENDING_JOB_CLOSE_KEY]: JSON.stringify(raw) }))).toEqual([valid]);
  });

  it("returns only the given user's entries from readPendingClosesForUser", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", userId: 1, status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "b", userId: 2, status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "c", userId: 1, status: "sent", jobType: "classification_only", worksheetNum: "W" });
    expect(readPendingClosesForUser(storage, 1).map((e) => e.jobId)).toEqual(["a", "c"]);
    expect(readPendingClosesForUser(storage, 2).map((e) => e.jobId)).toEqual(["b"]);
    expect(readPendingClosesForUser(storage, 9)).toEqual([]);
  });

  it("enqueues and replaces entries with the same job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", userId: 1, status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "a", userId: 1, status: "sent", jobType: "classification_only", worksheetNum: "WS-1" });
    enqueuePendingClose(storage, { jobId: "b", userId: 1, status: "abandoned" });
    expect(readPendingCloses(storage)).toEqual([
      { jobId: "a", userId: 1, status: "sent", jobType: "classification_only", worksheetNum: "WS-1" },
      { jobId: "b", userId: 1, status: "abandoned" },
    ]);
  });

  it("removes an entry by job id", () => {
    const storage = memoryStorage();
    enqueuePendingClose(storage, { jobId: "a", userId: 1, status: "abandoned" });
    enqueuePendingClose(storage, { jobId: "b", userId: 1, status: "abandoned" });
    removePendingClose(storage, "a");
    expect(readPendingCloses(storage)).toEqual([{ jobId: "b", userId: 1, status: "abandoned" }]);
  });
});
