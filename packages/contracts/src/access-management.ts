import { z } from "zod";

// admin.access and admin.access.manage are never delegated through the app.
export const grantableActions = [
  "task.view",
  "task.create",
  "task.assign",
  "task.edit",
  "task.cancel",
  "task.review",
  "task.verify",
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

// Admission and removal of participants. The Telegram ID is accepted here and never returned.
export const memberAdmissionRequestSchema = z.strictObject({
  scope: z.uuid(),
  telegramId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\p{Cc}]+$/u),
  validUntil: z.iso.datetime().nullable(),
  reason: z.string().trim().min(1).max(500),
});
export const memberRemovalRequestSchema = z.strictObject({
  scope: z.uuid(),
  membershipId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483647),
  reason: z.string().trim().min(1).max(500),
});
const memberChangeBase = {
  scope: z.uuid(),
  changeId: z.uuid(),
  member: z.strictObject({
    membershipId: z.uuid(),
    userId: z.uuid(),
    displayName: z.string().min(1).max(80),
    version: z.number().int().min(1),
    validUntil: z.iso.datetime().nullable(),
  }),
  updatedAt: z.iso.datetime(),
};
export const memberChangeResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...memberChangeBase,
    kind: z.literal("admit"),
    userCreated: z.boolean(),
    userReactivated: z.boolean(),
  }),
  z.strictObject({
    ...memberChangeBase,
    kind: z.literal("remove"),
    revokedBindings: z.number().int().min(0),
    userDeactivated: z.boolean(),
  }),
]);
export type MemberAdmissionRequest = z.infer<
  typeof memberAdmissionRequestSchema
>;
export type MemberRemovalRequest = z.infer<typeof memberRemovalRequestSchema>;
export type MemberChangeResponse = z.infer<typeof memberChangeResponseSchema>;

export const accessQuerySchema = z.strictObject({ scope: z.uuid() });
export const accessListResponseSchema = z.strictObject({
  scope: z.uuid(),
  canManage: z.boolean(),
  canManageMembers: z.boolean(),
  members: z.array(
    z.strictObject({
      userId: z.uuid(),
      membershipId: z.uuid(),
      membershipVersion: z.number().int().min(1),
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
