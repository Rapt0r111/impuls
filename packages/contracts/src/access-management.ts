import { z } from "zod";

// admin.access and admin.access.manage are never delegated through the app.
export const grantableActions = [
  "task.view",
  "task.create",
  "task.assign",
  "task.edit",
  "task.cancel",
  "task.review",
  "reward.decide",
  "reward.fulfill",
  "admin.rules",
  "admin.catalog",
  "admin.catalog.create",
  "admin.catalog.publish",
  "admin.catalog.schedule",
  "admin.catalog.schedule.cancel",
  "admin.catalog.quota.publish",
  "admin.audit",
  "admin.notifications",
  "ledger.correct",
] as const;

export const accessGrantRequestSchema = z.strictObject({
  scope: z.uuid(),
  subjectId: z.uuid(),
  action: z.enum(grantableActions),
  validUntil: z.iso.datetime().nullable(),
  reason: z.string().trim().min(1).max(500),
});
export const accessRevocationRequestSchema = z.strictObject({
  scope: z.uuid(),
  bindingId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483647),
  reason: z.string().trim().min(1).max(500),
});
export const accessChangeResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  kind: z.enum(["grant", "revoke"]),
  scope: z.uuid(),
  changeId: z.uuid(),
  binding: z.strictObject({
    id: z.uuid(),
    subjectId: z.uuid(),
    action: z.enum(grantableActions),
    validUntil: z.iso.datetime().nullable(),
    version: z.number().int().min(1),
  }),
  updatedAt: z.iso.datetime(),
});
export type AccessGrantRequest = z.infer<typeof accessGrantRequestSchema>;
export type AccessRevocationRequest = z.infer<
  typeof accessRevocationRequestSchema
>;

export const accessQuerySchema = z.strictObject({ scope: z.uuid() });
export const accessListResponseSchema = z.strictObject({
  mode: z.literal("synthetic"),
  scope: z.uuid(),
  canManage: z.boolean(),
  members: z.array(
    z.strictObject({
      userId: z.uuid(),
      displayName: z.string().min(1).max(80),
      isSelf: z.boolean(),
      bindings: z.array(
        z.strictObject({
          id: z.uuid(),
          action: z.enum(grantableActions),
          validUntil: z.iso.datetime().nullable(),
          version: z.number().int().min(1),
        }),
      ),
    }),
  ),
});
export type AccessListResponse = z.infer<typeof accessListResponseSchema>;
