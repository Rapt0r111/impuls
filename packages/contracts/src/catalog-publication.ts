import { z } from "zod";
import { adminCatalogVersionSchema } from "./admin-catalog";

export const catalogPublicationRequestSchema = z.strictObject({
  scope: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
  title: z.string().trim().min(1).max(120),
  conditions: z.string().trim().min(1).max(2000),
  price: z.number().int().min(1).max(1000000),
  enabled: z.boolean(),
  reservationSeconds: z.number().int().min(1).max(2592000).nullable(),
  reason: z.string().trim().min(1).max(2000),
});
export const catalogPublicationEvidenceSchema = z.strictObject({
  rewardId: z.uuid(),
  previousVersion: z.number().int().positive(),
  published: adminCatalogVersionSchema,
});
export const catalogSchedulingRequestSchema =
  catalogPublicationRequestSchema.extend({
    effectiveFrom: z.iso.datetime({ precision: 3 }),
  });
export type CatalogSchedulingRequest = z.infer<
  typeof catalogSchedulingRequestSchema
>;
export const catalogPublicationResponseSchema = z
  .strictObject({
    mode: z.literal("synthetic"),
    scope: z.uuid(),
    publicationId: z.uuid(),
    catalog: catalogPublicationEvidenceSchema,
    updatedAt: z.iso.datetime(),
  })
  .refine(
    (value) => value.catalog.published.version > value.catalog.previousVersion,
  );
export type CatalogPublicationRequest = z.infer<
  typeof catalogPublicationRequestSchema
>;
export type CatalogPublicationResponse = z.infer<
  typeof catalogPublicationResponseSchema
>;
