"use client";

import {
  apiErrorSchema,
  notificationAttemptsResponseSchema,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { clearNotificationCaches } from "./notification-cache";
import {
  StatusError,
  errorNames,
  eventNames,
  notificationDate,
} from "./notification-format";

async function load(scope: string, cursor: string, signal: AbortSignal) {
  const params = new URLSearchParams({ scope, limit: "10" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(
    `/api/v1/admin/notifications/attempts?${params}`,
    {
      signal,
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new StatusError(
      response.status,
      error.success ? error.data.code : "UNAVAILABLE",
    );
  }
  const data = notificationAttemptsResponseSchema.parse(await response.json());
  if (data.scope.id !== scope) throw new Error("Unexpected attempt scope");
  return data;
}

const phaseNames = {
  started: "Событие взято в обработку",
  retry: "Назначен повтор",
  simulated: "Симуляция успешна",
  delivered: "Доставлено в Telegram",
  failed: "Попытки завершены с ошибкой",
  suppressed: "Обработка запрещена",
  lease_expired: "Обнаружен истёкший захват",
} as const;

export function NotificationAttempts({
  scope,
  onDenied,
}: {
  scope: string;
  onDenied(error: StatusError): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState("");
  const disclosure = useRef<HTMLDetailsElement>(null);
  const { loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  useTelegramBack(
    expanded,
    () => {
      if (disclosure.current) disclosure.current.open = false;
      setExpanded(false);
    },
    20,
  );
  const query = useQuery({
    queryKey: ["notification-attempts", scope, cursor],
    enabled: expanded,
    queryFn: async ({ signal }) => {
      try {
        return await load(scope, cursor, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (
          error instanceof StatusError &&
          [401, 403, 404].includes(error.status)
        ) {
          await clearNotificationCaches(client, [
            "notification-attempts",
            scope,
            cursor,
          ]);
          onDenied(error);
        }
        throw error;
      }
    },
    retry: false,
    networkMode: "always",
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const error = query.error;
  const denied =
    error instanceof StatusError && [400, 401, 403, 404].includes(error.status);
  const data = denied ? null : query.data;
  useEffect(() => {
    if (error instanceof StatusError && [401, 403].includes(error.status))
      loseAccess(error.status);
  }, [error, loseAccess]);
  const refresh = () => {
    if (cursor) setCursor("");
    else void query.refetch();
  };
  return (
    <details
      ref={disclosure}
      className="notification-errors notification-attempt-history"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Журнал попыток</summary>
      {expanded ? (
        <div aria-busy={query.isFetching}>
          <p className="notification-note">
            Здесь сохраняются новые переходы попыток после включения журнала.
            Более ранняя история неизвестна. Время записи — момент сохранения
            перехода; истечение захвата отмечается при его обнаружении.
            Симуляция не подтверждает доставку в Telegram.
          </p>
          <button
            type="button"
            className="tasks-action"
            disabled={query.isFetching}
            onClick={refresh}
          >
            Обновить журнал
          </button>
          {query.isPending ? (
            <p role="status">Загружаем журнал попыток…</p>
          ) : null}
          {query.isError ? (
            <p role="alert">
              {error instanceof StatusError && error.status === 400
                ? "Страница журнала изменилась. Обновите журнал с первой страницы."
                : error instanceof StatusError && error.status === 404
                  ? "Журнал в этой области недоступен."
                  : "Не удалось загрузить журнал. Нажмите «Обновить журнал»."}
            </p>
          ) : null}
          {data ? (
            <>
              <p className="notification-asof">
                Прочитано{" "}
                <time dateTime={data.updatedAt}>
                  {notificationDate(data.updatedAt)}
                </time>{" "}
                МСК.{" "}
                {query.isError
                  ? "Показаны ранее прочитанные записи."
                  : "Записи не изменяются; новые видны после обновления."}
              </p>
              {data.items.length ? (
                <ol className="notification-events">
                  {data.items.map((event) => (
                    <li key={event.id}>
                      <strong>{eventNames[event.kind]}</strong>
                      <p>
                        Попытка {event.attempt} · {phaseNames[event.phase]}
                      </p>
                      {event.errorCode ? (
                        <p>{errorNames[event.errorCode]}</p>
                      ) : null}
                      <p className="notification-note">
                        Записано{" "}
                        <time dateTime={event.recordedAt}>
                          {notificationDate(event.recordedAt)}
                        </time>{" "}
                        МСК
                      </p>
                      <details className="notification-identity">
                        <summary>Идентификатор события</summary>
                        <code>{event.eventId}</code>
                        <p className="notification-note">
                          Одинаковый идентификатор связывает переходы одного
                          события.
                        </p>
                      </details>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  Новых записей попыток пока нет. Они появляются при обработке
                  событий симуляции; прежние попытки не восстанавливаются.
                </p>
              )}
              {data.nextCursor ? (
                <button
                  type="button"
                  className="tasks-action"
                  disabled={query.isFetching || query.isError}
                  onClick={() => setCursor(data.nextCursor!)}
                >
                  Следующие записи
                </button>
              ) : null}
              {cursor ? (
                <p className="notification-note">
                  «Обновить журнал» возвращает первую страницу с новыми
                  записями.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
