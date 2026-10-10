import { describe, expect, it } from "vitest";
import {
  acceptanceOptions,
  acceptanceSeason,
  resolveAcceptanceAward,
  syntheticEconomyZone,
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
    acceptanceOptions({ acceptance: { enabled: true, bonuses } }).bonuses;
  it("reads only what the saved version states and fails closed otherwise", () => {
    expect(acceptanceOptions(rules)).toEqual({
      adjustment: { maxXp: 200, maxPoints: 80 },
      bonuses: rules.acceptance.bonuses,
    });
    for (const broken of [null, {}, { acceptance: null }, { acceptance: {} }])
      expect(acceptanceOptions(broken)).toEqual({
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
    expect(resolveAcceptanceAward(acceptanceOptions({}), fund, {})).toEqual({
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
      resolveAcceptanceAward(acceptanceOptions(rules), fund, {
        baseXp: 120,
        basePoints: 25,
        bonusCode: "quality",
      }),
    ).toMatchObject({ ok: true, xp: 140, points: 35 });
  });
  it("rejects an unknown bonus, an unlisted adjustment and an over-limit base", () => {
    const options = acceptanceOptions(rules);
    expect(
      resolveAcceptanceAward(options, fund, { bonusCode: "nope" }),
    ).toEqual({ ok: false, reason: "bonus_unknown" });
    expect(
      resolveAcceptanceAward(acceptanceOptions({}), fund, { baseXp: 90 }),
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
  it("lets an unchanged fund through even above the adjustment ceiling", () => {
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules),
        { xp: 500, points: 30 },
        { baseXp: 500 },
      ),
    ).toMatchObject({ ok: true, xp: 500 });
  });
  it("refuses a total that would overflow the ledger column", () => {
    expect(
      resolveAcceptanceAward(
        acceptanceOptions(rules),
        { xp: 2_147_483_640, points: 0 },
        { bonusCode: "quality" },
      ),
    ).toEqual({ ok: false, reason: "award_too_large" });
  });
});

describe("synthetic acceptance policy and server month", () => {
  it("requires an explicitly enabled synthetic version and valid timezone", () => {
    expect(
      syntheticEconomyZone({
        mode: "synthetic",
        timeZone: "Europe/Moscow",
        acceptance: { enabled: true },
      }),
    ).toBe("Europe/Moscow");
    for (const rules of [
      null,
      {},
      { mode: "production", timeZone: "UTC", acceptance: { enabled: true } },
      {
        mode: "synthetic",
        timeZone: "Invalid/Zone",
        acceptance: { enabled: true },
      },
      { mode: "synthetic", timeZone: "UTC", acceptance: { enabled: false } },
    ])
      expect(syntheticEconomyZone(rules)).toBeNull();
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
