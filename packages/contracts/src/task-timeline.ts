import { z } from "zod";
import { taskHistoryQuerySchema } from "./task-history";
export const taskTimelineQuerySchema = taskHistoryQuerySchema;
const person = z.object({ id: z.uuid(), displayName: z.string().min(1) });
const version = z.number().int().min(1).max(2147483647);
export const taskTimelineResponseSchema = z.object({
  taskId: z.uuid(),
  asOf: z.iso.datetime(),
  nextCursor: version.nullable(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        taskVersion: version,
        kind: z.enum([
          "snapshot",
          "created",
          "assigned",
          "started",
          "submitted",
          "returned",
          "accepted",
          "edited",
          "cancelled",
        ]),
        status: z.enum([
          "draft",
          "assigned",
          "in_progress",
          "in_review",
          "needs_work",
          "accepted",
          "cancelled",
        ]),
        occurredAt: z.iso.datetime(),
        actor: person.nullable(),
        assignee: person.nullable(),
        ruleVersion: version,
        fundXp: z.number().int().nonnegative(),
        fundPoints: z.number().int().nonnegative(),
        submissionId: z.uuid().nullable(),
        reviewId: z.uuid().nullable(),
        reason: z.string().min(1).max(2000).nullable().default(null),
        taskSnapshot: z
          .object({
            title: z.string().min(1).max(120),
            criteria: z.string().min(1).max(2000),
            categoryCode: z.string().min(1).max(40),
            priority: z.enum(["critical", "high", "normal"]),
            dueAt: z.iso.datetime(),
          })
          .nullable()
          .default(null),
      }),
    )
    .max(50),
});
export type TaskTimelineResponse = z.infer<typeof taskTimelineResponseSchema>;
