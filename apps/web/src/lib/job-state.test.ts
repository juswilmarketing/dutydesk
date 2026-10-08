import { describe, expect, it } from "vitest";
import type { BrokerageInputs, Invoice, TaxInputs } from "@pas/shared-types";
import { emptyJobState, hasJobContent, isJobState, pickJobState } from "./job-state";

const taxInputs = { worksheetNum: "WS-1" } as TaxInputs;
const brokerageInputs = { cifUSD: "" } as BrokerageInputs;
const invoice = { id: 1, filename: "a.pdf" } as Invoice;

describe("pickJobState", () => {
  it("keeps only job fields", () => {
    const state = pickJobState(
      { invoices: [invoice], activeInvId: 1, itemExemptions: {}, learnedMap: { x: {} } } as never,
      { taxInputs, brokerageInputs, approvedTaxSheet: null, activeConsigneeId: "c_1", consignees: [] } as never,
    );
    expect(state).toEqual({
      invoices: [invoice],
      activeInvId: 1,
      itemExemptions: {},
      taxInputs,
      brokerageInputs,
      approvedTaxSheet: null,
      activeConsigneeId: "c_1",
    });
  });
});

describe("hasJobContent", () => {
  it("is true only when invoices are loaded", () => {
    expect(hasJobContent({ invoices: [] })).toBe(false);
    expect(hasJobContent({ invoices: [invoice] })).toBe(true);
  });
});

describe("emptyJobState", () => {
  it("copies defaults so callers cannot mutate them", () => {
    const state = emptyJobState({ taxInputs, brokerageInputs });
    expect(state.invoices).toEqual([]);
    expect(state.taxInputs).toEqual(taxInputs);
    expect(state.taxInputs).not.toBe(taxInputs);
    expect(state.activeConsigneeId).toBeNull();
  });
});

describe("isJobState", () => {
  it("accepts a complete state", () => {
    expect(isJobState(emptyJobState({ taxInputs, brokerageInputs }))).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isJobState(null)).toBe(false);
    expect(isJobState({ invoices: [] })).toBe(false);
    expect(isJobState({ ...emptyJobState({ taxInputs, brokerageInputs }), invoices: "x" })).toBe(false);
  });
});
