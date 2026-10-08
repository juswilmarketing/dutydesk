import { describe, expect, it } from "vitest";
import { MAX_JOB_STATE_BYTES, parseClosePayload, parseDraftPayload } from "./duty-jobs";

describe("parseDraftPayload", () => {
  it("rejects a non-object body", () => {
    expect(parseDraftPayload(null)).toEqual({ ok: false, status: 400, error: "Missing job state" });
  });

  it("rejects state without an invoices array", () => {
    expect(parseDraftPayload({ state: { invoices: "x" } })).toEqual({
      ok: false,
      status: 400,
      error: "Job state must include an invoices array",
    });
  });

  it("rejects state larger than the limit", () => {
    const big = "x".repeat(MAX_JOB_STATE_BYTES);
    const result = parseDraftPayload({ state: { invoices: [{ filename: big }] } });
    expect(result).toEqual({ ok: false, status: 413, error: "Job is too large to save" });
  });

  it("extracts worksheet number and consignee from valid state", () => {
    const state = {
      invoices: [{ id: 1 }],
      taxInputs: { worksheetNum: "  WS-100 " },
      activeConsigneeId: "c_1",
    };
    expect(parseDraftPayload({ state })).toEqual({
      ok: true,
      stateJson: JSON.stringify(state),
      worksheetNum: "WS-100",
      consigneeId: "c_1",
      jobId: null,
    });
  });

  it("uses nulls when worksheet number and consignee are blank", () => {
    const result = parseDraftPayload({ state: { invoices: [], taxInputs: { worksheetNum: "" } } });
    expect(result).toMatchObject({ ok: true, worksheetNum: null, consigneeId: null });
  });

  it("accepts an optional job id", () => {
    expect(parseDraftPayload({ state: { invoices: [] }, jobId: "j_1" })).toMatchObject({ ok: true, jobId: "j_1" });
  });

  it("treats a missing, null or blank job id as a new job", () => {
    expect(parseDraftPayload({ state: { invoices: [] } })).toMatchObject({ ok: true, jobId: null });
    expect(parseDraftPayload({ state: { invoices: [] }, jobId: null })).toMatchObject({ ok: true, jobId: null });
    expect(parseDraftPayload({ state: { invoices: [] }, jobId: "  " })).toMatchObject({ ok: true, jobId: null });
  });

  it("rejects a non-string job id", () => {
    expect(parseDraftPayload({ state: { invoices: [] }, jobId: 42 })).toEqual({
      ok: false,
      status: 400,
      error: "Invalid job id",
    });
  });
});

describe("parseClosePayload", () => {
  it("accepts an empty body", () => {
    expect(parseClosePayload(undefined)).toEqual({ ok: true, jobType: null, worksheetNum: null });
  });

  it("accepts a valid job type and worksheet number", () => {
    expect(parseClosePayload({ jobType: "brokerage_clearance", worksheetNum: " WS-9 " })).toEqual({
      ok: true,
      jobType: "brokerage_clearance",
      worksheetNum: "WS-9",
    });
  });

  it("rejects an unknown job type", () => {
    expect(parseClosePayload({ jobType: "other" })).toEqual({ ok: false, error: "Invalid job type" });
  });
});
