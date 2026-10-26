import { describe, expect, it } from "vitest";
import {
  acceptanceOptions,
  acceptanceSeason,
  resolveAcceptanceAward,
  economyZone,
} from "./economy";

describe("acceptance adjustment and bonus options", () => {
  const rules = {
    acceptance: {
      enabled: true,
      adjustment: { maxXp: 200, maxPoints: 80 },
      bonuses: [
        { code: "quality", title: "Качество", xp: 20, points: 10 },
        { code: "docs", title: "Документация", xp: 20, points: 10 },
      ],
    },
  };
  const fund = { xp: 100, points: 30 };
  const bonusesOf = (bonuses: unknown) =>
    acceptanceOptions({ acceptance: { enabled: true, bonuses } }, fund).bonuses;
  it("reads only what the saved version states and fails closed otherwise", () => {
    expect(acceptanceOptions(rules, fund)).toEqual({
      adjustment: { minXp: 0, minPoints: 0, maxXp: 200, maxPoints: 80 },
      bonuses: rules.acceptance.bonuses,
    });
    for (const broken of [null, {}, { acceptance: null }, { acceptance: {} }])
      expect(acceptanceOptions(broken, fund)).toEqual({
        adjustment: null,
        bonuses: [],
      });
    expect(bonusesOf([{ code: "A!", title: "x", xp: 1, points: 0 }])).toEqual(
      [],
    );
    expect(bonusesOf([{ code: "zero", title: "x", xp: 0, points: 0 }])).toEqual(
      [],
    );
    expect(bonusesOf([{ code: "neg", title: "x", xp: -1, points: 0 }])).toEqual(
      [],
    );
    expect(
      bonusesOf([
        { code: "same", title: "a", xp: 1, points: 0 },
        { code: "same", title: "b", xp: 2, points: 0 },
      ]),
    ).toEqual([]);
    expect(
      bonusesOf(
        Array.from({ length: 8 }, (_, i) => ({
          code: `b${i}`,
          title: "t",
          xp: 1,
          points: 0,
        })),
      ),
    ).toEqual([]);
  });
  it("pays exactly the fund when nothing is chosen", () => {
    expect(
      resolveAcceptanceAward(acceptanceOptions({}, fund), fund, {}),
    ).toEqual({
      ok: true,
      baseXp: 100,
      basePoints: 30,
      bonus: null,
      xp: 100,
      points: 30,
    });
  });
  it("adds one bonus to the corrected base as independent xp and points", () => {
    expect(
      resolveAcceptanceAward(acceptanceOptions(rules, fund), fund, {
        baseXp: 80,
        basePoints: 25,
        bonusCode: "quality",
      }),
    ).toMatchObject({ ok: true, xp: 100, points: 35 });
  });
  it("rejects an unknown bonus, an unlisted adjustment and an over-limit base", () => {
    const options = acceptanceOptions(rules, fund);
    expect(
      resolveAcceptanceAward(options, fund, { bonusCode: "nope" }),
    ).toEqual({ ok: false, reason: "bonus_unknown" });
    expect(
      resolveAcceptanceAward(acceptanceOptions({}, fund), fund, { baseXp: 90 }),
    ).toEqual({ ok: false, reason: "adjustment_not_allowed" });
    expect(resolveAcceptanceAward(options, fund, { baseXp: 201 })).toEqual({
      ok: false,
      reason: "adjustment_exceeds_limit",
    });
    expect(resolveAcceptanceAward(options, fund, { basePoints: 81 })).toEqual({
      ok: false,
      reason: "adjustment_exceeds_limit",
    });
  });
  it("refuses an unchanged legacy fund above 100 XP, even within the adjustment ceiling", () => {
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules, fund),
        { xp: 500, points: 30 },
        { baseXp: 500 },
      ),
    ).toEqual({ ok: false, reason: "xp_above_limit" });
  });
  it("refuses a total far above the cap before it can overflow the ledger column", () => {
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules, fund),
        { xp: 2_147_483_640, points: 0 },
        { bonusCode: "quality" },
      ),
    ).toEqual({ ok: false, reason: "xp_above_limit" });
  });
  it("caps base XP at 100 for one task, the edge included", () => {
    const options = acceptanceOptions(rules, fund);
    expect(
      resolveAcceptanceAward(options, { xp: 101, points: 10 }, {}),
    ).toEqual({ ok: false, reason: "xp_above_limit" });
    expect(
      resolveAcceptanceAward(options, { xp: 100, points: 10 }, {}),
    ).toMatchObject({ ok: true, xp: 100 });
  });
  it("leaves the XP bonus uncapped: base 100 plus bonus gives more than 100", () => {
    const options = acceptanceOptions(rules, fund);
    expect(
      resolveAcceptanceAward(
        options,
        { xp: 80, points: 10 },
        { bonusCode: "quality" },
      ),
    ).toMatchObject({ ok: true, xp: 100, points: 20 });
    expect(
      resolveAcceptanceAward(
        options,
        { xp: 100, points: 10 },
        { bonusCode: "quality" },
      ),
    ).toMatchObject({ ok: true, baseXp: 100, xp: 120, points: 20 });
  });
  it("keeps base plus bonus within 100 points for one task", () => {
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules, fund),
        { xp: 100, points: 95 },
        { bonusCode: "quality" },
      ),
    ).toEqual({ ok: false, reason: "points_above_limit" });
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules, fund),
        { xp: 80, points: 90 },
        { bonusCode: "quality" },
      ),
    ).toMatchObject({ ok: true, points: 100 });
  });
});

describe("acceptance options as shares of the task fund (ADR-0031)", () => {
  // Rules version 2 for the pilot (P-04, owner decision 10.10.2026): the base may be
  // lowered to 50 % of the fund, one bonus of +10 % or +25 % of the fund.
  const v2 = {
    acceptance: {
      enabled: true,
      adjustment: { minPercent: 50 },
      bonuses: [
        { code: "plus_10", title: "Бонус +10 %", percent: 10 },
        { code: "plus_25", title: "Бонус +25 %", percent: 25 },
      ],
    },
  };
  it("resolves the shares against the frozen fund with integer rounding", () => {
    // Independent expectations: 50 % of 100/30 = 50/15; 10 % = 10/3; 25 % = 25/7.5 -> 7.
    expect(acceptanceOptions(v2, { xp: 100, points: 30 })).toEqual({
      adjustment: { minXp: 50, minPoints: 15, maxXp: 100, maxPoints: 30 },
      bonuses: [
        { code: "plus_10", title: "Бонус +10 %", xp: 10, points: 3 },
        { code: "plus_25", title: "Бонус +25 %", xp: 25, points: 7 },
      ],
    });
    // Odd fund: the minimum is rounded up, bonuses down (never more than stated).
    expect(acceptanceOptions(v2, { xp: 15, points: 5 })).toEqual({
      adjustment: { minXp: 8, minPoints: 3, maxXp: 15, maxPoints: 5 },
      bonuses: [
        { code: "plus_10", title: "Бонус +10 %", xp: 1, points: 0 },
        { code: "plus_25", title: "Бонус +25 %", xp: 3, points: 1 },
      ],
    });
  });
  it("drops a bonus that rounds to nothing on a tiny fund, keeping the others", () => {
    expect(acceptanceOptions(v2, { xp: 5, points: 3 }).bonuses).toEqual([
      { code: "plus_25", title: "Бонус +25 %", xp: 1, points: 0 },
    ]);
    expect(acceptanceOptions(v2, { xp: 0, points: 0 })).toEqual({
      adjustment: { minXp: 0, minPoints: 0, maxXp: 0, maxPoints: 0 },
      bonuses: [],
    });
  });
  it("lowers the base within the share, never raises it, and adds one bonus", () => {
    const fund = { xp: 100, points: 30 };
    const options = acceptanceOptions(v2, fund);
    expect(
      resolveAcceptanceAward(options, fund, {
        baseXp: 50,
        basePoints: 15,
        bonusCode: "plus_25",
      }),
    ).toMatchObject({ ok: true, xp: 75, points: 22 });
    expect(
      resolveAcceptanceAward(options, fund, {
        baseXp: 90,
        bonusCode: "plus_10",
      }),
    ).toMatchObject({ ok: true, baseXp: 90, xp: 100, points: 33 });
    expect(
      resolveAcceptanceAward(options, fund, { bonusCode: "plus_10" }),
    ).toMatchObject({ ok: true, baseXp: 100, xp: 110, points: 33 });
    expect(resolveAcceptanceAward(options, fund, { baseXp: 49 })).toEqual({
      ok: false,
      reason: "adjustment_below_limit",
    });
    expect(resolveAcceptanceAward(options, fund, { basePoints: 14 })).toEqual({
      ok: false,
      reason: "adjustment_below_limit",
    });
    expect(resolveAcceptanceAward(options, fund, { baseXp: 101 })).toEqual({
      ok: false,
      reason: "adjustment_exceeds_limit",
    });
  });
  it("fails closed on a malformed or mixed definition", () => {
    const fund = { xp: 100, points: 30 };
    const adjustmentOf = (adjustment: unknown) =>
      acceptanceOptions({ acceptance: { enabled: true, adjustment } }, fund)
        .adjustment;
    for (const broken of [
      { minPercent: 101 },
      { minPercent: -1 },
      { minPercent: 50.5 },
      { minPercent: "50" },
      { minPercent: 50, maxXp: 200, maxPoints: 80 },
    ])
      expect(adjustmentOf(broken)).toBeNull();
    const bonusesOf = (bonuses: unknown) =>
      acceptanceOptions({ acceptance: { enabled: true, bonuses } }, fund)
        .bonuses;
    for (const broken of [
      [{ code: "p0", title: "x", percent: 0 }],
      [{ code: "p1", title: "x", percent: 101 }],
      [{ code: "p2", title: "x", percent: 10, xp: 5, points: 0 }],
      [
        { code: "same", title: "a", percent: 10 },
        { code: "same", title: "b", percent: 25 },
      ],
    ])
      expect(bonusesOf(broken)).toEqual([]);
  });
});

describe("acceptance policy and server month", () => {
  it("requires an approved economy, an enabled acceptance and a valid timezone", () => {
    expect(
      economyZone({
        economy: { approved: true },
        timeZone: "Europe/Moscow",
        acceptance: { enabled: true },
      }),
    ).toBe("Europe/Moscow");
    for (const rules of [
      null,
      {},
      // The first version has no approval, so it credits nothing (ADR-0029).
      { mode: "synthetic", timeZone: "UTC", acceptance: { enabled: true } },
      {
        economy: { approved: "yes" },
        timeZone: "UTC",
        acceptance: { enabled: true },
      },
      {
        economy: { approved: true },
        timeZone: "Invalid/Zone",
        acceptance: { enabled: true },
      },
      {
        economy: { approved: true },
        timeZone: "UTC",
        acceptance: { enabled: false },
      },
    ])
      expect(economyZone(rules)).toBeNull();
  });
  it("places a UTC timestamp on the correct side of the Moscow month boundary", () => {
    expect(
      acceptanceSeason(new Date("2026-09-30T20:59:59.999Z"), "Europe/Moscow"),
    ).toBe("2026-09");
    expect(
      acceptanceSeason(new Date("2026-09-30T21:00:00.000Z"), "Europe/Moscow"),
    ).toBe("2026-10");
    expect(acceptanceSeason(new Date("2026-09-30T21:00:00.000Z"), "UTC")).toBe(
      "2026-09",
    );
    expect(
      acceptanceSeason(new Date("2026-12-31T21:00:00.000Z"), "Europe/Moscow"),
    ).toBe("2027-01");
  });
});
