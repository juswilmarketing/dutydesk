export function overrideRateText(strongApplied: number, strongOverridden: number): string {
  if (!strongApplied) return "—";
  return `${((strongOverridden / strongApplied) * 100).toFixed(1)}%`;
}
