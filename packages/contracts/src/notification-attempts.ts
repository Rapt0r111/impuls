import { z } from "zod";
import { notificationEventSchema } from "./notification-status";

const cursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("notification-attempts"),
  journalId: z.uuid(),
});
export const notificationAttemptsCursorSchema = z
  .string()
  .max(160)
  .transform((value, ctx) => {
    const [actor, scope, purpose, journalId, extra] = value.split("|");
    const parsed = cursorParts.safeParse({ actor, scope, purpose, journalId });
    if (!parsed.success || extra !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid notification attempt cursor",
      });
      return z.NEVER;
    }
    return parsed.data;
  });
export const notificationAttemptsQuerySchema = z.strictObject({
  scope: z.uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: notificationAttemptsCursorSchema.optional(),
});
export const notificationAttemptSchema = z
  .strictObject({
    id: z.uuid(),
    eventId: z.uuid(),
    kind: notificationEventSchema.shape.kind,
    attempt: z.number().int().min(1).max(5),
    phase: z.enum([
      "started",
      "retry",
      "simulated",
      "failed",
      "suppressed",
      "lease_expired",
    ]),
    recordedAt: z.iso.datetime(),
    errorCode: notificationEventSchema.shape.errorCode,
  })
  .superRefine((row, ctx) => {
    const valid = ["started", "simulated", "lease_expired"].includes(row.phase)
      ? row.errorCode === null
      : row.phase === "suppressed"
        ? ["recipient_inactive", "unsupported_kind"].includes(
            row.errorCode ?? "",
          )
        : [
            "transport_unavailable",
            "timeout",
            ...(row.phase === "failed" ? ["attempts_exhausted"] : []),
          ].includes(row.errorCode ?? "");
    if (!valid)
      ctx.addIssue({ code: "custom", message: "Invalid attempt phase reason" });
  });
export const notificationAttemptsResponseSchema = z.strictObject({
  mode: z.literal("simulation"),
  scope: z.strictObject({ id: z.uuid(), name: z.string().min(1) }),
  updatedAt: z.iso.datetime(),
  items: z.array(notificationAttemptSchema).max(50),
  nextCursor: z
    .string()
    .max(160)
    .refine((v) => notificationAttemptsCursorSchema.safeParse(v).success)
    .nullable(),
});
export type NotificationAttemptsResponse = z.infer<
  typeof notificationAttemptsResponseSchema
>;
