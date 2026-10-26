import { z } from "zod";
import { accountBalanceSchema } from "./ledger";

const levelSchema = z.object({
  // Levels have no ceiling; the configured names may be missing for a level.
  level: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  title: z.string().min(1).max(40).nullable(),
  minimumXp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nextLevelXp: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
  remainingXp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  progressXp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  spanXp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export const participantProfileResponseSchema = z
  .object({
    user: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
    balance: accountBalanceSchema,
    progression: z.discriminatedUnion("state", [
      z.object({
        state: z.literal("unconfigured"),
        ruleVersion: z.null(),
        level: z.null(),
      }),
      z.object({
        state: z.literal("invalid"),
        ruleVersion: z.number().int().positive(),
        level: z.null(),
      }),
      z.object({
        state: z.literal("configured"),
        ruleVersion: z.number().int().positive(),
        level: levelSchema,
      }),
    ]),
    firstResult: z
      .object({
        code: z.literal("first_result"),
        conditionVersion: z.literal(1),
        sourceEntryId: z.uuid(),
        reviewId: z.uuid(),
        task: z.object({ id: z.uuid(), title: z.string().min(1).max(120) }),
        grantedAt: z.iso.datetime(),
        provenance: z.enum(["acceptance", "migration"]),
        sourceCorrected: z.boolean(),
      })
      .nullable(),
    asOf: z.iso.datetime(),
  })
  .superRefine((data, ctx) => {
    if (data.progression.state !== "configured") return;
    const level = data.progression.level,
      xp = data.balance.lifetimeXp;
    const valid =
      level.minimumXp <= xp &&
      level.progressXp === xp - level.minimumXp &&
      (level.nextLevelXp === null
        ? level.spanXp === null && level.remainingXp === 0
        : level.nextLevelXp > xp &&
          level.spanXp === level.nextLevelXp - level.minimumXp &&
          level.remainingXp === level.nextLevelXp - xp);
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent profile progression",
      });
  });
export type ParticipantProfileResponse = z.infer<
  typeof participantProfileResponseSchema
>;

// Shown to other members, so the alphabet is closed: letters, digits, space and . _ ' ’ -.
// Marks, emoji, control and bidirectional characters are rejected to keep names unambiguous.
export const profileNameSchema = z
  .string()
  .max(200)
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(
    z
      .string()
      .min(2)
      .max(40)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u),
  );
export const profileNameRequestSchema = z
  .object({ displayName: profileNameSchema })
  .strict();
export const profileNameResponseSchema = z.object({
  user: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
  changed: z.boolean(),
});
export type ProfileNameRequest = z.infer<typeof profileNameRequestSchema>;
export type ProfileNameResponse = z.infer<typeof profileNameResponseSchema>;
