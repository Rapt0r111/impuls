import { z } from "zod";

const zone = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Неизвестный часовой пояс");
const bonus = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  title: z.string().trim().min(1).max(80),
  percent: z.number().int().min(1).max(100),
});
// Level thresholds are the XP at which each level starts: the first is 0 and every next
// one is strictly higher (the same rule the profile applies when it reads them).
const thresholds = z
  .array(z.number().int().min(0).max(1_000_000_000))
  .min(1)
  .max(100)
  .refine(
    (list) =>
      list[0] === 0 && list.every((v, i) => i === 0 || v > list[i - 1]!),
    "Порог первого уровня — 0, каждый следующий выше предыдущего",
  );
const fields = {
  timeZone: zone,
  acceptanceEnabled: z.boolean(),
  // Lowest share of the task fund the reviewer may award; null — no adjustment.
  minPercent: z.number().int().min(0).max(100).nullable(),
  bonuses: z
    .array(bonus)
    .max(7)
    .refine(
      (list) => new Set(list.map((b) => b.code)).size === list.length,
      "Коды бонусов не должны повторяться",
    ),
  // null — levels are not configured, the profile shows that honestly.
  levelThresholds: thresholds.nullable(),
  // Names of the configured levels from the first one; an empty string means no name.
  levelNames: z.array(z.string().trim().max(40)).max(100).default([]),
  // How many self-taken free tasks one participant may keep unfinished; null — no limit.
  openTaskLimit: z.number().int().min(1).max(50).nullable().default(null),
};
// A name is kept only for a level that exists: names never outnumber the thresholds.
const namesFitLevels = (value: {
  levelThresholds: number[] | null;
  levelNames: string[];
}) => value.levelNames.length <= (value.levelThresholds?.length ?? 0);
export const rulesPublishRequestSchema = z
  .strictObject({
    ...fields,
    reason: z.string().trim().min(1).max(2000),
  })
  .refine(namesFitLevels, "Названий больше, чем уровней");
export const currentRulesSchema = z
  .strictObject({
    versionNumber: z.number().int().positive(),
    effectiveFrom: z.iso.datetime(),
    ...fields,
    // The latest version uses absolute amounts from an earlier slice: publishing replaces them.
    legacyOptions: z.boolean(),
  })
  .refine(namesFitLevels, "Названий больше, чем уровней");
export const rulesResponseSchema = z.strictObject({
  current: currentRulesSchema.nullable(),
  history: z.array(
    z.strictObject({
      versionNumber: z.number().int().positive(),
      effectiveFrom: z.iso.datetime(),
      publishedBy: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});
export const rulesPublishResponseSchema = z.strictObject({
  versionNumber: z.number().int().positive(),
  publicationId: z.uuid(),
  publishedAt: z.iso.datetime(),
});
export type RulesPublishRequest = z.infer<typeof rulesPublishRequestSchema>;
export type RulesResponse = z.infer<typeof rulesResponseSchema>;
export type RulesPublishResponse = z.infer<typeof rulesPublishResponseSchema>;
