import { z } from "zod";

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
  requestedPoints: amount,
  requestedXp: amount.nullable(),
  verifierIds: z.array(z.uuid()).min(1).max(5),
});

export const selfTaskVerifyRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("approve"), expectedVersion }),
  z.strictObject({ decision: z.literal("decline"), expectedVersion, reason }),
]);

export const selfTaskDecideRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("forward"),
    expectedVersion,
    fundPoints: amount,
    fundXp: amount,
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
