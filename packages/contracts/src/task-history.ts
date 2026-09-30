import { z } from "zod";

const attemptNumber = z.number().int().min(1).max(2147483647);
const queryInteger = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .pipe(z.coerce.number<string>().int());
export const taskHistoryQuerySchema = z.strictObject({
  cursor: queryInteger.pipe(attemptNumber).optional(),
  limit: queryInteger.pipe(z.number().min(1).max(50)).default(20),
});

const reviewFields = {
  id: z.uuid(),
  reason: z.string().min(1).max(2000),
  createdAt: z.iso.datetime(),
  reviewer: z.object({ id: z.uuid(), displayName: z.string().min(1) }),
};
export const taskHistoryResponseSchema = z.object({
  taskId: z.uuid(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        attemptNumber,
        text: z.string().min(1).max(4000),
        submittedAt: z.iso.datetime(),
        review: z
          .discriminatedUnion("decision", [
            z.object({
              ...reviewFields,
              decision: z.literal("return"),
              fundXp: z.null(),
              fundPoints: z.null(),
            }),
            z.object({
              ...reviewFields,
              decision: z.literal("accept"),
              fundXp: z.number().int().nonnegative(),
              fundPoints: z.number().int().nonnegative(),
            }),
          ])
          .nullable(),
      }),
    )
    .max(50),
  nextCursor: attemptNumber.nullable(),
  asOf: z.iso.datetime(),
});
export type TaskHistoryResponse = z.infer<typeof taskHistoryResponseSchema>;
