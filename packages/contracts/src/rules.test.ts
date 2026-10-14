import { describe, expect, it } from "vitest";
import { rulesPublishRequestSchema } from "./rules";

const valid = {
  timeZone: "Europe/Moscow",
  acceptanceEnabled: true,
  minPercent: 50,
  bonuses: [{ code: "plus_10", title: "Бонус +10 %", percent: 10 }],
  levelThresholds: [0, 100, 250],
  reason: "Пилот",
};
describe("rules publish request", () => {
  it("accepts a complete request and unset levels", () => {
    expect(rulesPublishRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      rulesPublishRequestSchema.safeParse({
        ...valid,
        levelThresholds: null,
        minPercent: null,
        bonuses: [],
      }).success,
    ).toBe(true);
  });
  it("accepts a free-task limit, no limit, and an omitted field as no limit", () => {
    const parse = (extra: object) =>
      rulesPublishRequestSchema.safeParse({ ...valid, ...extra });
    expect(parse({ openTaskLimit: 3 }).success).toBe(true);
    expect(parse({ openTaskLimit: null }).success).toBe(true);
    const omitted = parse({});
    expect(omitted.success && omitted.data.openTaskLimit).toBeNull();
  });
  it.each([
    ["first threshold not zero", { levelThresholds: [10, 20] }],
    ["non-increasing thresholds", { levelThresholds: [0, 50, 50] }],
    ["unknown zone", { timeZone: "Mars/Base" }],
    ["limit of zero", { openTaskLimit: 0 }],
    ["limit above fifty", { openTaskLimit: 51 }],
    [
      "more names than levels",
      { levelThresholds: [0, 100], levelNames: ["A", "B", "C"] },
    ],
    [
      "name longer than forty",
      { levelThresholds: [0], levelNames: ["x".repeat(41)] },
    ],
    ["names without levels", { levelThresholds: null, levelNames: ["A"] }],
    ["percent above 100", { minPercent: 101 }],
    [
      "duplicate bonus codes",
      { bonuses: [valid.bonuses[0], valid.bonuses[0]] },
    ],
    [
      "bonus code with capitals",
      { bonuses: [{ ...valid.bonuses[0], code: "Plus" }] },
    ],
    [
      "more than seven bonuses",
      {
        bonuses: Array.from({ length: 8 }, (_, i) => ({
          code: `bonus_${i}`,
          title: "b",
          percent: 5,
        })),
      },
    ],
    ["blank reason", { reason: "   " }],
    ["extra key", { extra: 1 }],
  ])("rejects %s", (_name, patch) => {
    expect(
      rulesPublishRequestSchema.safeParse({ ...valid, ...patch }).success,
    ).toBe(false);
  });
});
