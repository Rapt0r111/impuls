import { describe, expect, it } from "vitest";
import {
  notificationStatusQuerySchema,
  notificationStatusResponseSchema,
  notificationEventsQuerySchema,
  notificationEventsResponseSchema,
} from "./notification-status";
const id = "a1111111-1111-4111-8111-111111111111";
const data = {
  mode: "simulation",
  scope: { id, name: "Synthetic" },
  scopes: [{ id, name: "Synthetic" }],
  updatedAt: "2026-10-04T10:00:00.000Z",
  recentEvents: [],
  counts: {
    unclaimed: 1,
    ready: 2,
    processing: 3,
    retry: 4,
    simulated: 5,
    delivered: 7,
    failed: 6,
    suppressed: 7,
  },
  errors: {
    transport_unavailable: 1,
    timeout: 2,
    attempts_exhausted: 3,
    recipient_inactive: 4,
    unsupported_kind: 5,
    rate_limited: 6,
    recipient_unreachable: 7,
  },
};
describe("F08 minimal simulation status contract", () => {
  it("validates exact event pages and bound cursor vocabulary", () => {
    const cursor = `${id}|${id}|notification-events|${id}`;
    expect(
      notificationEventsQuerySchema.parse({ scope: id, cursor }).cursor,
    ).toEqual({
      actor: id,
      scope: id,
      purpose: "notification-events",
      eventId: id,
    });
    expect(notificationEventsQuerySchema.parse({ scope: id }).limit).toBe(10);
    for (const query of [
      {},
      { scope: id, limit: 0 },
      { scope: id, limit: 51 },
      { scope: id, limit: 1.5 },
      { scope: id, recipient: id },
      ...[
        id,
        cursor + "|extra",
        cursor.replace("notification-events", "catalog"),
        "",
      ].map((cursor) => ({ scope: id, cursor })),
    ])
      expect(notificationEventsQuerySchema.safeParse(query).success).toBe(
        false,
      );
    const page = {
      mode: "simulation",
      scope: data.scope,
      updatedAt: data.updatedAt,
      items: [],
      nextCursor: cursor,
    };
    expect(notificationEventsResponseSchema.safeParse(page).success).toBe(true);
    for (const invalid of [
      { ...page, recipient: id },
      { ...page, nextCursor: "bad" },
      {
        ...page,
        items: [
          {
            kind: "task.assigned",
            createdAt: data.updatedAt,
            status: "unclaimed",
            errorCode: null,
            id,
          },
        ],
      },
    ])
      expect(notificationEventsResponseSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
  it("bounds recent events and rejects private or invented event fields", () => {
    const event = {
      kind: "task.assigned",
      createdAt: data.updatedAt,
      status: "unclaimed",
      errorCode: null,
    };
    expect(
      notificationStatusResponseSchema.safeParse({
        ...data,
        recentEvents: [event],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...event, recipientId: id },
      { ...event, text: "private" },
      { ...event, kind: "private.kind" },
      { ...event, status: "sent" },
      { ...event, errorCode: "bot_blocked" },
      { ...event, errorCode: "raw exception" },
      { ...event, createdAt: "yesterday" },
    ])
      expect(
        notificationStatusResponseSchema.safeParse({
          ...data,
          recentEvents: [invalid],
        }).success,
      ).toBe(false);
    expect(
      notificationStatusResponseSchema.safeParse({
        ...data,
        recentEvents: Array(21).fill(event),
      }).success,
    ).toBe(false);
  });
  it("accepts the delivery state and the two Bot API reasons as fixed codes", () => {
    for (const [status, errorCode] of [
      ["delivered", null],
      ["retry", "rate_limited"],
      ["suppressed", "recipient_unreachable"],
    ] as const)
      expect(
        notificationStatusResponseSchema.safeParse({
          ...data,
          recentEvents: [
            {
              kind: "task.assigned",
              createdAt: "2026-10-04T10:00:00.000Z",
              status,
              errorCode,
            },
          ],
        }).success,
      ).toBe(true);
  });
  it("accepts only an optional exact scope", () => {
    expect(notificationStatusQuerySchema.parse({})).toEqual({});
    expect(notificationStatusQuerySchema.parse({ scope: id })).toEqual({
      scope: id,
    });
    for (const value of [
      { scope: "" },
      { scope: "bad" },
      { recipientId: id },
      { status: "failed" },
      { limit: 20 },
    ])
      expect(notificationStatusQuerySchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("does not allow delivery claims, identifiers, private fields or unknown states", () => {
    expect(notificationStatusResponseSchema.parse(data)).toEqual(data);
    for (const value of [
      { ...data, mode: "sent" },
      { ...data, recipientId: id },
      { ...data, scopes: [] },
      { ...data, counts: { ...data.counts, sent: 1 } },
      { ...data, errors: { ...data.errors, rawException: "private" } },
      { ...data, scope: { ...data.scope, telegramId: "private" } },
    ])
      expect(notificationStatusResponseSchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("rejects missing, fractional, negative and unsafe counts", () => {
    for (const value of [undefined, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])
      expect(
        notificationStatusResponseSchema.safeParse({
          ...data,
          counts: { ...data.counts, failed: value },
        }).success,
      ).toBe(false);
  });
});
