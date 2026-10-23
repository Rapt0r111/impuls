import { describe, expect, it } from "vitest";
import { acceptanceAwardSchema } from "./ledger";
import {
  reviewListQuerySchema,
  taskAcceptanceRequestSchema,
  taskReturnRequestSchema,
} from "./reviews";

describe("return contract", () => {
  it("requires a reason, a version and the sole implemented decision", () => {
    expect(
      taskReturnRequestSchema.parse({
        action: "return",
        expectedVersion: 3,
        reason: "  Add evidence  ",
      }),
    ).toEqual({ action: "return", expectedVersion: 3, reason: "Add evidence" });
    for (const body of [
      { action: "return", expectedVersion: 3, reason: "  " },
      { action: "accept", expectedVersion: 3, reason: "Done" },
      { action: "return", expectedVersion: 0, reason: "Done" },
      { action: "return", expectedVersion: 3, reason: "x".repeat(2001) },
      { action: "return", expectedVersion: 3, reason: "Done", fundXp: 200 },
    ])
      expect(taskReturnRequestSchema.safeParse(body).success).toBe(false);
  });
  it("bounds cursor pages and rejects arbitrary scope selection", () => {
    expect(reviewListQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const query of [
      { limit: "51" },
      { cursor: "not-a-uuid" },
      { scope: "any" },
    ])
      expect(reviewListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("acceptance adjustment and bonus contract", () => {
  const base = { action: "accept", expectedVersion: 2, reason: "Verified" };
  it("accepts the unchanged form and the corrected form with a bonus code", () => {
    expect(taskAcceptanceRequestSchema.safeParse(base).success).toBe(true);
    expect(
      taskAcceptanceRequestSchema.parse({
        ...base,
        baseXp: 100,
        basePoints: 0,
        bonusCode: "quality",
      }),
    ).toMatchObject({ baseXp: 100, basePoints: 0, bonusCode: "quality" });
  });
  it("rejects negative, fractional, oversized and malformed values", () => {
    for (const extra of [
      { baseXp: -1 },
      { baseXp: 101 },
      { baseXp: 1.5 },
      { basePoints: 1_000_001 },
      { bonusCode: "Quality" },
      { bonusCode: "x" },
      { bonusCode: "a".repeat(41) },
      { total: 5 },
    ])
      expect(
        taskAcceptanceRequestSchema.safeParse({ ...base, ...extra }).success,
      ).toBe(false);
  });
  it("never lets a return carry award fields", () => {
    expect(
      taskReturnRequestSchema.safeParse({
        action: "return",
        expectedVersion: 1,
        reason: "Fix",
        bonusCode: "quality",
      }).success,
    ).toBe(false);
  });
  it("defaults the award breakdown for responses saved before it existed", () => {
    const award = acceptanceAwardSchema.parse({
      mode: "synthetic",
      xp: 5,
      points: 1,
      ruleVersion: 1,
      seasonKey: "2026-10",
      timeZone: "UTC",
      acceptedAt: "2026-10-10T00:00:00.000Z",
      balance: {
        lifetimeXp: 5,
        availablePoints: 1,
        reservedPoints: 0,
        version: 1,
        updatedAt: null,
      },
    });
    expect(award.breakdown).toBeNull();
  });
});
