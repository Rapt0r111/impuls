import { z } from "zod";
import { accountBalanceSchema, ledgerCursorSchema } from "./ledger";

export const ledgerCorrectionRequestSchema = z.strictObject({
  reviewId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
export const ledgerCorrectionQuerySchema = z.strictObject({
  reviewId: z.uuid().optional(),
  cursor: ledgerCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const correctionSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  reason: z.string().min(1).max(2000),
  xpDelta: z.number().int().nonpositive(),
  pointsDelta: z.number().int().nonpositive(),
  createdAt: z.iso.datetime(),
});
export const ledgerCorrectionResponseSchema = z.object({
  correction: correctionSchema,
  balance: accountBalanceSchema,
});
export const ledgerCorrectionItemSchema = z.object({
  reviewId: z.uuid(),
  task: z.object({ id: z.uuid(), title: z.string().min(1).max(120) }),
  recipient: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
  scope: z.object({ id: z.uuid(), name: z.string().min(1) }),
  xp: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  seasonKey: z.string().regex(/^\d{4}-\d{2}$/),
  ruleVersion: z.number().int().positive(),
  acceptedAt: z.iso.datetime(),
  balance: accountBalanceSchema,
  enabled: z.boolean(),
  correction: correctionSchema.nullable(),
});
export const ledgerCorrectionsResponseSchema = z.object({
  items: z.array(ledgerCorrectionItemSchema),
  nextCursor: z.string().nullable(),
  asOf: z.iso.datetime(),
});
export type LedgerCorrectionItem = z.infer<typeof ledgerCorrectionItemSchema>;
export type LedgerCorrectionRequest = z.infer<
  typeof ledgerCorrectionRequestSchema
>;
