import { describe, expect, it } from "vitest";
import {
  taskHistoryQuerySchema,
  taskHistoryResponseSchema,
} from "./task-history";

const testId = "11111111-1111-4111-8111-111111111111";

describe("F03 report history contracts", () => {
  it("accepts bounded canonical integer cursors without selecting another user", () => {
    expect(taskHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      taskHistoryQuerySchema.parse({ limit: "50", cursor: "2147483647" }),
    ).toEqual({ limit: 50, cursor: 2147483647 });
    for (const cursor of [
      "",
      "0",
      "-1",
      "1.5",
      "1e2",
      "01",
      " 1",
      "Infinity",
      "2147483648",
    ])
      expect(taskHistoryQuerySchema.safeParse({ cursor }).success).toBe(false);
    for (const query of [
      { limit: "51" },
      { limit: "0" },
      { limit: "" },
      { userId: testId },
    ])
      expect(taskHistoryQuerySchema.safeParse(query).success).toBe(false);
  });
  it("requires separate accepted funds and no funds on a return", () => {
    const review = {
      id: testId,
      reason: "Independent criteria verified",
      createdAt: "2026-09-30T09:00:00.000Z",
      reviewer: { id: testId, displayName: "Synthetic reviewer" },
    };
    const item = {
      id: testId,
      attemptNumber: 1,
      text: "Synthetic result",
      submittedAt: "2026-09-30T08:00:00.000Z",
    };
    const body = {
      taskId: testId,
      items: [{ ...item, review: null }],
      nextCursor: null,
      asOf: "2026-09-30T10:00:00.000Z",
    };
    expect(taskHistoryResponseSchema.safeParse(body).success).toBe(true);
    for (const extra of [
      { decision: "accept", fundXp: 19, fundPoints: 7 },
      { decision: "accept", fundXp: 0, fundPoints: 0 },
      { decision: "return", fundXp: null, fundPoints: null },
    ])
      expect(
        taskHistoryResponseSchema.safeParse({
          ...body,
          items: [{ ...item, review: { ...review, ...extra } }],
        }).success,
      ).toBe(true);
    for (const extra of [
      { decision: "accept", fundXp: null, fundPoints: 7 },
      { decision: "accept", fundXp: -1, fundPoints: 7 },
      { decision: "return", fundXp: 19, fundPoints: 7 },
    ])
      expect(
        taskHistoryResponseSchema.safeParse({
          ...body,
          items: [{ ...item, review: { ...review, ...extra } }],
        }).success,
      ).toBe(false);
  });
});
