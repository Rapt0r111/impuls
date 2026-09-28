import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.uuid(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  currentVersion: z.number().int().optional(),
});

export const telegramLoginRequestSchema = z.object({
  initData: z.string().min(1).max(8192),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string().min(1),
  }),
  csrfToken: z.string().min(1),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type TelegramLoginRequest = z.infer<typeof telegramLoginRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
