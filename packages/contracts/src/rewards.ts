import { z } from "zod";
import { accountBalanceSchema } from "./ledger";

const scopeSchema = z.object({ id: z.uuid(), name: z.string().min(1) });
const rewardCursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("catalog"),
  rewardId: z.uuid(),
  versionId: z.uuid(),
  quotaId: z.uuid(),
});
export const rewardCursorSchema = z
  .string()
  .max(240)
  .transform((value, ctx) => {
    const [actor, scope, purpose, rewardId, versionId, quotaId, extra] =
      value.split("|");
    const parsed = rewardCursorParts.safeParse({
      actor,
      scope,
      purpose,
      rewardId,
      versionId,
      quotaId,
    });
    if (!parsed.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid catalog cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });
export const rewardListQuerySchema = z.strictObject({
  scope: z.uuid().optional(),
  cursor: rewardCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const redemptionCursorParts = z
  .strictObject({
    actor: z.uuid(),
    scope: z.uuid().or(z.literal("all")),
    purpose: z.enum(["mine", "decide", "fulfill"]),
    id: z.uuid(),
  })
  .refine((c) => (c.purpose === "mine") === (c.scope === "all"));
export const redemptionCursorSchema = z
  .string()
  .max(160)
  .transform((value, ctx) => {
    const [actor, scope, purpose, id, extra] = value.split("|");
    const parsed = redemptionCursorParts.safeParse({
      actor,
      scope,
      purpose,
      id,
    });
    if (!parsed.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid redemption cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });
export const redemptionListQuerySchema = z.strictObject({
  cursor: redemptionCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const reserveRewardRequestSchema = z.strictObject({
  rewardVersionId: z.uuid(),
  quotaPeriodId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
export const cancelRedemptionRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
export const decideRedemptionRequestSchema =
  cancelRedemptionRequestSchema.extend({
    decision: z.enum(["approve", "reject", "expire"]),
  });
export const fulfillRedemptionRequestSchema = cancelRedemptionRequestSchema;
export const redemptionReviewQuerySchema = redemptionListQuerySchema.extend({
  scope: z.uuid().optional(),
});
export const redemptionSchema = z
  .object({
    id: z.uuid(),
    rewardId: z.uuid(),
    rewardVersionId: z.uuid(),
    quotaPeriodId: z.uuid(),
    scope: scopeSchema,
    title: z.string().min(1).max(120),
    conditions: z.string().min(1).max(2000),
    price: z.number().int().positive(),
    rewardVersion: z.number().int().positive(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable().default(null),
    status: z.enum([
      "pending",
      "cancelled",
      "approved",
      "rejected",
      "fulfilled",
      "expired",
    ]),
    cancellationReason: z.string().nullable(),
    decision: z
      .object({
        actorId: z.uuid().nullable(),
        displayName: z.string().min(1),
        reason: z.string().min(1).max(2000),
        decidedAt: z.iso.datetime(),
      })
      .nullable()
      .default(null),
    fulfillment: z
      .object({
        actorId: z.uuid(),
        displayName: z.string().min(1),
        reason: z.string().min(1).max(2000),
        fulfilledAt: z.iso.datetime(),
        entitlementId: z.uuid(),
      })
      .nullable()
      .default(null),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(
    (item) =>
      item.decision?.actorId !== null ||
      (item.status === "expired" &&
        item.expiresAt !== null &&
        item.decision.displayName === "Автоматическое истечение резерва" &&
        item.decision.reason ===
          "Автоматическое истечение синтетического резерва" &&
        Date.parse(item.decision.decidedAt) >= Date.parse(item.expiresAt)),
    {
      message: "Automatic decision must expire a reservation",
    },
  );
export const rewardCatalogResponseSchema = z.object({
  mode: z.literal("synthetic"),
  scopes: z.array(scopeSchema),
  scope: scopeSchema.nullable(),
  balance: accountBalanceSchema,
  items: z.array(
    z.object({
      id: z.uuid(),
      rewardId: z.uuid(),
      version: z.number().int().positive(),
      title: z.string().min(1).max(120),
      conditions: z.string().min(1).max(2000),
      price: z.number().int().positive(),
      reservationSeconds: z
        .number()
        .int()
        .positive()
        .max(2147483647)
        .nullable()
        .default(null),
      quota: z.object({
        id: z.uuid(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        available: z.number().int().nonnegative(),
      }),
      hasPendingRequest: z.boolean(),
      owned: z.boolean().default(false),
    }),
  ),
  nextCursor: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export const redemptionListResponseSchema = z.object({
  mode: z.literal("synthetic"),
  items: z.array(redemptionSchema),
  nextCursor: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export const redemptionMutationResponseSchema = z.object({
  mode: z.literal("synthetic"),
  redemption: redemptionSchema,
  balance: accountBalanceSchema,
});
export const redemptionDecisionResponseSchema = z.object({
  mode: z.literal("synthetic"),
  redemption: redemptionSchema,
});
export const redemptionReviewResponseSchema = z.object({
  mode: z.literal("synthetic"),
  scopes: z.array(scopeSchema),
  scope: scopeSchema.nullable(),
  items: z.array(
    z.object({
      redemption: redemptionSchema,
      recipient: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
    }),
  ),
  nextCursor: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type RedemptionReviewResponse = z.infer<
  typeof redemptionReviewResponseSchema
>;
export type RewardCatalogResponse = z.infer<typeof rewardCatalogResponseSchema>;
export type RedemptionListResponse = z.infer<
  typeof redemptionListResponseSchema
>;
export type RedemptionMutationResponse = z.infer<
  typeof redemptionMutationResponseSchema
>;
export type Redemption = z.infer<typeof redemptionSchema>;
