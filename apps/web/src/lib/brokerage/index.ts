import type { BrokerageInputs } from "@pas/shared-types";

export interface BrokerageResult {
  c22: number;
  c23: number;
  c24: number;
  c25: number;
  c26: number;
  c27: number;
  d22: number;
  d23: number;
  d24: number;
  d25: number;
  d26: number;
  d27: number;
  d28: number;
  d29: number;
  d30: number;
  d33: number;
  d34: number;
  d35: number;
  d36: number;
  d37: number;
  d38: number;
  d39: number;
  d40: number;
  d42: number;
  d45: number;
  payless: boolean;
  baseChargeOn: boolean;
  discountPct: number;
  brokerageSubtotal: number;
}

export function calculateBrokerage(inputs: BrokerageInputs): BrokerageResult {
  const cif = parseFloat(inputs.cifUSD) || 0;
  const payless = inputs.paylessDiscount === "YES";

  const c22 = 25000;
  const d22 = c22 * 0.02;
  const c23 = Math.min(100000, Math.max(0, cif - c22));
  const d23 = c23 * 0.015;
  const c24 = Math.min(125000, Math.max(0, cif - c22 - c23));
  const d24 = c24 * 0.01;
  const c25 = Math.max(0, cif - c22 - c23 - c24);
  const d25 = c25 * (payless ? 0.0025 : 0.005);
  const c26 = parseFloat(inputs.c26) || 0;
  const d26 = c26 * 0.0025;
  const c27 = parseFloat(inputs.c27) || 0;
  const d27 = c27 * 0.006;
  const baseChargeOn = inputs.baseChargeOn;
  const d28 = baseChargeOn ? 500 : 0;
  const discountPct = parseFloat(inputs.discountPct) || 0;
  const discountFlat = parseFloat(inputs.discount) || 0;
  const brokerageSubtotal = d22 + d23 + d24 + d25 + d26 + d27 + d28;
  const d29 = discountPct > 0 ? -(brokerageSubtotal * discountPct) / 100 : -discountFlat;
  const d30 = d22 + d23 + d24 + d25 + d26 + d27 + d28 + d29;
  const d33 = 50;
  const d34 = 100;
  const d35 = parseFloat(inputs.bdc) || 0;
  const d36 = parseFloat(inputs.userFee) || 0;
  const d37 = parseFloat(inputs.weighBridge) || 0;
  const d38 = parseFloat(inputs.clerkOvertime) || 0;
  const d39 = parseFloat(inputs.customsOvertime) || 0;
  const d40 = parseFloat(inputs.certOrigin) || 0;
  const d42 = d30 + d33 + d34 + d35 + d36 + d37 + d38 + d39 + d40;
  const d45 = 0.125 * d42 + d42;

  return {
    c22,
    c23,
    c24,
    c25,
    c26,
    c27,
    d22,
    d23,
    d24,
    d25,
    d26,
    d27,
    d28,
    d29,
    d30,
    d33,
    d34,
    d35,
    d36,
    d37,
    d38,
    d39,
    d40,
    d42,
    d45,
    payless,
    baseChargeOn,
    discountPct,
    brokerageSubtotal,
  };
}

export function fmtBrokerage(n: number): string {
  return `TT$${n.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const defaultBrokerageInputs = (): BrokerageInputs => ({
  cifUSD: "",
  paylessDiscount: "NO",
  baseChargeOn: true,
  discount: "",
  discountPct: "",
  c26: "",
  c27: "",
  bdc: "0",
  userFee: "0",
  weighBridge: "0",
  clerkOvertime: "0",
  customsOvertime: "0",
  certOrigin: "0",
  custName: "",
  custCompany: "",
  custEmail: "",
  custPhone: "",
  custAddress: "",
  invoiceNo: "",
  commodity: "",
  preparedBy: "",
});
