import { z } from "zod";
import { taskPointsSchema } from "./points";

const taskPrioritySchema = z.enum(["critical", "high", "normal"]);
const taskManagementStatusSchema = z.enum([
  "draft",
  "assigned",
  "in_progress",
  "in_review",
  "needs_work",
  "accepted",
  "cancelled",
]);
const taskScopeSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["rota", "group", "project"]),
  name: z.string().min(1).max(80),
});
const taskAssigneeSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1).max(80),
});
const fundSchema = z.number().int().min(0).max(2_147_483_647);

export const managementTaskSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(120),
  criteria: z.string().trim().min(1).max(2000),
  categoryCode: z.string().trim().min(1).max(40),
  priority: taskPrioritySchema,
  status: taskManagementStatusSchema,
  dueAt: z.iso.datetime(),
  fundXp: fundSchema,
  fundPoints: fundSchema,
  ruleSetId: z.uuid(),
  ruleVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  scope: taskScopeSchema,
  assignee: taskAssigneeSchema.nullable(),
  // Свободная задача: любой участник области может взять её сам, пока она черновик.
  openForClaim: z.boolean().default(false),
});

export const taskCreateRequestSchema = z.strictObject({
  scopeId: z.uuid(),
  ruleSetId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  criteria: z.string().trim().min(1).max(2000),
  categoryCode: z.string().trim().min(1).max(40),
  priority: taskPrioritySchema,
  dueAt: z.iso.datetime(),
  fundXp: fundSchema,
  fundPoints: taskPointsSchema,
  openForClaim: z.boolean().default(false),
});

export const taskAssignRequestSchema = z.strictObject({
  assigneeId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});

export const taskEditRequestSchema = taskCreateRequestSchema
  .omit({ scopeId: true, ruleSetId: true, openForClaim: true })
  .extend({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
  });
export const taskCancelRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

export const taskManagementListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

export const taskManagementListResponseSchema = z.object({
  items: z.array(managementTaskSchema),
  nextCursor: z.uuid().nullable(),
});

export const taskManagementResponseSchema = z.object({
  task: managementTaskSchema,
});

export const taskManagementOptionsResponseSchema = z.object({
  scopes: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["rota", "group", "project"]),
      name: z.string().min(1).max(80),
      canCreate: z.boolean(),
      canAssign: z.boolean(),
      canEdit: z.boolean().default(false),
      canCancel: z.boolean().default(false),
      assignees: z.array(taskAssigneeSchema),
    }),
  ),
  ruleSets: z.array(
    z.object({ id: z.uuid(), version: z.number().int().positive() }),
  ),
});

export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;
export type TaskAssignRequest = z.infer<typeof taskAssignRequestSchema>;
export type TaskEditRequest = z.infer<typeof taskEditRequestSchema>;
export type TaskCancelRequest = z.infer<typeof taskCancelRequestSchema>;
export type ManagementTask = z.infer<typeof managementTaskSchema>;
export type TaskManagementOptionsResponse = z.infer<
  typeof taskManagementOptionsResponseSchema
>;
export type TaskManagementListResponse = z.infer<
  typeof taskManagementListResponseSchema
>;
