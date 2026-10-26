import { z } from "zod";
import { assignedTaskSummarySchema, taskIdSchema } from "./tasks";
import { acceptanceAwardSchema } from "./ledger";
import { taskPointsSchema, taskXpSchema } from "./points";

export const reviewListQuerySchema = z.strictObject({
  cursor: taskIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const acceptanceBonusSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  title: z.string().min(1).max(80),
  xp: z.number().int().min(0).max(2_147_483_647),
  points: z.number().int().min(0).max(2_147_483_647),
});
export const acceptanceOptionsSchema = z.object({
  adjustment: z
    .object({
      // Absent in responses saved before ADR-0031: the lower bound was then always 0.
      minXp: z.number().int().min(0).max(2_147_483_647).default(0),
      minPoints: z.number().int().min(0).max(2_147_483_647).default(0),
      maxXp: z.number().int().min(0).max(2_147_483_647),
      maxPoints: z.number().int().min(0).max(2_147_483_647),
    })
    .nullable(),
  bonuses: z.array(acceptanceBonusSchema).max(7),
});
export const reviewQueueItemSchema = z.object({
  submissionId: z.uuid(),
  text: z.string().min(1).max(4000),
  submittedAt: z.iso.datetime(),
  attemptNumber: z.number().int().positive(),
  acceptance: z
    .object({
      enabled: z.boolean(),
      options: acceptanceOptionsSchema.default({
        adjustment: null,
        bonuses: [],
      }),
    })
    .default({
      enabled: false,
      options: { adjustment: null, bonuses: [] },
    }),
  author: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
  // Рекомендация проверяющего за этот отчёт; командир видит её в форме приёмки.
  recommendation: z
    .object({
      verifierName: z.string().min(1).max(80),
      xp: taskXpSchema,
      points: taskPointsSchema,
    })
    .nullable()
    .default(null),
  // Проверяющий задачи может рекомендовать значения и вернуть отчёт, но не принять его.
  canRecommend: z.boolean().default(false),
  task: assignedTaskSummarySchema.extend({
    criteria: z.string().min(1).max(2000),
    scope: z.object({
      id: z.uuid(),
      kind: z.enum(["rota", "group", "project"]),
      name: z.string().min(1).max(80),
    }),
  }),
});
export const reviewListResponseSchema = z.object({
  items: z.array(reviewQueueItemSchema),
  nextCursor: z.uuid().nullable(),
});
export const taskReturnRequestSchema = z.strictObject({
  action: z.literal("return"),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
export const taskReturnResponseSchema = z.object({
  review: z.object({
    id: z.uuid(),
    submissionId: z.uuid(),
    decision: z.literal("return"),
    reason: z.string().min(1).max(2000),
    createdAt: z.iso.datetime(),
  }),
  task: z.object({
    id: z.uuid(),
    status: z.literal("needs_work"),
    version: z.number().int().positive(),
  }),
});
export const taskRecommendRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  recommendedXp: taskXpSchema,
  recommendedPoints: taskPointsSchema,
});
export const taskRecommendationResponseSchema = z.object({
  recommendation: z.object({
    submissionId: z.uuid(),
    xp: taskXpSchema,
    points: taskPointsSchema,
    updatedAt: z.iso.datetime(),
  }),
});
export const taskAcceptanceRequestSchema = z.strictObject({
  action: z.literal("accept"),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
  // Omitted fields mean "pay the task fund unchanged, without a bonus".
  baseXp: taskXpSchema.optional(),
  basePoints: taskPointsSchema.optional(),
  bonusCode: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .optional(),
});
export const taskReviewRequestSchema = z.discriminatedUnion("action", [
  taskReturnRequestSchema,
  taskAcceptanceRequestSchema,
]);
export const taskAcceptanceResponseSchema = z.object({
  review: z.object({
    id: z.uuid(),
    submissionId: z.uuid(),
    decision: z.literal("accept"),
    reason: z.string().min(1).max(2000),
    createdAt: z.iso.datetime(),
  }),
  task: z.object({
    id: z.uuid(),
    status: z.literal("accepted"),
    version: z.number().int().positive(),
  }),
  award: acceptanceAwardSchema,
});
export type TaskAcceptanceResponse = z.infer<
  typeof taskAcceptanceResponseSchema
>;
export type ReviewListResponse = z.infer<typeof reviewListResponseSchema>;
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;
export type TaskReturnRequest = z.infer<typeof taskReturnRequestSchema>;
export type TaskReturnResponse = z.infer<typeof taskReturnResponseSchema>;
