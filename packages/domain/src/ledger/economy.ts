export function economyApproved(rule: Record<string, unknown>): boolean {
  const economy = rule.economy;
  return (
    typeof economy === "object" &&
    economy !== null &&
    (economy as Record<string, unknown>).approved === true
  );
}

// Accruals need the owner's explicit approval of the economy in the saved version (ADR-0029,
// P-04). A version without `economy.approved: true`, including the first one, credits nothing.
export function economyZone(definition: unknown): string | null {
  if (typeof definition !== "object" || definition === null) return null;
  const rule = definition as Record<string, unknown>;
  if (
    !economyApproved(rule) ||
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
  adjustment: {
    minXp: number;
    minPoints: number;
    maxXp: number;
    maxPoints: number;
  } | null;
  bonuses: AcceptanceBonus[];
};
type Fund = { xp: number; points: number };
const OPTION_LIMIT = 1_000_000;
const MAX_LEDGER_AMOUNT = 2_147_483_647;
// Same caps as in packages/contracts (ADR-0041, ADR-0042). Points: base plus bonus.
// XP: base only, so a bonus can take the total above 100.
export const TASK_POINTS_MAX = 100;
export const TASK_XP_MAX = 100;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= OPTION_LIMIT;
const isPercent = (value: unknown, min: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= 100;
// Integer shares of the task fund: a floor never pays more than the stated percent,
// a ceiling never lets the base drop below it.
const share = (amount: number, percent: number, round: "floor" | "ceil") =>
  round === "floor"
    ? Math.floor((amount * percent) / 100)
    : Math.ceil((amount * percent) / 100);

// What a reviewer may change at acceptance comes only from the saved rule version. A
// missing or malformed entry disables that option instead of falling back to a default.
// Two forms (ADR-0030, ADR-0031): absolute amounts (`maxXp`/`maxPoints`, bonus
// `xp`/`points`) or shares of the task fund (`minPercent`, bonus `percent`). Shares are
// resolved against the frozen fund of the task, so the reviewer sees exact numbers.
export function acceptanceOptions(
  definition: unknown,
  fund: Fund,
): AcceptanceOptions {
  const none: AcceptanceOptions = { adjustment: null, bonuses: [] };
  if (typeof definition !== "object" || definition === null) return none;
  const acceptance = (definition as Record<string, unknown>).acceptance;
  if (typeof acceptance !== "object" || acceptance === null) return none;
  const { adjustment, bonuses } = acceptance as Record<string, unknown>;
  const limits =
    typeof adjustment === "object" && adjustment !== null
      ? (adjustment as Record<string, unknown>)
      : null;
  const absolute =
    limits && isAmount(limits.maxXp) && isAmount(limits.maxPoints);
  const relative = limits && isPercent(limits.minPercent, 0);
  const result: AcceptanceOptions = {
    adjustment:
      absolute && !("minPercent" in limits)
        ? {
            minXp: 0,
            minPoints: 0,
            maxXp: limits.maxXp as number,
            maxPoints: limits.maxPoints as number,
          }
        : relative && !("maxXp" in limits) && !("maxPoints" in limits)
          ? {
              minXp: share(fund.xp, limits.minPercent as number, "ceil"),
              minPoints: share(
                fund.points,
                limits.minPercent as number,
                "ceil",
              ),
              maxXp: fund.xp,
              maxPoints: fund.points,
            }
          : null,
    bonuses: [],
  };
  if (!Array.isArray(bonuses) || bonuses.length > 7) return result;
  const parsed: AcceptanceBonus[] = [];
  const seen = new Set<string>();
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
      seen.has(entry.code)
    )
      return result;
    seen.add(entry.code);
    let xp: number;
    let points: number;
    if ("percent" in entry) {
      if ("xp" in entry || "points" in entry || !isPercent(entry.percent, 1))
        return result;
      xp = share(fund.xp, entry.percent, "floor");
      points = share(fund.points, entry.percent, "floor");
      // A share of a tiny fund can round to nothing: that task simply has no such bonus.
      if (xp + points === 0) continue;
    } else {
      if (
        !isAmount(entry.xp) ||
        !isAmount(entry.points) ||
        entry.xp + entry.points === 0
      )
        return result;
      xp = entry.xp;
      points = entry.points;
    }
    parsed.push({ code: entry.code, title: entry.title, xp, points });
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
  | "adjustment_below_limit"
  | "bonus_unknown"
  | "points_above_limit"
  | "xp_above_limit"
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
    if (
      baseXp < options.adjustment.minXp ||
      basePoints < options.adjustment.minPoints
    )
      return { ok: false, reason: "adjustment_below_limit" };
  }
  let bonus: AcceptanceBonus | null = null;
  if (selection.bonusCode != null) {
    bonus = options.bonuses.find((b) => b.code === selection.bonusCode) ?? null;
    if (!bonus) return { ok: false, reason: "bonus_unknown" };
  }
  const xp = baseXp + (bonus?.xp ?? 0);
  const points = basePoints + (bonus?.points ?? 0);
  if (points > TASK_POINTS_MAX)
    return { ok: false, reason: "points_above_limit" };
  if (baseXp > TASK_XP_MAX) return { ok: false, reason: "xp_above_limit" };
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
