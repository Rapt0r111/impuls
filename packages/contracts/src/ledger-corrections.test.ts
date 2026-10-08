import { describe, expect, it } from "vitest";
import {
  ledgerCorrectionRequestSchema,
  ledgerCorrectionQuerySchema,
} from "./ledger-corrections";

describe("F04 correction wire contract", () => {
  const input = {
    reviewId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 2,
    reason: "  Wrong acceptance  ",
  };
  it("normalizes a reason and rejects arbitrary currency amounts or identities", () => {
    expect(ledgerCorrectionRequestSchema.parse(input).reason).toBe(
      "Wrong acceptance",
    );
    for (const extra of [
      { xp: 2 },
      { points: 1 },
      { userId: input.reviewId },
      { seasonKey: "2026-10" },
      { mode: "real" },
    ])
      expect(
        ledgerCorrectionRequestSchema.safeParse({ ...input, ...extra }).success,
      ).toBe(false);
  });
  it("requires an immutable source, integer version and bounded nonblank reason", () => {
    for (const bad of [
      { reviewId: "unknown" },
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { reason: " \n " },
      { reason: "x".repeat(2001) },
    ])
      expect(
        ledgerCorrectionRequestSchema.safeParse({ ...input, ...bad }).success,
      ).toBe(false);
    expect(ledgerCorrectionQuerySchema.safeParse({ limit: 51 }).success).toBe(
      false,
    );
    expect(
      ledgerCorrectionQuerySchema.safeParse({ userId: input.reviewId }).success,
    ).toBe(false);
    expect(
      ledgerCorrectionQuerySchema.safeParse({ cursor: "not-a-cursor" }).success,
    ).toBe(false);
  });
});
