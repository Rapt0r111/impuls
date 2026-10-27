import { describe, expect, it } from "vitest";
import { adminCatalogQuotaPeriodSchema } from "./admin-catalog";
import {
  quotaPublicationEvidenceSchema,
  quotaPublicationRequestSchema,
} from "./quota-publication";

const id = "a1111111-1111-4111-8111-111111111111";
const period = {
  id,
  startsAt: "2040-01-01T00:00:00.000Z",
  endsAt: "2040-02-01T00:00:00.000Z",
  capacity: null,
  reserved: 2,
  used: 1,
  available: null,
  version: 1,
  state: "current",
};
const request = {
  scope: id,
  startsAt: "2040-01-01T00:00:00.000Z",
  endsAt: "2040-02-01T00:00:00.000Z",
  capacity: null,
  reason: "Synthetic unlimited quota",
};

describe("unlimited quota boundary", () => {
  it("accepts capacity null only together with available null", () => {
    expect(adminCatalogQuotaPeriodSchema.safeParse(period).success).toBe(true);
    expect(
      adminCatalogQuotaPeriodSchema.safeParse({ ...period, available: 0 })
        .success,
    ).toBe(false);
    expect(
      adminCatalogQuotaPeriodSchema.safeParse({
        ...period,
        capacity: 3,
        available: null,
      }).success,
    ).toBe(false);
    expect(
      adminCatalogQuotaPeriodSchema.safeParse({
        ...period,
        capacity: 5,
        available: 2,
      }).success,
    ).toBe(true);
  });

  it("publishes unlimited quota requests and evidence, but not negative capacity", () => {
    expect(quotaPublicationRequestSchema.safeParse(request).success).toBe(true);
    expect(
      quotaPublicationRequestSchema.safeParse({ ...request, capacity: -1 })
        .success,
    ).toBe(false);
    expect(
      quotaPublicationEvidenceSchema.safeParse({
        rewardId: id,
        periodId: id,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        capacity: null,
      }).success,
    ).toBe(true);
  });
});
