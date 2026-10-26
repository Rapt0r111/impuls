import { z } from "zod";
import { adminCatalogVersionSchema } from "./admin-catalog";

export const catalogCreationRequestSchema = z.strictObject({
  scope: z.uuid(),
  title: z.string().trim().min(1).max(120),
  conditions: z.string().trim().min(1).max(2000),
  price: z.number().int().min(1).max(1000000),
  reservationSeconds: z.number().int().min(1).max(2592000).nullable(),
  reason: z.string().trim().min(1).max(2000),
});
export const catalogCreationEvidenceSchema = z.strictObject({
  rewardId: z.uuid(),
  initial: adminCatalogVersionSchema.extend({
    version: z.literal(1),
    enabled: z.literal(false),
  }),
});
export const catalogCreationResponseSchema = z.strictObject({
  scope: z.uuid(),
  creationId: z.uuid(),
  creation: catalogCreationEvidenceSchema,
  updatedAt: z.iso.datetime(),
});
export type CatalogCreationRequest = z.infer<
  typeof catalogCreationRequestSchema
>;
export type CatalogCreationResponse = z.infer<
  typeof catalogCreationResponseSchema
>;
