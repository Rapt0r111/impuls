import { z } from "zod";

export const leaderboardSeasonSchema = z
  .string()
  .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const leaderboardCursorSchema = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const [scope, season, revision, id, extra] = value.split("|");
    const parsed = z
      .object({
        scope: z.uuid(),
        season: leaderboardSeasonSchema,
        revision: revisionSchema,
        id: z.uuid(),
      })
      .safeParse({ scope, season, revision, id });
    if (!parsed.success || extra !== undefined) {
      ctx.addIssue({ code: "custom", message: "Invalid leaderboard cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });
export const leaderboardQuerySchema = z.strictObject({
  scope: z.uuid().optional(),
  season: leaderboardSeasonSchema.optional(),
  cursor: leaderboardCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const xpSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const leaderboardResponseSchema = z.object({
  mode: z.literal("synthetic"),
  timeZone: z.literal("Europe/Moscow"),
  season: leaderboardSeasonSchema,
  scopes: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
  scope: z.object({ id: z.uuid(), name: z.string().min(1) }).nullable(),
  self: z
    .object({ xp: xpSchema, rank: z.number().int().positive().nullable() })
    .nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string().min(1),
      xp: xpSchema.min(1),
      rank: z.number().int().positive(),
      isSelf: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
  revision: revisionSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
