"use client";

import {
  apiErrorSchema,
  notificationEventsResponseSchema,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { clearNotificationCaches } from "./notification-cache";
import {
  StatusError,
  statusNames,
  errorNames,
  eventNames,
  notificationDate,
} from "./notification-format";

async function load(scope: string, cursor: string, signal: AbortSignal) {
  const params = new URLSearchParams({ scope, limit: "10" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/admin/notifications/events?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new StatusError(
      response.status,
      error.success ? error.data.code : "UNAVAILABLE",
    );
  }
  const data = notificationEventsResponseSchema.parse(await response.json());
  if (data.scope.id !== scope) throw new Error("Unexpected event scope");
  return data;
}

export function NotificationEvents({
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
    queryKey: ["notification-events", scope, cursor],
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
            "notification-events",
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
      className="notification-errors notification-history"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Все события</summary>
      {expanded ? (
        <div aria-busy={query.isFetching}>
          <p className="notification-note">
            От новых событий к старым. Показаны текущие сохранённые состояния, а
            не журнал каждой попытки. Время создания не означает время обработки
            или доставки.
          </p>
          <button
            type="button"
            className="tasks-action"
            disabled={query.isFetching}
            onClick={refresh}
          >
            Обновить события
          </button>
          {query.isPending ? <p role="status">Загружаем события…</p> : null}
          {query.isError ? (
            <p role="alert">
              {error instanceof StatusError && error.status === 400
                ? "Страница событий изменилась. Обновите события с первой страницы."
                : error instanceof StatusError && error.status === 404
                  ? "События недоступны."
                  : "Не удалось загрузить события. Нажмите «Обновить события»."}
            </p>
          ) : null}
          {data ? (
            <>
              <p className="notification-asof">
                Прочитано{" "}
                <time dateTime={data.updatedAt}>
                  {notificationDate(data.updatedAt)}
                </time>{" "}
                {query.isError
                  ? "Показаны ранее подтверждённые состояния."
                  : "Состояния перечитываются вручную."}
              </p>
              {data.items.length ? (
                <ol className="notification-events">
                  {data.items.map((event, index) => (
                    <li key={`${event.createdAt}:${index}`}>
                      <strong>{eventNames[event.kind]}</strong>
                      <p>{statusNames[event.status]}</p>
                      {event.errorCode ? (
                        <p>{errorNames[event.errorCode]}</p>
                      ) : null}
                      <p className="notification-note">
                        Создано{" "}
                        <time dateTime={event.createdAt}>
                          {notificationDate(event.createdAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>На этой странице событий нет.</p>
              )}
              {data.nextCursor ? (
                <button
                  type="button"
                  className="tasks-action"
                  disabled={query.isFetching || query.isError}
                  onClick={() => setCursor(data.nextCursor!)}
                >
                  Следующие события
                </button>
              ) : null}
              {cursor ? (
                <p className="notification-note">
                  «Обновить события» возвращает первую страницу. Состояния могут
                  измениться между чтениями.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
