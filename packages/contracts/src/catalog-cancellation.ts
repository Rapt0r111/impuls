import { z } from "zod";
import { adminCatalogVersionSchema } from "./admin-catalog";

export const catalogCancellationRequestSchema = z.strictObject({
  scope: z.uuid(),
  versionId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483647),
  reason: z.string().trim().min(1).max(2000),
});
export const catalogCancellationEvidenceSchema = z.strictObject({
  rewardId: z.uuid(),
  cancelled: adminCatalogVersionSchema,
});
export const catalogCancellationResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scope: z.uuid(),
  cancellationId: z.uuid(),
  cancellation: catalogCancellationEvidenceSchema,
  updatedAt: z.iso.datetime(),
});
export type CatalogCancellationRequest = z.infer<
  typeof catalogCancellationRequestSchema
>;
