import { describe, it, expect } from "vitest";
import {
  catalogPublicationRequestSchema as schema,
  catalogPublicationResponseSchema,
  catalogSchedulingRequestSchema,
} from "./catalog-publication";
const id = "a1111111-1111-4111-8111-111111111111";
const body = {
  scope: id,
  expectedVersion: 1,
  title: " Synthetic title ",
  conditions: " Synthetic conditions ",
  price: 19,
  enabled: false,
  reservationSeconds: null,
  reason: " Synthetic publication ",
};
describe("catalog publication contract", () => {
  it("requires a UTC millisecond date only for the separate scheduling contract", () => {
    expect(
      catalogSchedulingRequestSchema.safeParse({
        ...body,
        effectiveFrom: "2040-01-01T12:30:00.000Z",
      }).success,
    ).toBe(true);
    for (const effectiveFrom of [
      undefined,
      "2040-01-01T12:30",
      "2040-01-01T12:30:00+03:00",
      "2040-01-01T12:30:00Z",
      "2040-02-30T00:00:00.000Z",
    ])
      expect(
        catalogSchedulingRequestSchema.safeParse({ ...body, effectiveFrom })
          .success,
      ).toBe(false);
    expect(
      catalogSchedulingRequestSchema.safeParse({
        ...body,
        effectiveFrom: "2040-01-01T12:30:00.000Z",
        mode: "real",
      }).success,
    ).toBe(false);
  });
  it("normalizes text without accepting policy or identity overrides", () => {
    expect(schema.parse(body)).toMatchObject({
      title: "Synthetic title",
      reason: "Synthetic publication",
    });
    for (const field of [
      "rewardId",
      "effectiveFrom",
      "kind",
      "mode",
      "capacity",
    ])
      expect(schema.safeParse({ ...body, [field]: id }).success).toBe(false);
  });
  it("rejects empty reasons, fractional economics, and unsupported durations", () => {
    for (const change of [
      { reason: " " },
      { title: "" },
      { conditions: "" },
      { price: 0 },
      { price: 1.1 },
      { price: 1000001 },
      { reservationSeconds: 0 },
      { reservationSeconds: 2592001 },
      { enabled: "true" },
      { expectedVersion: 2147483647 },
    ])
      expect(schema.safeParse({ ...body, ...change }).success).toBe(false);
  });
  it("requires a sequential published snapshot", () => {
    const response = {
      scope: id,
      publicationId: id,
      catalog: {
        rewardId: id,
        previousVersion: 1,
        published: {
          id,
          version: 2,
          title: "Title",
          conditions: "Conditions",
          price: 19,
          enabled: false,
          effectiveFrom: "2026-10-05T12:00:00.123456Z",
          reservationSeconds: null,
        },
      },
      updatedAt: "2026-10-05T12:00:00.123456Z",
    };
    expect(catalogPublicationResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      catalogPublicationResponseSchema.safeParse({
        ...response,
        catalog: { ...response.catalog, previousVersion: 2 },
      }).success,
    ).toBe(false);
  });
});
