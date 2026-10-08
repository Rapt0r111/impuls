import { describe, it, expect } from "vitest";
import {
  reserveRewardRequestSchema,
  cancelRedemptionRequestSchema,
  rewardListQuerySchema,
  redemptionListQuerySchema,
  decideRedemptionRequestSchema,
  redemptionReviewQuerySchema,
  fulfillRedemptionRequestSchema,
  redemptionCursorSchema,
  rewardCursorSchema,
  redemptionSchema,
} from "./rewards";
const id = "11111111-1111-4111-8111-111111111111";
describe("F06 synthetic reward contracts", () => {
  it("identifies automatic expiry without inventing a human actor", () => {
    const at = "2026-10-05T10:00:00.000Z";
    const item = {
      id,
      rewardId: id,
      rewardVersionId: id,
      quotaPeriodId: id,
      scope: { id, name: "Synthetic" },
      title: "Cosmetic",
      conditions: "Saved",
      price: 23,
      rewardVersion: 1,
      periodStart: at,
      periodEnd: at,
      expiresAt: at,
      status: "expired",
      cancellationReason: null,
      version: 2,
      createdAt: at,
      updatedAt: at,
      decision: {
        actorId: null,
        displayName: "Автоматическое истечение резерва",
        reason: "Автоматическое истечение синтетического резерва",
        decidedAt: at,
      },
    };
    expect(redemptionSchema.safeParse(item).success).toBe(true);
    for (const changed of [
      { ...item, status: "approved" },
      { ...item, expiresAt: null },
      { ...item, decision: { ...item.decision, displayName: "Unknown human" } },
      {
        ...item,
        decision: { ...item.decision, decidedAt: "2026-10-05T09:00:00.000Z" },
      },
    ])
      expect(redemptionSchema.safeParse(changed).success).toBe(false);
  });
  it("requires a reader, exact scope, catalog purpose, saved version and quota", () => {
    const cursor = `${id}|${id}|catalog|${id}|${id}|${id}`;
    expect(rewardListQuerySchema.parse({ cursor })).toEqual({
      cursor: {
        actor: id,
        scope: id,
        purpose: "catalog",
        rewardId: id,
        versionId: id,
        quotaId: id,
      },
      limit: 20,
    });
    for (const value of [
      id,
      `${cursor}|extra`,
      cursor.replace("catalog", "mine"),
      cursor.replace("catalog", "decide"),
      cursor.replace(id, "bad"),
      `${id}|all|catalog|${id}|${id}|${id}`,
      `${id}|${id}|catalog|${id}`,
      "a".repeat(241),
    ])
      expect(rewardCursorSchema.safeParse(value).success).toBe(false);
    for (const query of [
      { cursor, userId: id },
      { limit: 0 },
      { limit: 51 },
      { scope: "all" },
    ])
      expect(rewardListQuerySchema.safeParse(query).success).toBe(false);
  });
  it("requires an issuance reason/version and refuses client ownership or financial data", () => {
    const body = { expectedVersion: 2, reason: " Выдано " };
    expect(fulfillRedemptionRequestSchema.parse(body)).toEqual({
      expectedVersion: 2,
      reason: "Выдано",
    });
    for (const extra of [
      { reason: " " },
      { expectedVersion: 0 },
      { userId: id },
      { actorId: id },
      { entitlementId: id },
      { price: 0 },
      { decision: "approve" },
      { status: "fulfilled" },
    ])
      expect(
        fulfillRedemptionRequestSchema.safeParse({ ...body, ...extra }).success,
      ).toBe(false);
  });
  it("requires a supported decision, reason and version; refuses arbitrary financial or actor input", () => {
    const body = {
      decision: "approve",
      reason: " Проверено ",
      expectedVersion: 1,
    };
    expect(decideRedemptionRequestSchema.parse(body)).toEqual({
      ...body,
      reason: "Проверено",
    });
    expect(
      decideRedemptionRequestSchema.parse({ ...body, decision: "expire" })
        .decision,
    ).toBe("expire");
    for (const extra of [
      { decision: "fulfill" },
      { reason: " " },
      { expectedVersion: 0 },
      { actorId: id },
      { userId: id },
      { price: 1 },
      { reservedDelta: -1 },
      { expiresAt: "2026-10-04T00:00:00Z" },
      { now: "2026-10-04T00:00:00Z" },
    ])
      expect(
        decideRedemptionRequestSchema.safeParse({ ...body, ...extra }).success,
      ).toBe(false);
    expect(redemptionReviewQuerySchema.parse({ scope: id, limit: 1 })).toEqual({
      scope: id,
      limit: 1,
    });
    expect(redemptionReviewQuerySchema.safeParse({ userId: id }).success).toBe(
      false,
    );
  });
  it("rejects client prices, recipients, states and rules", () => {
    const base = { rewardVersionId: id, quotaPeriodId: id, expectedVersion: 1 };
    expect(reserveRewardRequestSchema.parse(base)).toEqual(base);
    for (const extra of [
      { price: 1 },
      { userId: id },
      { status: "approved" },
      { rewardVersion: 1 },
      { expiresAt: "2026-10-04T00:00:00Z" },
      { reservationSeconds: 1 },
      { expectedVersion: 0 },
    ])
      expect(
        reserveRewardRequestSchema.safeParse({ ...base, ...extra }).success,
      ).toBe(false);
  });
  it("requires cancellation reason and version without financial input", () => {
    expect(
      cancelRedemptionRequestSchema.parse({
        expectedVersion: 1,
        reason: "  Передумал  ",
      }),
    ).toEqual({ expectedVersion: 1, reason: "Передумал" });
    for (const body of [
      { expectedVersion: 1, reason: " " },
      { expectedVersion: 0, reason: "a" },
      { expectedVersion: 1, reason: "a", refund: 900 },
    ])
      expect(cancelRedemptionRequestSchema.safeParse(body).success).toBe(false);
  });
  it("bounds lists and refuses selecting someone else's requests", () => {
    expect(rewardListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      redemptionListQuerySchema.parse({
        cursor: `${id}|all|mine|${id}`,
      }),
    ).toMatchObject({
      cursor: { actor: id, scope: "all", purpose: "mine", id },
    });
    for (const query of [{ userId: id }, { limit: 51 }, { cursor: "broken" }])
      expect(redemptionListQuerySchema.safeParse(query).success).toBe(false);
    expect(rewardListQuerySchema.safeParse({ scope: "bad" }).success).toBe(
      false,
    );
  });
  it("binds cursor structure to a reader, scope and list purpose", () => {
    for (const purpose of ["decide", "fulfill"])
      expect(
        redemptionCursorSchema.parse(`${id}|${id}|${purpose}|${id}`),
      ).toEqual({ actor: id, scope: id, purpose, id });
    for (const value of [
      `2026-10-03T10:00:00.001Z|${id}`,
      `${id}|all|decide|${id}`,
      `${id}|${id}|mine|${id}`,
      `${id}|${id}|catalog|${id}`,
      `${id}|all|mine|${id}|extra`,
      `bad|all|mine|${id}`,
      `${id}|all|mine|bad`,
      "a".repeat(161),
    ])
      expect(redemptionCursorSchema.safeParse(value).success).toBe(false);
  });
});
