import { describe, expect, it } from "vitest";
const randomUUID = () => crypto.randomUUID();
import {
  catalogCreationRequestSchema,
  catalogCreationResponseSchema,
} from "./catalog-creation";
import { auditResponseSchema } from "./audit";

const body = {
  scope: randomUUID(),
  title: "Synthetic",
  conditions: "Synthetic conditions",
  price: 19,
  reservationSeconds: null,
  reason: "Synthetic fixture",
};
describe("disabled synthetic identity contract", () => {
  it("normalizes authored text while leaving server fields unavailable", () => {
    expect(
      catalogCreationRequestSchema.parse({ ...body, title: " Synthetic " }),
    ).toEqual(body);
    for (const patch of [
      { enabled: true },
      { enabled: false },
      { kind: "service" },
      { mode: "real" },
      { rewardId: randomUUID() },
      { version: 1 },
      { expectedVersion: 0 },
      { quota: 1 },
      { effectiveFrom: "2026-01-01T00:00:00Z" },
    ])
      expect(
        catalogCreationRequestSchema.safeParse({ ...body, ...patch }).success,
      ).toBe(false);
  });
  it("rejects fractional, missing, blank and out-of-range inputs", () => {
    for (const patch of [
      { price: 0 },
      { price: 1.5 },
      { price: 1000001 },
      { reservationSeconds: 0 },
      { reservationSeconds: 2592001 },
      { reservationSeconds: 1.5 },
      { title: " " },
      { conditions: " " },
      { reason: " " },
      { scope: randomUUID() + "x" },
      { reason: "x".repeat(2001) },
    ])
      expect(
        catalogCreationRequestSchema.safeParse({ ...body, ...patch }).success,
      ).toBe(false);
    expect(
      catalogCreationRequestSchema.safeParse({
        ...body,
        reservationSeconds: 2592000,
        price: 1000000,
      }).success,
    ).toBe(true);
  });
  it("requires disabled initial version 1 and creation-only audit context", () => {
    const creation = {
      rewardId: randomUUID(),
      initial: {
        id: randomUUID(),
        version: 1,
        title: body.title,
        conditions: body.conditions,
        price: 19,
        enabled: false,
        effectiveFrom: "2026-10-05T10:00:00.123456Z",
        reservationSeconds: null,
      },
    };
    const response = {
      scope: body.scope,
      creationId: randomUUID(),
      creation,
      updatedAt: "2026-10-05T10:00:00.123456Z",
    };
    expect(catalogCreationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    for (const initial of [
      { ...creation.initial, enabled: true },
      { ...creation.initial, version: 2 },
    ])
      expect(
        catalogCreationResponseSchema.safeParse({
          ...response,
          creation: { ...creation, initial },
        }).success,
      ).toBe(false);
    const item = {
      id: randomUUID(),
      requestId: randomUUID(),
      action: "catalog.create",
      actor: { id: randomUUID(), displayName: "Synthetic" },
      occurredAt: response.updatedAt,
      reason: body.reason,
      task: null,
      reward: null,
      reviewId: null,
      correctionId: null,
      catalog: null,
      quota: null,
      creation,
      values: [],
    };
    const page = {
      scope: { id: body.scope, name: "Synthetic" },
      scopes: [],
      updatedAt: response.updatedAt,
      nextCursor: null,
      items: [item],
    };
    expect(auditResponseSchema.safeParse(page).success).toBe(true);
    for (const patch of [
      { creation: null },
      { action: "quota.publish" },
      { task: { id: randomUUID(), currentTitle: "Other" } },
      { values: [{ field: "price", value: 19 }] },
    ])
      expect(
        auditResponseSchema.safeParse({
          ...page,
          items: [{ ...item, ...patch }],
        }).success,
      ).toBe(false);
  });
});
