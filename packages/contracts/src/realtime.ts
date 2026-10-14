import { z } from "zod";

// ADR-0038: параметры подписки на сигналы «данные изменились». Ключ публикуемый
// (его видно в браузере), тема открыта только самому участнику.
export const realtimeResponseSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    url: z.url({ protocol: /^https$/ }),
    key: z.string().min(1).max(512),
    topic: z.string().regex(/^impuls-[0-9a-f]{64}$/),
  }),
]);
export type RealtimeResponse = z.infer<typeof realtimeResponseSchema>;
