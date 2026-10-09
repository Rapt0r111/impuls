import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scope = z.object({ id: z.uuid(), name: z.string().min(1) }).strict();
export const notificationEventSchema = z
  .object({
    kind: z.enum([
      "task.assigned",
      "task.due_soon",
      "task.returned",
      "task.accepted",
      "ledger.corrected",
      "reward.reserved",
      "reward.cancelled",
      "reward.approved",
      "reward.rejected",
      "reward.fulfilled",
      "reward.expired",
      "unsupported",
    ]),
    createdAt: z.iso.datetime(),
    status: z.enum([
      "unclaimed",
      "ready",
      "processing",
      "retry",
      "simulated",
      "delivered",
      "failed",
      "suppressed",
    ]),
    errorCode: z
      .enum([
        "transport_unavailable",
        "timeout",
        "attempts_exhausted",
        "recipient_inactive",
        "unsupported_kind",
        "rate_limited",
        "recipient_unreachable",
      ])
      .nullable(),
  })
  .strict();
export const notificationStatusQuerySchema = z
  .object({ scope: z.uuid().optional() })
  .strict();
export const notificationStatusResponseSchema = z
  .object({
    mode: z.literal("simulation"),
    scope,
    scopes: z.array(scope).min(1),
    updatedAt: z.iso.datetime(),
    recentEvents: z.array(notificationEventSchema).max(20),
    counts: z
      .object({
        unclaimed: count,
        ready: count,
        processing: count,
        retry: count,
        simulated: count,
        delivered: count,
        failed: count,
        suppressed: count,
      })
      .strict(),
    errors: z
      .object({
        transport_unavailable: count,
        timeout: count,
        attempts_exhausted: count,
        recipient_inactive: count,
        unsupported_kind: count,
        rate_limited: count,
        recipient_unreachable: count,
      })
      .strict(),
  })
  .strict();
export type NotificationStatusResponse = z.infer<
  typeof notificationStatusResponseSchema
>;

const eventCursorParts = z.strictObject({
  actor: z.uuid(),
  scope: z.uuid(),
  purpose: z.literal("notification-events"),
  eventId: z.uuid(),
});
export const notificationEventsCursorSchema = z
  .string()
  .max(160)
  .transform((value, ctx) => {
    const [actor, scope, purpose, eventId, extra] = value.split("|");
    const result = eventCursorParts.safeParse({
      actor,
      scope,
      purpose,
      eventId,
    });
    if (!result.success || extra !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid notification event cursor",
      });
      return z.NEVER;
    }
    return result.data;
  });
export const notificationEventsQuerySchema = z.strictObject({
  scope: z.uuid(),
  cursor: notificationEventsCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const notificationEventsResponseSchema = z.strictObject({
  mode: z.literal("simulation"),
  scope,
  updatedAt: z.iso.datetime(),
  items: z.array(notificationEventSchema).max(50),
  nextCursor: z
    .string()
    .max(160)
    .refine((v) => notificationEventsCursorSchema.safeParse(v).success)
    .nullable(),
});
export type NotificationEventsResponse = z.infer<
  typeof notificationEventsResponseSchema
>;
