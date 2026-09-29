import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.uuid(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  currentVersion: z.number().int().optional(),
});

export const telegramLoginRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string().min(1),
  }),
  csrfToken: z.string().min(1),
});

export const permissionsResponseSchema = z.object({
  permissions: z.array(
    z.object({
      action: z.enum([
        "task.create",
        "task.assign",
        "task.review",
        "reward.decide",
        "reward.fulfill",
        "admin.access",
        "admin.rules",
        "admin.catalog",
        "ledger.correct",
      ]),
      scope: z.object({
        id: z.uuid(),
        kind: z.enum(["rota", "group", "project"]),
        name: z.string().min(1),
      }),
      validUntil: z.iso.datetime().nullable(),
    }),
  ),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type TelegramLoginRequest = z.infer<typeof telegramLoginRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type PermissionsResponse = z.infer<typeof permissionsResponseSchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  scopeId: z.uuid(),
  assignedTo: z.uuid().nullable(),
  currentSubmissionId: z.uuid().nullable(),
  title: z.string(),
  criteria: z.string(),
  category: z.string(),
  priority: z.enum(["critical", "high", "normal"]),
  dueAt: z.iso.datetime().nullable(),
  baseXp: z.number().int().nonnegative(),
  basePoints: z.number().int().nonnegative(),
  ruleSetVersion: z.number().int().positive(),
  status: z.enum([
    "draft",
    "assigned",
    "in_progress",
    "in_review",
    "needs_work",
    "accepted",
    "cancelled",
  ]),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  nextCursor: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

export const taskDetailSchema = z.object({
  task: taskSchema,
  submission: z
    .object({ id: z.uuid(), report: z.string(), createdAt: z.iso.datetime() })
    .nullable(),
  returnReason: z.string().nullable(),
});

export const createTaskRequestSchema = z.object({
  scopeId: z.uuid(),
  ruleSetId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  criteria: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(80),
  priority: z.enum(["critical", "high", "normal"]),
  dueAt: z.iso.datetime().nullable(),
  baseXp: z.number().int().nonnegative(),
  basePoints: z.number().int().nonnegative(),
});

export const assignTaskRequestSchema = z.object({
  assigneeId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});

export const startTaskRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const submitTaskRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  report: z.string().trim().min(1).max(4000),
});

export const returnSubmissionRequestSchema = z.object({
  decision: z.literal("return"),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
});

export type Task = z.infer<typeof taskSchema>;
export type TaskList = z.infer<typeof taskListSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type AssignTaskRequest = z.infer<typeof assignTaskRequestSchema>;
export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof submitTaskRequestSchema>;
export type ReturnSubmissionRequest = z.infer<
  typeof returnSubmissionRequestSchema
>;
