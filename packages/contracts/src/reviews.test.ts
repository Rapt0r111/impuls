import { describe, expect, it } from "vitest";
import { reviewListQuerySchema, taskReturnRequestSchema } from "./reviews";

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
