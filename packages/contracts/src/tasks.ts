import { z } from "zod";

export const assignedTaskStatusSchema = z.enum([
  "assigned",
  "in_progress",
  "in_review",
  "needs_work",
  "accepted",
  "cancelled",
]);

export const taskIdSchema = z.uuid();

export const taskListQuerySchema = z.strictObject({
  cursor: taskIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: assignedTaskStatusSchema.optional(),
});

export const assignedTaskSummarySchema = z.object({
  id: taskIdSchema,
  title: z.string().min(1).max(120),
  status: assignedTaskStatusSchema,
  priority: z.enum(["critical", "high", "normal"]),
  dueAt: z.iso.datetime(),
  fundXp: z.number().int().nonnegative(),
  fundPoints: z.number().int().nonnegative(),
  ruleVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const taskListResponseSchema = z.object({
  items: z.array(assignedTaskSummarySchema),
  nextCursor: z.uuid().nullable(),
});

export const assignedTaskDetailSchema = assignedTaskSummarySchema.extend({
  criteria: z.string().min(1).max(2000),
  latestReview: z
    .object({
      submissionId: z.uuid(),
      decision: z.enum(["return", "accept"]),
      fundXp: z.number().int().nonnegative().nullable().default(null),
      fundPoints: z.number().int().nonnegative().nullable().default(null),
      reason: z.string().min(1).max(2000),
      createdAt: z.iso.datetime(),
    })
    .nullable()
    .default(null),
  latestSubmission: z
    .object({
      id: z.uuid(),
      text: z.string().min(1).max(4000),
      version: z.number().int().positive(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  scope: z.object({
    id: z.uuid(),
    kind: z.enum(["rota", "group", "project"]),
    name: z.string().min(1).max(80),
  }),
});

export const taskDetailResponseSchema = z.object({
  task: assignedTaskDetailSchema,
});

export const taskSubmissionHeadersSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});

export const taskSubmissionRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  text: z.string().trim().min(1).max(4000),
});

export const taskSubmissionResponseSchema = z.object({
  submission: z.object({
    id: z.uuid(),
    taskId: z.uuid(),
    text: z.string().min(1).max(4000),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
  }),
  task: assignedTaskDetailSchema,
});

export const taskStartRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  action: z.literal("start"),
});

export const taskStartResponseSchema = z.object({
  task: assignedTaskDetailSchema,
});

// Свободная задача: черновик, который участник области может взять сам.
export const openTaskSchema = z.object({
  id: taskIdSchema,
  title: z.string().min(1).max(120),
  criteria: z.string().min(1).max(2000),
  priority: z.enum(["critical", "high", "normal"]),
  dueAt: z.iso.datetime(),
  fundXp: z.number().int().nonnegative(),
  fundPoints: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  scope: z.object({
    id: z.uuid(),
    kind: z.enum(["rota", "group", "project"]),
    name: z.string().min(1).max(80),
  }),
});
export const openTaskListResponseSchema = z.object({
  items: z.array(openTaskSchema).max(50),
});
export const taskClaimRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  action: z.literal("claim"),
});
export const taskClaimResponseSchema = taskStartResponseSchema;

export type OpenTask = z.infer<typeof openTaskSchema>;
export type OpenTaskListResponse = z.infer<typeof openTaskListResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type TaskDetailResponse = z.infer<typeof taskDetailResponseSchema>;
export type TaskSubmissionHeaders = z.infer<typeof taskSubmissionHeadersSchema>;
export type TaskSubmissionRequest = z.infer<typeof taskSubmissionRequestSchema>;
export type TaskSubmissionResponse = z.infer<
  typeof taskSubmissionResponseSchema
>;
export type TaskStartRequest = z.infer<typeof taskStartRequestSchema>;
export type TaskStartResponse = z.infer<typeof taskStartResponseSchema>;
