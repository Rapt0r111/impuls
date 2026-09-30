import { describe, expect, it } from "vitest";
import { ledgerListQuerySchema, accountLedgerResponseSchema } from "./ledger";
import { taskReviewRequestSchema } from "./reviews";
describe("synthetic acceptance and owned journal contracts", () => {
  it("rejects client money, recipient, rule and action changes", () => {
    const body = {
      action: "accept",
      expectedVersion: 1,
      reason: "  Checked  ",
    };
    expect(taskReviewRequestSchema.parse(body)).toEqual({
      ...body,
      reason: "Checked",
    });
    for (const extra of [
      { xp: 9 },
      { fundPoints: 5 },
      { recipientId: "any" },
      { ruleVersion: 2 },
      { reason: " " },
      { action: "correct" },
      { expectedVersion: 0 },
    ])
      expect(
        taskReviewRequestSchema.safeParse({ ...body, ...extra }).success,
      ).toBe(false);
  });
  it("validates exact timestamp/uuid cursors and disallows selecting an account", () => {
    expect(ledgerListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      ledgerListQuerySchema.parse({
        cursor: "2026-09-30T08:00:00.123Z|11111111-1111-4111-8111-111111111111",
      }).cursor,
    ).toEqual({
      at: "2026-09-30T08:00:00.123Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    for (const query of [
      { cursor: "broken" },
      {
        cursor:
          "2026-09-30T08:00:00.123Z|11111111-1111-4111-8111-111111111111|extra",
      },
      { userId: "any" },
      { limit: 51 },
    ])
      expect(ledgerListQuerySchema.safeParse(query).success).toBe(false);
  });
  it("does not admit negative, unsafe or conflated balances", () => {
    const body = {
      balance: {
        lifetimeXp: 0,
        availablePoints: 0,
        reservedPoints: 0,
        version: 0,
        updatedAt: null,
      },
      entries: [],
      nextCursor: null,
      asOf: "2026-09-30T08:00:00.000Z",
    };
    expect(accountLedgerResponseSchema.safeParse(body).success).toBe(true);
    for (const extra of [
      { availablePoints: -1 },
      { lifetimeXp: Number.MAX_SAFE_INTEGER + 1 },
      { reservedPoints: 1.5 },
    ])
      expect(
        accountLedgerResponseSchema.safeParse({
          ...body,
          balance: { ...body.balance, ...extra },
        }).success,
      ).toBe(false);
  });
});
