import { describe, expect, it } from "vitest";
import {
  notificationAttemptsCursorSchema,
  notificationAttemptsQuerySchema,
  notificationAttemptsResponseSchema,
  notificationAttemptSchema,
} from "./notification-attempts";

const actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  id = "c1111111-1111-4111-8111-111111111111";
const cursor = `${actor}|${scope}|notification-attempts|${id}`;
const row = {
  id,
  eventId: actor,
  kind: "task.assigned",
  attempt: 1,
  phase: "started",
  recordedAt: "2026-10-05T09:00:00.000Z",
  errorCode: null,
};
describe("F08 attempt journal wire boundary", () => {
  it("requires exact scope and bounded pagination with purpose-bound cursor", () => {
    expect(notificationAttemptsQuerySchema.parse({ scope }).limit).toBe(10);
    expect(notificationAttemptsCursorSchema.parse(cursor)).toEqual({
      actor,
      scope,
      purpose: "notification-attempts",
      journalId: id,
    });
    expect(
      notificationAttemptsQuerySchema.parse({ scope, limit: "50", cursor })
        .cursor?.journalId,
    ).toBe(id);
    for (const value of [
      {},
      { scope, limit: "0" },
      { scope, limit: "51" },
      { scope, limit: "1.5" },
      { scope, recipient: id },
      { scope, cursor: `${cursor}|extra` },
      {
        scope,
        cursor: cursor.replace("notification-attempts", "notification-events"),
      },
    ])
      expect(notificationAttemptsQuerySchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("allows only fixed phase reasons and forbids private or invented fields", () => {
    expect(notificationAttemptSchema.parse(row)).toEqual(row);
    for (const value of [
      { ...row, phase: "sent" },
      { ...row, attempt: 0 },
      { ...row, attempt: 6 },
      { ...row, phase: "retry" },
      { ...row, phase: "retry", errorCode: "attempts_exhausted" },
      { ...row, phase: "suppressed", errorCode: "timeout" },
      { ...row, phase: "suppressed", errorCode: "rate_limited" },
      { ...row, phase: "retry", errorCode: "recipient_unreachable" },
      { ...row, phase: "delivered", errorCode: "timeout" },
      { ...row, errorCode: "BOT SECRET" },
      { ...row, leaseToken: id },
      { ...row, recipientId: id },
      { ...row, text: "private" },
    ])
      expect(notificationAttemptSchema.safeParse(value).success).toBe(false);
    for (const [phase, errorCode] of [
      ["retry", "timeout"],
      ["failed", "attempts_exhausted"],
      ["suppressed", "recipient_inactive"],
      ["lease_expired", null],
      ["delivered", null],
      ["retry", "rate_limited"],
      ["failed", "rate_limited"],
      ["suppressed", "recipient_unreachable"],
    ])
      expect(
        notificationAttemptSchema.safeParse({ ...row, phase, errorCode })
          .success,
      ).toBe(true);
  });
  it("strictly projects a simulation page and validates outgoing cursor", () => {
    const page = {
      mode: "simulation",
      scope: { id: scope, name: "Synthetic scope" },
      items: [row],
      updatedAt: row.recordedAt,
      nextCursor: cursor,
    };
    expect(notificationAttemptsResponseSchema.parse(page)).toEqual(page);
    for (const value of [
      { ...page, mode: "delivery" },
      { ...page, nextCursor: id },
      { ...page, recipients: [] },
      { ...page, items: Array(51).fill(row) },
    ])
      expect(notificationAttemptsResponseSchema.safeParse(value).success).toBe(
        false,
      );
  });
});
