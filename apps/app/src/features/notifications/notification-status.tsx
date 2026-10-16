"use client";

import {
  apiErrorSchema,
  notificationStatusResponseSchema,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import "./notification-status.css";
import {
  StatusError,
  statusNames,
  errorNames,
  eventNames,
  notificationDate as date,
} from "./notification-format";
import { NotificationEvents } from "./notification-events";
import { NotificationAttempts } from "./notification-attempts";
import { clearNotificationCaches } from "./notification-cache";

async function load(scope: string, signal: AbortSignal) {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  const response = await fetch(`/api/v1/admin/notifications?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    // Access status remains authoritative even if a proxy returns a non-JSON body.
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new StatusError(
      response.status,
      parsed.success ? parsed.data.code : "UNAVAILABLE",
    );
  }
  return notificationStatusResponseSchema.parse(await response.json());
}
export function NotificationStatus() {
  const { loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const [scope, setScope] = useState("");
  const [historyDenial, setHistoryDenial] = useState<StatusError | null>(null);
  const query = useQuery({
    queryKey: ["notification-status", scope],
    queryFn: async ({ signal }) => {
      try {
        return await load(scope, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (
          error instanceof StatusError &&
          [401, 403, 404].includes(error.status)
        ) {
          await clearNotificationCaches(client, ["notification-status", scope]);
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
  const error = historyDenial ?? query.error;
  const accessError =
    error instanceof StatusError && [401, 403].includes(error.status);
  const hidden = error instanceof StatusError && error.status === 404;
  useEffect(() => {
    if (accessError && error instanceof StatusError) loseAccess(error.status);
  }, [accessError, error, loseAccess]);
  const data = !accessError && !hidden ? query.data : null;
  const empty =
    data && Object.values(data.counts).every((value) => value === 0);
  const queued = data
    ? data.counts.unclaimed +
      data.counts.ready +
      data.counts.processing +
      data.counts.retry
    : 0;
  const problems = data ? data.counts.failed + data.counts.suppressed : 0;
  const errors = data
    ? Object.entries(data.errors).filter(([, value]) => value > 0)
    : [];
  const message = accessError
    ? "Доступ изменился. Повторите вход через Telegram."
    : hidden
      ? error.code === "NOTIFICATION_STATUS_DISABLED"
        ? "Просмотр уведомлений выключен."
        : "Состояние уведомлений недоступно."
      : "Не удалось загрузить состояние уведомлений. Проверьте соединение и нажмите «Обновить».";
  return (
    <section
      className="tasks-section notification-section"
      aria-labelledby="notification-status-title"
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <h2 id="notification-status-title">Состояние уведомлений</h2>
        <button
          type="button"
          className="tasks-action"
          aria-label="Обновить состояние уведомлений"
          disabled={query.isFetching}
          onClick={() => {
            setHistoryDenial(null);
            void query.refetch();
          }}
        >
          Обновить
        </button>
      </div>
      <p className="notification-intro">
        Что бот отправил участникам в Telegram и что не удалось доставить.
      </p>
      {query.isPending ? (
        <p className="tasks-state" role="status">
          Загружаем состояние уведомлений…
        </p>
      ) : null}
      {error ? (
        <p className="tasks-state" role="alert">
          {message}
        </p>
      ) : null}
      {data ? (
        <>
          {data.scopes.length > 1 ? (
            <label className="tasks-filter notification-scope">
              <span id="notification-scope-label">Область</span>
              <select
                aria-labelledby="notification-scope-label"
                value={scope || data.scope.id}
                onChange={(event) => setScope(event.target.value)}
              >
                {data.scopes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="notification-asof">Обновлено {date(data.updatedAt)}.</p>
          {empty ? (
            <p className="tasks-state">
              Уведомлений пока не было. Они появляются после действий с задачами
              и заявками.
            </p>
          ) : (
            <>
              {/* Сначала ответ «всё ли дошло» и три числа; разбивка по
                  восьми статусам — по запросу. */}
              <div className="notification-summary">
                <p
                  className={`notification-verdict notification-verdict--${
                    problems ? "bad" : queued ? "wait" : "good"
                  }`}
                >
                  {problems
                    ? `Не доставлено: ${problems.toLocaleString("ru-RU")}.${
                        errors.length ? " Причины — в блоке ниже." : ""
                      }`
                    : queued
                      ? `Ошибок нет, в очереди ${queued.toLocaleString("ru-RU")}.`
                      : "Всё доставлено, ошибок нет."}
                </p>
                <dl className="notification-tiles">
                  <div className="notification-tile--good">
                    <dt>доставлено</dt>
                    <dd>{data.counts.delivered.toLocaleString("ru-RU")}</dd>
                  </div>
                  <div>
                    <dt>в очереди</dt>
                    <dd>{queued.toLocaleString("ru-RU")}</dd>
                  </div>
                  <div
                    className={problems ? "notification-tile--bad" : undefined}
                  >
                    <dt>не доставлено</dt>
                    <dd>{problems.toLocaleString("ru-RU")}</dd>
                  </div>
                </dl>
              </div>
              <details className="notification-breakdown">
                <summary>Подробно по статусам</summary>
                <dl className="notification-counts">
                  {Object.entries(data.counts).map(([key, value]) => (
                    <div key={key}>
                      <dt>{statusNames[key as keyof typeof statusNames]}</dt>
                      <dd>{value.toLocaleString("ru-RU")}</dd>
                    </div>
                  ))}
                </dl>
                <p className="notification-note">
                  «Доставлено в Telegram» — сообщение принято Telegram. Если
                  получатель ни разу не открывал бота, Telegram сообщение не
                  примет.
                </p>
              </details>
            </>
          )}
          {errors.length ? (
            <details className="notification-errors">
              <summary>Причины последних неуспешных попыток</summary>
              <p className="notification-note">
                Для каждого события учтена одна сохранённая причина. Это не
                журнал всех попыток.
              </p>
              <dl className="notification-counts">
                {errors.map(([key, value]) => (
                  <div key={key}>
                    <dt>{errorNames[key as keyof typeof errorNames]}</dt>
                    <dd>{value.toLocaleString("ru-RU")}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
          <NotificationEvents
            key={data.scope.id}
            scope={data.scope.id}
            onDenied={setHistoryDenial}
          />
          <NotificationAttempts
            key={`attempts:${data.scope.id}`}
            scope={data.scope.id}
            onDenied={setHistoryDenial}
          />
          {data.recentEvents.length ? (
            <details className="notification-errors">
              <summary>Последние события ({data.recentEvents.length})</summary>
              <p className="notification-note">
                До 20 последних событий по времени создания, сначала новые. Это
                текущие сохранённые состояния, а не журнал всех попыток. Время
                создания не означает время обработки или доставки.
              </p>
              <ol className="notification-events">
                {data.recentEvents.map((event, index) => (
                  <li key={`${event.createdAt}:${index}`}>
                    <strong>{eventNames[event.kind]}</strong>
                    <p>{statusNames[event.status]}</p>
                    {event.errorCode ? (
                      <p>{errorNames[event.errorCode]}</p>
                    ) : null}
                    <p className="notification-note">
                      Создано{" "}
                      <time dateTime={event.createdAt}>
                        {date(event.createdAt)}
                      </time>
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
