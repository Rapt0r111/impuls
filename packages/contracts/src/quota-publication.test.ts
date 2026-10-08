import { describe, expect, it } from "vitest";
import {
  quotaPublicationRequestSchema as schema,
  quotaPublicationResponseSchema,
} from "./quota-publication";
import { auditResponseSchema } from "./audit";
const id = "a1111111-1111-4111-8111-111111111111";
const body = {
  scope: id,
  startsAt: "2040-01-01T00:00:00.000Z",
  endsAt: "2040-02-01T00:00:00.000Z",
  capacity: 3,
  reason: " Synthetic quota ",
};
describe("quota publication boundary", () => {
  it("accepts zero capacity and normalized reason, rejects policy/counters and ambiguous time", () => {
    expect(schema.parse({ ...body, capacity: 0 }).reason).toBe(
      "Synthetic quota",
    );
    for (const change of [
      { capacity: -1 },
      { capacity: 1000001 },
      { capacity: 1.1 },
      { capacity: "3" },
      { reserved: 1 },
      { used: 1 },
      { startsAt: "2040-01-01T00:00" },
      { startsAt: "2040-01-01T00:00:00Z" },
      { startsAt: "2040-01-01T00:00:00.000+03:00" },
      { endsAt: body.startsAt },
      { endsAt: "2039-01-01T00:00:00.000Z" },
      { reason: " " },
      { scope: "x" },
    ])
      expect(schema.safeParse({ ...body, ...change }).success).toBe(false);
  });
  it("admits only immutable quota audit evidence, never live counters or a task", () => {
    const quota = {
      rewardId: id,
      periodId: id,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      capacity: 3,
    };
    const response = {
      mode: "synthetic",
      scope: id,
      publicationId: id,
      quota,
      updatedAt: body.startsAt,
    };
    expect(quotaPublicationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      quotaPublicationResponseSchema.safeParse({
        ...response,
        quota: { ...quota, reserved: 0 },
      }).success,
    ).toBe(false);
    const item = {
      id,
      requestId: id,
      action: "quota.publish",
      actor: { id, displayName: "Synthetic" },
      occurredAt: body.startsAt,
      reason: "Synthetic",
      quota,
      task: null,
      reward: null,
      catalog: null,
      reviewId: null,
      correctionId: null,
      values: [],
    };
    const audit = {
      mode: "synthetic",
      scope: { id, name: "Synthetic" },
      scopes: [{ id, name: "Synthetic" }],
      updatedAt: body.startsAt,
      nextCursor: null,
      items: [item],
    };
    expect(auditResponseSchema.safeParse(audit).success).toBe(true);
    for (const change of [
      { quota: null },
      { task: { id, currentTitle: "Other" } },
      { action: "catalog.publish" },
      { values: [{ field: "price", value: 3 }] },
    ])
      expect(
        auditResponseSchema.safeParse({
          ...audit,
          items: [{ ...item, ...change }],
        }).success,
      ).toBe(false);
  });
});
