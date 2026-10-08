import { z } from "zod";

export const accountBalanceSchema = z.object({
  lifetimeXp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  availablePoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reservedPoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  version: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
});
export const ledgerCursorSchema = z
  .string()
  .max(100)
  .transform((value, ctx) => {
    const [at, id, extra] = value.split("|");
    const timestamp = z.iso.datetime().safeParse(at);
    const uuid = z.uuid().safeParse(id);
    if (!timestamp.success || !uuid.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid ledger cursor" });
      return z.NEVER;
    }
    return { at: timestamp.data, id: uuid.data };
  });
export const ledgerListQuerySchema = z.strictObject({
  cursor: ledgerCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const acceptanceAwardSchema = z.object({
  mode: z.literal("synthetic"),
  xp: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  ruleVersion: z.number().int().positive(),
  seasonKey: z.string().regex(/^\d{4}-\d{2}$/),
  timeZone: z.string().min(1).max(80),
  acceptedAt: z.iso.datetime(),
  balance: accountBalanceSchema,
});
export const accountLedgerResponseSchema = z.object({
  balance: accountBalanceSchema,
  entries: z.array(
    z
      .object({
        id: z.uuid(),
        currency: z.enum(["xp", "points"]),
        amount: z.number().int(),
        kind: z
          .enum([
            "task_acceptance",
            "acceptance_reversal",
            "reward_reservation",
            "reward_cancellation",
            "reward_approval",
            "reward_rejection",
            "reward_expiration",
          ])
          .default("task_acceptance"),
        correction: z
          .object({
            id: z.uuid(),
            originalEntryId: z.uuid(),
            actor: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
          })
          .nullable()
          .default(null),
        reason: z.string().min(1).max(2000),
        task: z
          .object({ id: z.uuid(), title: z.string().min(1).max(120) })
          .nullable(),
        reward: z
          .object({
            redemptionId: z.uuid(),
            title: z.string().min(1).max(120),
            version: z.number().int().positive(),
          })
          .nullable()
          .default(null),
        reservedDelta: z.number().int().default(0),
        ruleVersion: z.number().int().positive().nullable(),
        seasonKey: z.string().regex(/^\d{4}-\d{2}$/),
        timeZone: z.string().min(1).max(80),
        mode: z.literal("synthetic"),
        createdAt: z.iso.datetime(),
      })
      .refine(
        (entry) =>
          entry.kind === "task_acceptance"
            ? entry.amount >= 0 &&
              entry.correction === null &&
              entry.task !== null &&
              entry.reward === null &&
              entry.reservedDelta === 0 &&
              entry.ruleVersion !== null
            : entry.kind === "acceptance_reversal"
              ? entry.amount <= 0 &&
                entry.correction !== null &&
                entry.task !== null &&
                entry.reward === null &&
                entry.reservedDelta === 0 &&
                entry.ruleVersion !== null
              : entry.task === null &&
                entry.reward !== null &&
                entry.correction === null &&
                entry.ruleVersion === null &&
                entry.currency === "points" &&
                (entry.kind === "reward_approval"
                  ? entry.amount === 0 && entry.reservedDelta < 0
                  : entry.reservedDelta === -entry.amount &&
                    (entry.kind === "reward_reservation"
                      ? entry.amount < 0
                      : entry.amount > 0)),
        { message: "Invalid ledger entry direction or source" },
      ),
  ),
  nextCursor: z.string().nullable(),
  asOf: z.iso.datetime(),
});
export type AccountLedgerResponse = z.infer<typeof accountLedgerResponseSchema>;
