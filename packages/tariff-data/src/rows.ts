import tariffJson from "../data/tariff.json";

export type TariffRow = { code: string; desc: string; duty: string };

const TT_TARIFF: TariffRow[] = tariffJson as TariffRow[];

export function getTariffCount(): number {
  return TT_TARIFF.length;
}

export function getTariffRows(): readonly TariffRow[] {
  return TT_TARIFF;
}

export { TT_TARIFF };
