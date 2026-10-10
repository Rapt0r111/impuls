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

export type AcceptanceBonus = {
  code: string;
  title: string;
  xp: number;
  points: number;
};
export type AcceptanceOptions = {
  adjustment: { maxXp: number; maxPoints: number } | null;
  bonuses: AcceptanceBonus[];
};
const OPTION_LIMIT = 1_000_000;
const MAX_LEDGER_AMOUNT = 2_147_483_647;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= OPTION_LIMIT;

// What a reviewer may change at acceptance comes only from the saved rule version. A
// missing or malformed entry disables that option instead of falling back to a default.
export function acceptanceOptions(definition: unknown): AcceptanceOptions {
  const none: AcceptanceOptions = { adjustment: null, bonuses: [] };
  if (typeof definition !== "object" || definition === null) return none;
  const acceptance = (definition as Record<string, unknown>).acceptance;
  if (typeof acceptance !== "object" || acceptance === null) return none;
  const { adjustment, bonuses } = acceptance as Record<string, unknown>;
  const limits =
    typeof adjustment === "object" && adjustment !== null
      ? (adjustment as Record<string, unknown>)
      : null;
  const result: AcceptanceOptions = {
    adjustment:
      limits && isAmount(limits.maxXp) && isAmount(limits.maxPoints)
        ? { maxXp: limits.maxXp, maxPoints: limits.maxPoints }
        : null,
    bonuses: [],
  };
  if (!Array.isArray(bonuses) || bonuses.length > 7) return result;
  const parsed: AcceptanceBonus[] = [];
  for (const item of bonuses) {
    const entry =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : null;
    if (
      !entry ||
      typeof entry.code !== "string" ||
      !/^[a-z][a-z0-9_]{1,39}$/.test(entry.code) ||
      typeof entry.title !== "string" ||
      entry.title.length < 1 ||
      entry.title.length > 80 ||
      !isAmount(entry.xp) ||
      !isAmount(entry.points) ||
      entry.xp + entry.points === 0 ||
      parsed.some((b) => b.code === entry.code)
    )
      return result;
    parsed.push({
      code: entry.code,
      title: entry.title,
      xp: entry.xp,
      points: entry.points,
    });
  }
  return { ...result, bonuses: parsed };
}

export type AwardSelection = {
  baseXp?: number | undefined;
  basePoints?: number | undefined;
  bonusCode?: string | null | undefined;
};
export type ResolvedAward = {
  baseXp: number;
  basePoints: number;
  bonus: AcceptanceBonus | null;
  xp: number;
  points: number;
};
export type AwardRejection =
  | "adjustment_not_allowed"
  | "adjustment_exceeds_limit"
  | "bonus_unknown"
  | "award_too_large";

export function resolveAcceptanceAward(
  options: AcceptanceOptions,
  fund: { xp: number; points: number },
  selection: AwardSelection,
): ({ ok: true } & ResolvedAward) | { ok: false; reason: AwardRejection } {
  const baseXp = selection.baseXp ?? fund.xp;
  const basePoints = selection.basePoints ?? fund.points;
  if (baseXp !== fund.xp || basePoints !== fund.points) {
    if (!options.adjustment)
      return { ok: false, reason: "adjustment_not_allowed" };
    if (
      baseXp > options.adjustment.maxXp ||
      basePoints > options.adjustment.maxPoints
    )
      return { ok: false, reason: "adjustment_exceeds_limit" };
  }
  let bonus: AcceptanceBonus | null = null;
  if (selection.bonusCode != null) {
    bonus = options.bonuses.find((b) => b.code === selection.bonusCode) ?? null;
    if (!bonus) return { ok: false, reason: "bonus_unknown" };
  }
  const xp = baseXp + (bonus?.xp ?? 0);
  const points = basePoints + (bonus?.points ?? 0);
  if (xp > MAX_LEDGER_AMOUNT || points > MAX_LEDGER_AMOUNT)
    return { ok: false, reason: "award_too_large" };
  return { ok: true, baseXp, basePoints, bonus, xp, points };
}

export function acceptanceSeason(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
