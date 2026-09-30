export function syntheticEconomyZone(definition: unknown): string | null {
  if (typeof definition !== "object" || definition === null) return null;
  const rule = definition as Record<string, unknown>;
  if (
    rule.mode !== "synthetic" ||
    typeof rule.timeZone !== "string" ||
    rule.timeZone.length > 80
  )
    return null;
  if (
    typeof rule.acceptance !== "object" ||
    rule.acceptance === null ||
    (rule.acceptance as Record<string, unknown>).enabled !== true
  )
    return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: rule.timeZone });
  } catch {
    return null;
  }
  return rule.timeZone;
}

export function acceptanceSeason(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
