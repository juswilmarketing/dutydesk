import { describe, expect, it } from "vitest";
import {
  detectChargeFromDescription,
  isNonProductInvoiceLine,
  normalizeParsedItem,
  parseInvoicesFromModelText,
  parseMoney,
  reconcileInvoiceItems,
  roundMoney,
} from "./invoice-parse";

describe("invoice-parse", () => {
  it("parseMoney handles commas and currency symbols", () => {
    expect(parseMoney("1,234.56")).toBe(1234.56);
    expect(parseMoney("$99.00")).toBe(99);
  });

  it("prefers line_total over rounded unit_price on scans", () => {
    const item = normalizeParsedItem({
      description: "Widget",
      qty: 3,
      unit_price: 33.33,
      line_total: 100,
    });
    expect(item?.line_total).toBe(100);
    expect(item?.unit_price).toBeCloseTo(100 / 3, 5);
  });

  it("accepts extension/amount aliases for line total", () => {
    const item = normalizeParsedItem({
      description: "Part",
      qty: 2,
      extension: 50.5,
    });
    expect(item?.line_total).toBe(50.5);
  });

  it("reconciles penny drift against goods_subtotal", () => {
    const items = [
      { description: "A", qty: 1, unit: "EA", unit_price: 10, line_total: 10 },
      { description: "B", qty: 1, unit: "EA", unit_price: 20.01, line_total: 20.01 },
    ];
    const { items: fixed } = reconcileInvoiceItems(items, 30.01);
    const sum = roundMoney(fixed.reduce((s, it) => s + it.line_total, 0));
    expect(sum).toBe(30.01);
  });

  it("allows empty page-range batches without throwing", () => {
    expect(
      parseInvoicesFromModelText(
        JSON.stringify({
          invoices: [{ invoice_number: "X", items: [], charges: [] }],
        }),
        { allowEmpty: true },
      ),
    ).toEqual([]);
  });

  it("does not treat product descriptions containing delivery as freight", () => {
    expect(isNonProductInvoiceLine("Delivery Charges")).toBe(true);
    expect(isNonProductInvoiceLine("5 oz Sauce Bottle for sauce delivery")).toBe(false);
    expect(isNonProductInvoiceLine("Documents")).toBe(true);
  });

  it("moves import surcharge from items into charges", () => {
    const invoices = parseInvoicesFromModelText(
      JSON.stringify({
        invoices: [
          {
            invoice_number: "1",
            goods_subtotal: 100,
            invoice_total: 115,
            charges: [],
            items: [
              { description: "Widget A", qty: 1, unit_price: 100, line_total: 100 },
              { description: "Import Surcharge", qty: 1, unit_price: 15, line_total: 15 },
            ],
          },
        ],
      }),
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items.map((i) => i.description)).toEqual(["Widget A"]);
    expect(invoices[0].charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "other", label: "Import Surcharge", amount: 15 }),
      ]),
    );
  });

  it("harvests invoice totals from total/subtotal rows when top-level fields are missing", () => {
    const invoices = parseInvoicesFromModelText(
      JSON.stringify({
        invoices: [
          {
            invoice_number: "TR-1",
            goods_subtotal: null,
            invoice_total: null,
            charges: [],
            items: [
              { description: "275/50R19 BS ALNZ SPT AS", qty: 2, unit_price: 317.02, line_total: 634.04 },
              { description: "FUEL SURCHARGE", qty: 1, unit_price: 12.5, line_total: 12.5 },
              { description: "SUBTOTAL", qty: 1, unit_price: 634.04, line_total: 634.04 },
              { description: "TOTAL AMOUNT DUE", qty: 1, unit_price: 646.54, line_total: 646.54 },
            ],
          },
        ],
      }),
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items.map((i) => i.description)).toEqual(["275/50R19 BS ALNZ SPT AS"]);
    expect(invoices[0].goods_subtotal).toBe(634.04);
    expect(invoices[0].invoice_total).toBe(646.54);
    expect(invoices[0].charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "FUEL SURCHARGE", amount: 12.5 }),
      ]),
    );
  });

  it("does not treat TOTAL AMOUNT DUE as a CIF charge", () => {
    const invoices = parseInvoicesFromModelText(
      JSON.stringify({
        invoices: [
          {
            invoice_number: "2",
            items: [
              { description: "Widget", qty: 1, unit_price: 100, line_total: 100 },
              { description: "TOTAL AMOUNT DUE", qty: 1, unit_price: 100, line_total: 100 },
            ],
          },
        ],
      }),
    );
    expect(invoices[0].charges).toEqual([]);
    expect(invoices[0].invoice_total).toBe(100);
    expect(invoices[0].goods_subtotal).toBe(100);
  });
});
