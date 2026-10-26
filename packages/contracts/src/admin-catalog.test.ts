import { describe, expect, it } from "vitest";
import {
  adminCatalogCursorSchema,
  adminCatalogQuerySchema,
  adminCatalogResponseSchema,
  adminCatalogHistoryCursorSchema,
  adminCatalogHistoryQuerySchema,
  adminCatalogHistoryResponseSchema,
  adminCatalogQuotasCursorSchema,
  adminCatalogQuotasQuerySchema,
  adminCatalogQuotasResponseSchema,
} from "./admin-catalog";
const id = "a1111111-1111-4111-8111-111111111111";
const data = {
  scope: { id, name: "Synthetic" },
  scopes: [{ id, name: "Synthetic" }],
  items: [
    {
      rewardId: id,
      current: {
        id,
        version: 1,
        title: "Cosmetic",
        conditions: "Synthetic only",
        price: 7,
        enabled: false,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        reservationSeconds: null,
      },
      scheduled: null,
      quota: null,
    },
  ],
  nextCursor: null,
  updatedAt: "2026-10-04T00:00:00.000Z",
};
describe("F07 read-only catalog contracts", () => {
  it("accepts only bounded read parameters and purpose-bound cursors", () => {
    expect(adminCatalogQuerySchema.parse({}).limit).toBe(20);
    expect(
      adminCatalogCursorSchema.parse(`${id}|${id}|admin-catalog|${id}`).purpose,
    ).toBe("admin-catalog");
    for (const q of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { price: 7 },
      { scope: "" },
      { cursor: `${id}|${id}|catalog|${id}` },
      { cursor: `${id}|${id}|admin-catalog|${id}|extra` },
    ])
      expect(adminCatalogQuerySchema.safeParse(q).success).toBe(false);
  });
  it("keeps disabled terms but rejects invalid or private response fields", () => {
    expect(adminCatalogResponseSchema.parse(data)).toEqual({
      ...data,
      canCreate: false,
      canPublish: false,
      canSchedule: false,
      canCancelSchedule: false,
      canPublishQuota: false,
    });
    for (const invalid of [
      { ...data, mode: "real" },
      { ...data, recipientId: id },
      { ...data, scopes: [] },
      { ...data, items: [{ ...data.items[0], current: null }] },
      { ...data, items: Array(51).fill(data.items[0]) },
      {
        ...data,
        items: [
          {
            ...data.items[0],
            current: { ...data.items[0]!.current, botToken: "private" },
          },
        ],
      },
    ])
      expect(adminCatalogResponseSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires independent quota components to reconcile", () => {
    const quota = {
      id,
      startsAt: data.updatedAt,
      endsAt: "2040-01-01T00:00:00.000Z",
      capacity: 9,
      reserved: 2,
      used: 3,
      available: 4,
    };
    expect(
      adminCatalogResponseSchema.safeParse({
        ...data,
        items: [{ ...data.items[0], quota }],
      }).success,
    ).toBe(true);
    expect(
      adminCatalogResponseSchema.safeParse({
        ...data,
        items: [{ ...data.items[0], quota: { ...quota, available: 5 } }],
      }).success,
    ).toBe(false);
  });
});

describe("F07 quota period contracts", () => {
  const period = {
    id,
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2021-01-01T00:00:00.000Z",
    capacity: 9,
    reserved: 2,
    used: 3,
    available: 4,
    version: 1,
    state: "past",
  };
  const response = {
    scope: data.scope,
    rewardId: id,
    items: [period],
    nextCursor: null,
    updatedAt: data.updatedAt,
  };
  it("requires exact scope and a quota-specific bounded cursor", () => {
    const cursor = `${id}|${id}|admin-catalog-quotas|${id}|${id}`;
    expect(adminCatalogQuotasQuerySchema.parse({ scope: id }).limit).toBe(10);
    expect(adminCatalogQuotasCursorSchema.parse(cursor).periodId).toBe(id);
    for (const input of [
      {},
      { scope: id, limit: 0 },
      { scope: id, limit: 51 },
      { scope: id, limit: 1.5 },
      { scope: id, price: 7 },
      { scope: id, cursor: `${cursor}|extra` },
      { scope: id, cursor: `${id}|${id}|admin-catalog-history|${id}|${id}` },
    ])
      expect(adminCatalogQuotasQuerySchema.safeParse(input).success).toBe(
        false,
      );
  });
  it("requires reconciled nonnegative counters, valid dates and only allowed fields", () => {
    expect(adminCatalogQuotasResponseSchema.parse(response)).toEqual(response);
    for (const change of [
      { available: 5 },
      { reserved: -1 },
      { capacity: 1000001 },
      { version: 0 },
      { state: "delivered" },
      { recipientId: id },
      { endsAt: period.startsAt },
      { startsAt: period.endsAt },
    ])
      expect(
        adminCatalogQuotasResponseSchema.safeParse({
          ...response,
          items: [{ ...period, ...change }],
        }).success,
      ).toBe(false);
    expect(
      adminCatalogQuotasResponseSchema.safeParse({
        ...response,
        items: Array(51).fill(period),
      }).success,
    ).toBe(false);
    expect(
      adminCatalogQuotasResponseSchema.safeParse({ ...response, mode: "real" })
        .success,
    ).toBe(false);
    expect(
      adminCatalogQuotasResponseSchema.safeParse({
        ...response,
        items: [{ ...period, capacity: 0, reserved: 0, used: 0, available: 0 }],
      }).success,
    ).toBe(true);
  });
});

describe("F07 catalog version history contracts", () => {
  it("requires exact scope, bounded limits and a history-specific cursor", () => {
    const cursor = `${id}|${id}|admin-catalog-history|${id}|${id}`;
    expect(adminCatalogHistoryQuerySchema.parse({ scope: id }).limit).toBe(10);
    expect(adminCatalogHistoryCursorSchema.parse(cursor).versionId).toBe(id);
    for (const input of [
      {},
      { scope: id, limit: 0 },
      { scope: id, limit: 51 },
      { scope: id, price: 1 },
      { scope: id, cursor: `${id}|${id}|admin-catalog|${id}` },
      { scope: id, cursor: `${cursor}|extra` },
    ])
      expect(adminCatalogHistoryQuerySchema.safeParse(input).success).toBe(
        false,
      );
  });
  it("preserves microsecond dates and limits projection to saved conditions", () => {
    const response = {
      scope: data.scope,
      rewardId: id,
      items: [
        {
          ...data.items[0]!.current,
          effectiveFrom: "2026-01-01T00:00:00.000001Z",
          state: "superseded",
        },
      ],
      nextCursor: null,
      updatedAt: data.updatedAt,
    };
    expect(adminCatalogHistoryResponseSchema.parse(response)).toEqual(response);
    for (const invalid of [
      { ...response, actorId: id },
      { ...response, items: Array(51).fill(response.items[0]) },
      { ...response, items: [{ ...response.items[0], state: "delivered" }] },
      { ...response, items: [{ ...response.items[0], balance: 7 }] },
    ])
      expect(adminCatalogHistoryResponseSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});
