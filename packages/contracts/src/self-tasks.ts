import { z } from "zod";
import { taskPointsSchema, taskXpSchema } from "./points";

// Responses keep the wider range from before ADR-0041/0042, so older reports still show.
const amount = z.number().int().min(0).max(100000);
const reason = z.string().trim().min(1).max(2000);
const expectedVersion = z.number().int().min(1).max(2147483647);

export const selfTaskViewSchema = z.enum([
  "mine",
  "verify",
  "commander",
  "options",
]);
export const selfTaskQuerySchema = z.strictObject({
  view: selfTaskViewSchema,
  scopeId: z.uuid().optional(),
});

export const selfTaskProposeRequestSchema = z.strictObject({
  scopeId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
  requestedPoints: taskPointsSchema,
  requestedXp: taskXpSchema.nullable(),
  // One responsible person: they score the report and the commander approves that score.
  verifierIds: z.array(z.uuid()).length(1),
});

export const selfTaskVerifyRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("approve"),
    expectedVersion,
    fundPoints: taskPointsSchema,
    // The verifier proposes XP beside points; the commander sees it and approves or changes it.
    fundXp: taskXpSchema,
  }),
  z.strictObject({ decision: z.literal("decline"), expectedVersion, reason }),
  // Sends the report back to the member for rework; only the chosen verifier can do it (ADR-0045).
  z.strictObject({ decision: z.literal("return"), expectedVersion, reason }),
]);

// The member edits a returned report and sends it to the same verifier again.
export const selfTaskResubmitRequestSchema = z.strictObject({
  expectedVersion,
  text: z.string().trim().min(1).max(2000),
});

export const selfTaskDecideRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("forward"),
    expectedVersion,
    fundXp: taskXpSchema,
  }),
  z.strictObject({ decision: z.literal("decline"), expectedVersion, reason }),
]);

const person = z.strictObject({ id: z.uuid(), displayName: z.string() });

export const selfTaskSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  text: z.string(),
  status: z.enum([
    "awaiting_verification",
    "awaiting_commander",
    "in_review",
    "needs_work",
    "accepted",
    "cancelled",
  ]),
  version: z.number().int().min(1),
  requestedPoints: amount,
  requestedXp: amount.nullable(),
  fundPoints: amount,
  fundXp: amount,
  verifiedPoints: amount.nullable(),
  verifiedXp: amount.nullable(),
  // Why the verifier returned the report; set only while it waits for rework.
  returnReason: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  scope: z.strictObject({ id: z.uuid(), name: z.string() }),
  author: person,
  verifiers: z.array(person),
});

export const selfTaskResponseSchema = z.strictObject({ task: selfTaskSchema });
export const selfTaskListResponseSchema = z.strictObject({
  items: z.array(selfTaskSchema),
});
export const selfTaskOptionsResponseSchema = z.strictObject({
  scopes: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  scopeId: z.uuid().nullable(),
  verifiers: z.array(person),
});

export type SelfTask = z.infer<typeof selfTaskSchema>;
