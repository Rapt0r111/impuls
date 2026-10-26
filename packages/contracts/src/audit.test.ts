import { describe, expect, it } from "vitest";
import { auditQuerySchema, auditResponseSchema } from "./audit";
const id = "a1111111-1111-4111-8111-111111111111";
describe("F07 audit wire contract", () => {
  it("bounds pages, actions and query keys", () => {
    expect(auditQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const invalid of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.1 },
      { scope: "wrong" },
      { actor: id },
      { action: "admin.access" },
      { cursor: "" },
      { cursor: `${id}|${id}|all|${id}|extra` },
    ])
      expect(auditQuerySchema.safeParse(invalid).success).toBe(false);
    expect(
      auditQuerySchema.parse({ cursor: `${id}|${id}|all|${id}` }).cursor,
    ).toEqual({ actor: id, scope: id, action: "all", id });
  });
  it("accepts typed saved values and rejects raw diffs or credentials", () => {
    const item = {
      id,
      requestId: id,
      action: "ledger.correct",
      actor: { id, displayName: "Synthetic auditor" },
      occurredAt: "2026-10-02T10:00:00.000Z",
      reason: "Synthetic correction",
      task: { id, currentTitle: "Synthetic task" },
      reward: null,
      reviewId: null,
      correctionId: id,
      values: [{ field: "xpDelta", value: -17 }],
    };
    const data = {
      scopes: [{ id, name: "Synthetic" }],
      scope: { id, name: "Synthetic" },
      updatedAt: item.occurredAt,
      nextCursor: null,
      items: [item],
    };
    expect(auditResponseSchema.safeParse(data).success).toBe(true);
    for (const altered of [
      { ...item, diff: {} },
      { ...item, sessionHash: "private" },
      { ...item, values: [{ field: "secret", value: "private" }] },
      { ...item, values: [{ field: "xpDelta", value: 1.5 }] },
      { ...item, values: [{ field: "xpDelta", value: "wrong type" }] },
      { ...item, values: [{ field: "xpDelta", value: 17 }] },
      { ...item, values: [{ field: "version", value: 0 }] },
      { ...item, values: [{ field: "title", value: 17 }] },
    ])
      expect(
        auditResponseSchema.safeParse({ ...data, items: [altered] }).success,
      ).toBe(false);
  });
  it("accepts member change evidence only on member actions", () => {
    const member = {
      membershipId: id,
      subject: { id, displayName: "Synthetic member" },
      validUntil: null,
      userCreated: true,
      userReactivated: false,
      userDeactivated: false,
      revokedBindings: 0,
    };
    const item = {
      id,
      requestId: id,
      action: "member.admit",
      actor: { id, displayName: "Synthetic manager" },
      occurredAt: "2026-10-09T10:00:00.000Z",
      reason: "Synthetic admission",
      task: null,
      reward: null,
      member,
      reviewId: null,
      correctionId: null,
      values: [],
    };
    const wrap = (altered: unknown) =>
      auditResponseSchema.safeParse({
        scopes: [{ id, name: "Synthetic" }],
        scope: { id, name: "Synthetic" },
        updatedAt: item.occurredAt,
        nextCursor: null,
        items: [altered],
      }).success;
    expect(wrap(item)).toBe(true);
    expect(wrap({ ...item, action: "member.remove" })).toBe(true);
    for (const altered of [
      { ...item, member: null },
      { ...item, action: "task.accept" },
      { ...item, member: { ...member, telegramId: 7123456 } },
      { ...item, member: { ...member, revokedBindings: -1 } },
      { ...item, task: { id, currentTitle: "Synthetic task" } },
      { ...item, values: [{ field: "xpDelta", value: -17 }] },
    ])
      expect(wrap(altered)).toBe(false);
  });
  it("accepts five reward actions with signed movements and rejects mismatched contexts", () => {
    const reward = {
      redemptionId: id,
      rewardId: id,
      rewardVersionId: id,
      quotaPeriodId: id,
      title: "Synthetic cosmetic",
      conditions: "Saved terms",
      price: 30,
      rewardVersion: 1,
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-11-01T00:00:00.000Z",
      recipient: { id, displayName: "Synthetic owner" },
    };
    const item = {
      id,
      requestId: id,
      action: "reward.reserve",
      actor: { id, displayName: "Synthetic" },
      occurredAt: reward.periodStart,
      reason: "Synthetic reason",
      task: null,
      reward,
      reviewId: null,
      correctionId: null,
      values: [
        { field: "availableDelta", value: -30 },
        { field: "reservedDelta", value: 30 },
      ],
    };
    const parse = (altered: unknown) =>
      auditResponseSchema.safeParse({
        scopes: [{ id, name: "Synthetic" }],
        scope: { id, name: "Synthetic" },
        updatedAt: reward.periodStart,
        nextCursor: null,
        items: [altered],
      }).success;
    for (const action of [
      "reward.reserve",
      "reward.cancel",
      "reward.approve",
      "reward.reject",
      "reward.fulfill",
    ]) {
      expect(
        auditQuerySchema.safeParse({
          action,
          cursor: `${id}|${id}|${action}|${id}`,
        }).success,
      ).toBe(true);
      expect(
        parse({
          ...item,
          action,
          values:
            action === "reward.fulfill"
              ? [{ field: "entitlementId", value: id }]
              : item.values,
        }),
      ).toBe(true);
    }
    const automatic = {
      ...item,
      action: "reward.expire",
      actor: { id: null, displayName: "Автоматическое истечение резерва" },
      reason: "Автоматическое истечение синтетического резерва",
    };
    expect(parse(automatic)).toBe(true);
    expect(parse({ ...automatic, action: "reward.reject" })).toBe(false);
    expect(
      parse({
        ...automatic,
        actor: { id: null, displayName: "Unknown human" },
      }),
    ).toBe(false);
    for (const altered of [
      { ...item, reward: null },
      { ...item, task: { id, currentTitle: "Wrong" } },
      { ...item, action: "task.create" },
      { ...item, reviewId: id },
      { ...item, correctionId: id },
      { ...item, diff: {} },
      ...[
        { field: "availableDelta", value: "30" },
        { field: "reservedDelta", value: 0.5 },
        { field: "price", value: 0 },
        { field: "rewardVersion", value: 0 },
        { field: "quotaPeriodId", value: "private" },
        { field: "token", value: "private" },
        { field: "xp", value: 30 },
      ].map((value) => ({ ...item, values: [value] })),
      { ...item, action: "reward.fulfill", values: item.values },
      {
        ...item,
        action: "reward.fulfill",
        values: [{ field: "entitlementId", value: "invalid" }],
      },
    ])
      expect(parse(altered)).toBe(false);
  });
});
