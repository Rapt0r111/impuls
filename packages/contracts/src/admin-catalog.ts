import { z } from "zod";
const scope = z.strictObject({ id: z.uuid(), name: z.string().min(1) });
const cursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("admin-catalog"),
  rewardId: z.uuid(),
});
export const adminCatalogCursorSchema = z
  .string()
  .max(160)
  .transform((value, ctx) => {
    const [actor, scope, purpose, rewardId, extra] = value.split("|");
    const result = cursorParts.safeParse({ actor, scope, purpose, rewardId });
    if (!result.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid admin catalog cursor" });
      return z.NEVER;
    }
    return result.data;
  });
export const adminCatalogQuerySchema = z.strictObject({
  scope: z.uuid().optional(),
  cursor: adminCatalogCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const adminCatalogVersionSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  conditions: z.string().min(1).max(2000),
  price: z.number().int().min(1).max(1000000),
  enabled: z.boolean(),
  effectiveFrom: z.iso.datetime(),
  reservationSeconds: z.number().int().positive().nullable(),
});
const quota = z
  .strictObject({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  })
  .refine((q) => q.capacity === q.reserved + q.used + q.available);
export const adminCatalogResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scope,
  scopes: z.array(scope).min(1),
  items: z
    .array(
      z
        .strictObject({
          rewardId: z.uuid(),
          current: adminCatalogVersionSchema.nullable(),
          scheduled: adminCatalogVersionSchema.nullable(),
          quota: quota.nullable(),
        })
        .refine((item) => item.current !== null || item.scheduled !== null),
    )
    .max(50),
  nextCursor: z.string().max(160).nullable(),
  updatedAt: z.iso.datetime(),
  canCreate: z.boolean().default(false),
  canPublish: z.boolean().default(false),
  canSchedule: z.boolean().default(false),
  canCancelSchedule: z.boolean().default(false),
  canPublishQuota: z.boolean().default(false),
});
export type AdminCatalogResponse = z.infer<typeof adminCatalogResponseSchema>;

const historyCursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("admin-catalog-history"),
  rewardId: z.uuid(),
  versionId: z.uuid(),
});
export const adminCatalogHistoryCursorSchema = z
  .string()
  .max(220)
  .transform((value, ctx) => {
    const [actor, scope, purpose, rewardId, versionId, extra] =
      value.split("|");
    const result = historyCursorParts.safeParse({
      actor,
      scope,
      purpose,
      rewardId,
      versionId,
    });
    if (!result.success || extra !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid catalog history cursor",
      });
      return z.NEVER;
    }
    return result.data;
  });
export const adminCatalogHistoryParamsSchema = z.strictObject({ id: z.uuid() });
export const adminCatalogHistoryQuerySchema = z.strictObject({
  scope: z.uuid(),
  cursor: adminCatalogHistoryCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const adminCatalogHistoryResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scope,
  rewardId: z.uuid(),
  items: z
    .array(
      adminCatalogVersionSchema.extend({
        state: z.enum(["current", "scheduled", "superseded", "cancelled"]),
      }),
    )
    .max(50),
  nextCursor: z.string().max(220).nullable(),
  updatedAt: z.iso.datetime(),
});
export type AdminCatalogHistoryResponse = z.infer<
  typeof adminCatalogHistoryResponseSchema
>;

const quotaCursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("admin-catalog-quotas"),
  rewardId: z.uuid(),
  periodId: z.uuid(),
});
export const adminCatalogQuotasCursorSchema = z
  .string()
  .max(220)
  .transform((value, ctx) => {
    const [actor, scope, purpose, rewardId, periodId, extra] = value.split("|");
    const result = quotaCursorParts.safeParse({
      actor,
      scope,
      purpose,
      rewardId,
      periodId,
    });
    if (!result.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid catalog quota cursor" });
      return z.NEVER;
    }
    return result.data;
  });
export const adminCatalogQuotasQuerySchema = z.strictObject({
  scope: z.uuid(),
  cursor: adminCatalogQuotasCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const adminCatalogQuotaPeriodSchema = z
  .strictObject({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: z.number().int().min(0).max(1000000),
    reserved: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    state: z.enum(["past", "current", "scheduled"]),
  })
  .refine(
    (q) =>
      q.capacity === q.reserved + q.used + q.available &&
      Date.parse(q.endsAt) > Date.parse(q.startsAt),
  );
export const adminCatalogQuotasResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scope,
  rewardId: z.uuid(),
  items: z.array(adminCatalogQuotaPeriodSchema).max(50),
  nextCursor: z.string().max(220).nullable(),
  updatedAt: z.iso.datetime(),
});
export type AdminCatalogQuotasResponse = z.infer<
  typeof adminCatalogQuotasResponseSchema
>;
