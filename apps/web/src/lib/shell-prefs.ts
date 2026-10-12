export function effectiveCollapsed(pref: boolean | null, isDesktop: boolean): boolean {
  return pref ?? !isDesktop;
}

export function greetingFor(date: Date, fullName: string | undefined): string {
  const hour = date.getHours();
  const part = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}
