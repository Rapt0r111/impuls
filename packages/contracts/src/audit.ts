import { z } from "zod";
import { catalogCancellationEvidenceSchema } from "./catalog-cancellation";
import { catalogCreationEvidenceSchema } from "./catalog-creation";
import { catalogPublicationEvidenceSchema } from "./catalog-publication";
import { quotaPublicationEvidenceSchema } from "./quota-publication";

export const auditActionSchema = z.enum([
  "task.create",
  "task.assign",
  "task.edit",
  "task.cancel",
  "task.return",
  "task.accept",
  "ledger.correct",
  "reward.reserve",
  "reward.cancel",
  "reward.approve",
  "reward.reject",
  "reward.fulfill",
  "reward.expire",
  "catalog.create",
  "catalog.publish",
  "catalog.cancel",
  "quota.publish",
]);
const cursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  action: auditActionSchema.or(z.literal("all")),
  id: z.uuid(),
});
export const auditCursorSchema = z
  .string()
  .max(160)
  .transform((value, ctx) => {
    const [actor, scope, action, id, extra] = value.split("|");
    const parsed = cursorParts.safeParse({ actor, scope, action, id });
    if (!parsed.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid audit cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });
export const auditQuerySchema = z.strictObject({
  scope: z.uuid().optional(),
  action: auditActionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: auditCursorSchema.optional(),
});
export const auditFieldSchema = z.enum([
  "from",
  "to",
  "status",
  "version",
  "title",
  "criteria",
  "categoryCode",
  "priority",
  "dueAt",
  "fundXp",
  "fundPoints",
  "assigneeId",
  "ruleSetId",
  "ruleVersion",
  "xp",
  "points",
  "xpDelta",
  "pointsDelta",
  "seasonKey",
  "balanceVersion",
  "price",
  "rewardVersion",
  "quotaPeriodId",
  "availableDelta",
  "reservedDelta",
  "entitlementId",
]);
const scopeSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
});
const numericFields = new Set<string>([
  "version",
  "fundXp",
  "fundPoints",
  "ruleVersion",
  "xp",
  "points",
  "xpDelta",
  "pointsDelta",
  "balanceVersion",
  "price",
  "rewardVersion",
  "availableDelta",
  "reservedDelta",
]);
const savedValueSchema = z
  .strictObject({
    field: auditFieldSchema,
    value: z
      .string()
      .min(1)
      .max(2000)
      .or(z.number().int().min(-2147483647).max(2147483647)),
  })
  .superRefine(({ field, value }, ctx) => {
    const numeric = numericFields.has(field);
    const delta = field === "xpDelta" || field === "pointsDelta";
    const version =
      field === "version" ||
      field === "ruleVersion" ||
      field === "balanceVersion" ||
      field === "rewardVersion" ||
      field === "price";
    const signed = field === "availableDelta" || field === "reservedDelta";
    const identifier = field === "quotaPeriodId" || field === "entitlementId";
    if (
      numeric !== (typeof value === "number") ||
      (identifier && !z.uuid().safeParse(value).success) ||
      (typeof value === "number" &&
        (delta ? value > 0 : !signed && value < (version ? 1 : 0)))
    )
      ctx.addIssue({ code: "custom", message: "Invalid saved field value" });
  });
const rewardFields: Partial<
  Record<z.infer<typeof auditActionSchema>, readonly string[]>
> = {
  "reward.reserve": [
    "status",
    "price",
    "rewardVersion",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.cancel": [
    "status",
    "price",
    "rewardVersion",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.approve": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.reject": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.fulfill": ["from", "to", "version", "entitlementId"],
  "reward.expire": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
};
const rewardOnlyFields = new Set([
  "price",
  "rewardVersion",
  "quotaPeriodId",
  "availableDelta",
  "reservedDelta",
  "entitlementId",
]);
export const auditResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scopes: z.array(scopeSchema),
  scope: scopeSchema,
  updatedAt: z.iso.datetime(),
  nextCursor: z.string().max(160).nullable(),
  items: z
    .array(
      z
        .strictObject({
          id: z.uuid(),
          requestId: z.uuid(),
          action: auditActionSchema,
          actor: z.strictObject({
            id: z.uuid().nullable(),
            displayName: z.string().min(1),
          }),
          occurredAt: z.iso.datetime(),
          reason: z.string().min(1).max(2000),
          task: z
            .strictObject({
              id: z.uuid(),
              currentTitle: z.string().min(1).max(120),
            })
            .nullable(),
          reward: z
            .strictObject({
              redemptionId: z.uuid(),
              rewardId: z.uuid(),
              rewardVersionId: z.uuid(),
              quotaPeriodId: z.uuid(),
              title: z.string().min(1).max(120),
              conditions: z.string().min(1).max(2000),
              price: z.number().int().min(1).max(1000000),
              rewardVersion: z.number().int().min(1).max(2147483647),
              periodStart: z.iso.datetime(),
              periodEnd: z.iso.datetime(),
              expiresAt: z.iso.datetime().nullable().default(null),
              recipient: z.strictObject({
                id: z.uuid(),
                displayName: z.string().min(1),
              }),
            })
            .nullable(),
          reviewId: z.uuid().nullable(),
          correctionId: z.uuid().nullable(),
          creation: catalogCreationEvidenceSchema.nullable().default(null),
          catalog: catalogPublicationEvidenceSchema.nullable().default(null),
          quota: quotaPublicationEvidenceSchema.nullable().default(null),
          cancellation: catalogCancellationEvidenceSchema
            .nullable()
            .default(null),
          values: z.array(savedValueSchema).max(20),
        })
        .superRefine((item, ctx) => {
          if (
            item.actor.id === null &&
            (item.action !== "reward.expire" ||
              item.actor.displayName !== "Автоматическое истечение резерва" ||
              item.reason !== "Автоматическое истечение синтетического резерва")
          )
            ctx.addIssue({
              code: "custom",
              message: "Invalid automatic actor",
            });
          if (item.action === "catalog.cancel") {
            if (
              !item.cancellation ||
              item.creation ||
              item.quota ||
              item.catalog ||
              item.task ||
              item.reward ||
              item.reviewId ||
              item.correctionId ||
              item.values.length
            )
              ctx.addIssue({
                code: "custom",
                message: "Invalid catalog cancellation evidence",
              });
            return;
          }
          if (item.cancellation)
            ctx.addIssue({
              code: "custom",
              message: "Unexpected catalog cancellation evidence",
            });
          if (item.action === "catalog.create") {
            if (
              !item.creation ||
              item.quota ||
              item.catalog ||
              item.task ||
              item.reward ||
              item.reviewId ||
              item.correctionId ||
              item.values.length
            )
              ctx.addIssue({
                code: "custom",
                message: "Invalid catalog creation evidence",
              });
            return;
          }
          if (item.creation)
            ctx.addIssue({
              code: "custom",
              message: "Unexpected catalog creation evidence",
            });
          if (item.action === "quota.publish") {
            if (
              !item.quota ||
              item.catalog ||
              item.task ||
              item.reward ||
              item.reviewId ||
              item.correctionId ||
              item.values.length
            )
              ctx.addIssue({
                code: "custom",
                message: "Invalid quota publication evidence",
              });
            return;
          }
          if (item.quota)
            ctx.addIssue({
              code: "custom",
              message: "Unexpected quota publication evidence",
            });
          if (item.action === "catalog.publish") {
            if (
              !item.catalog ||
              item.catalog.published.version <= item.catalog.previousVersion ||
              item.task ||
              item.reward ||
              item.reviewId ||
              item.correctionId ||
              item.values.length
            )
              ctx.addIssue({
                code: "custom",
                message: "Invalid catalog publication evidence",
              });
            return;
          }
          if (item.catalog)
            ctx.addIssue({
              code: "custom",
              message: "Unexpected publication evidence",
            });
          const reward = item.action.startsWith("reward.");
          if (
            reward
              ? !item.reward ||
                item.task !== null ||
                item.reviewId !== null ||
                item.correctionId !== null
              : !item.task || item.reward !== null
          )
            ctx.addIssue({
              code: "custom",
              message: "Invalid audit object context",
            });
          if (
            item.values.some(({ field }) =>
              reward
                ? !rewardFields[item.action]!.includes(field)
                : rewardOnlyFields.has(field),
            )
          )
            ctx.addIssue({
              code: "custom",
              message: "Invalid audit evidence context",
            });
        }),
    )
    .max(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditResponse = z.infer<typeof auditResponseSchema>;
