"use client";

import { realtimeResponseSchema } from "@impuls/contracts";
import type { QueryClient } from "@tanstack/react-query";

// ADR-0038: сигнал «данные изменились» приходит по Supabase Realtime без самих данных.
// Приложение перечитывает только открытые на экране запросы, права проверяет сервер.
// Пока подписка жива, опрос раз в минуту замедляется (см. task-list.tsx); без подписки
// (выключено, нет сети, ошибка) приложение остаётся на опросе.
export const liveSignals = { connected: false };

const settleMs = 400;

export function startLiveSignals(client: QueryClient): () => void {
  let stopped = false;
  let close = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let joinedBefore = false;
  const refresh = () => {
    clearTimeout(timer);
    // Несколько записей подряд (задача, баланс, заявка) дают одно обновление.
    timer = setTimeout(() => {
      void client.invalidateQueries({ refetchType: "active" });
    }, settleMs);
  };
  void (async () => {
    try {
      const response = await fetch("/api/v1/me/realtime", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok || stopped) return;
      const parsed = realtimeResponseSchema.safeParse(await response.json());
      if (!parsed.success || !parsed.data.enabled || stopped) return;
      const { url, key, topic } = parsed.data;
      // Библиотека подгружается отдельным фрагментом и не задерживает первый показ.
      const { RealtimeClient } = await import("@supabase/realtime-js");
      if (stopped) return;
      const socket = new RealtimeClient(
        `${url.replace(/^https/, "wss")}/realtime/v1`,
        { params: { apikey: key } },
      );
      const channel = socket.channel(topic, {
        config: { broadcast: { self: false }, private: false },
      });
      channel
        .on("broadcast", { event: "change" }, refresh)
        .subscribe((status) => {
          liveSignals.connected = status === "SUBSCRIBED";
          // После переподключения сигналы могли потеряться: обновляем сразу.
          if (liveSignals.connected) {
            if (joinedBefore) refresh();
            joinedBefore = true;
          }
        });
      close = () => {
        void channel.unsubscribe();
        void socket.disconnect();
      };
      if (stopped) close();
    } catch {
      // Realtime необязателен: опрос продолжает работать.
      liveSignals.connected = false;
    }
  })();
  return () => {
    stopped = true;
    clearTimeout(timer);
    liveSignals.connected = false;
    close();
  };
}
