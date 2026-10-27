import { z } from "zod";
const instant = z.iso
  .datetime({ precision: 3 })
  .refine((v) => new Date(v).toISOString() === v);
export const quotaPublicationRequestSchema = z
  .strictObject({
    scope: z.uuid(),
    startsAt: instant,
    endsAt: instant,
    capacity: z.number().int().min(0).max(1000000).nullable(),
    reason: z.string().trim().min(1).max(2000),
  })
  .refine((v) => v.endsAt > v.startsAt);
export const quotaPublicationEvidenceSchema = z
  .strictObject({
    rewardId: z.uuid(),
    periodId: z.uuid(),
    startsAt: instant,
    endsAt: instant,
    capacity: z.number().int().min(0).max(1000000).nullable(),
  })
  .refine((v) => v.endsAt > v.startsAt);
export const quotaPublicationResponseSchema = z.strictObject({
  scope: z.uuid(),
  publicationId: z.uuid(),
  quota: quotaPublicationEvidenceSchema,
  updatedAt: z.iso.datetime(),
});
export type QuotaPublicationRequest = z.infer<
  typeof quotaPublicationRequestSchema
>;
export type QuotaPublicationResponse = z.infer<
  typeof quotaPublicationResponseSchema
>;
