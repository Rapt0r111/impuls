import { describe, expect, it } from "vitest";
import {
  catalogCancellationRequestSchema as request,
  catalogCancellationResponseSchema as response,
} from "./catalog-cancellation";
const id = "a1111111-1111-4111-8111-111111111111";
describe("F07 cancellation contract", () => {
  const body = {
    scope: id,
    versionId: id,
    expectedVersion: 2,
    reason: " Synthetic cancellation ",
  };
  it("requires exact target/version/reason without identity or economics overrides", () => {
    expect(request.parse(body).reason).toBe("Synthetic cancellation");
    for (const change of [
      { scope: "" },
      { versionId: "bad" },
      { expectedVersion: 0 },
      { expectedVersion: 1.1 },
      { reason: " " },
      { reason: "x".repeat(2001) },
      { price: 1 },
      { mode: "real" },
    ])
      expect(request.safeParse({ ...body, ...change }).success).toBe(false);
  });
  it("confirms the immutable cancelled snapshot and rejects private fields", () => {
    const data = {
      mode: "synthetic",
      scope: id,
      cancellationId: id,
      cancellation: {
        rewardId: id,
        cancelled: {
          id,
          version: 2,
          title: "Synthetic",
          conditions: "Synthetic only",
          price: 19,
          enabled: true,
          effectiveFrom: "2040-01-01T00:00:00.123456Z",
          reservationSeconds: null,
        },
      },
      updatedAt: "2026-10-06T00:00:00.123456Z",
    };
    expect(response.parse(data)).toEqual(data);
    expect(response.safeParse({ ...data, botToken: "private" }).success).toBe(
      false,
    );
    expect(response.safeParse({ ...data, mode: "real" }).success).toBe(false);
  });
});
