"use client";

import { taskTimelineResponseSchema } from "@impuls/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";

class TimelineError extends Error {
  constructor(readonly status: number) {
    super("Task timeline request failed");
  }
}
async function load(
  taskId: string,
  cursor: number | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "10" });
  if (cursor !== null) params.set("cursor", String(cursor));
  const response = await fetch(`/api/v1/tasks/${taskId}/timeline?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new TimelineError(response.status);
  const result = taskTimelineResponseSchema.parse(await response.json());
  if (result.taskId !== taskId) throw new Error("Unexpected timeline task");
  return result;
}
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const labels = {
  snapshot: "Снимок на момент включения истории",
  created: "Создан черновик",
  assigned: "Назначен исполнитель",
  started: "Начата работа",
  submitted: "Отправлен отчёт",
  returned: "Возвращено на доработку",
  accepted: "Результат принят",
  edited: "Изменён черновик",
  cancelled: "Задача отменена",
  proposed: "Отчёт о самостоятельной задаче",
  verified: "Проверяющий передал командиру",
  approved: "Командир назначил баллы и передал на приёмку",
  declined: "Отчёт отклонён",
} as const;
const statuses = {
  draft: "Черновик",
  assigned: "Назначена",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_work: "На доработке",
  accepted: "Принята",
  cancelled: "Отменена",
  awaiting_verification: "Ждёт проверяющего",
  awaiting_commander: "Ждёт командира",
} as const;

export function TaskTimeline({ taskId }: { taskId: string }) {
  const { loseAccess } = useAuthorizedSession();
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const query = useInfiniteQuery({
    queryKey: ["task-timeline", taskId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => load(taskId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    enabled: expanded,
    networkMode: "always",
    retry: false,
  });
  const denied =
    query.error instanceof TimelineError &&
    [401, 403, 404].includes(query.error.status);
  useEffect(() => {
    if (
      query.error instanceof TimelineError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const first = denied ? undefined : query.data?.pages[0];
  const items = denied
    ? []
    : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const hasError = query.isError || query.isFetchNextPageError;
  return (
    <section className="task-timeline" aria-label="История задачи">
      <button
        type="button"
        className="tasks-action task-history-toggle"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Скрыть историю задачи" : "История задачи"}
      </button>
      <div id={regionId} hidden={!expanded}>
        {expanded && (
          <>
            <p>
              Сохранённые переходы от новых к старым. Отчёты и основания решений
              — в истории отчётов ниже.
            </p>
            {query.isPending ? (
              <p role="status">Загружаем события…</p>
            ) : (
              <>
                {hasError && (
                  <p role="alert">
                    {denied
                      ? "История задачи больше недоступна. Проверьте доступ и обновите список."
                      : !navigator.onLine
                        ? "Нет соединения. Восстановите сеть и повторите загрузку событий."
                        : "Не удалось загрузить события. Повторите попытку."}
                    {first &&
                      ` Показаны подтверждённые события: ${date(first.asOf)}.`}
                  </p>
                )}
                {first && (
                  <>
                    <p className="task-history-asof">
                      Прочитано с сервера:{" "}
                      <time dateTime={first.asOf}>{date(first.asOf)}</time>
                    </p>
                    {items.length === 0 ? (
                      <p>
                        Сохранённых переходов пока нет. Они появятся при
                        следующем изменении задачи.
                      </p>
                    ) : (
                      <ol className="task-history-list">
                        {items.map((item) => (
                          <li key={item.id}>
                            <h4>
                              {item.kind === "assigned" &&
                              item.actor &&
                              item.actor.id === item.assignee?.id
                                ? "Исполнитель взял задачу сам"
                                : labels[item.kind]}{" "}
                              · версия {item.taskVersion}
                            </h4>
                            <p className="task-history-date">
                              <time dateTime={item.occurredAt}>
                                {date(item.occurredAt)}
                              </time>{" "}
                              ·{" "}
                              {item.actor?.displayName ?? "Системная миграция"}
                            </p>
                            {item.kind === "snapshot" && (
                              <p>
                                Ранние переходы не записывались. Это состояние
                                на момент включения истории; прежние отчёты и
                                решения сохранены отдельно.
                              </p>
                            )}
                            <p>
                              {statuses[item.status]} ·{" "}
                              {item.assignee
                                ? `Исполнитель: ${item.assignee.displayName}`
                                : "Исполнитель не назначен"}
                            </p>
                            {item.reason && <p>Основание: {item.reason}</p>}
                            {item.kind === "edited" && item.taskSnapshot && (
                              <p>
                                {item.taskSnapshot.title}
                                <br />
                                {item.taskSnapshot.criteria}
                                <br />
                                Категория: {item.taskSnapshot.categoryCode} ·
                                срок {date(item.taskSnapshot.dueAt)}
                                <br />
                              </p>
                            )}
                            <p className="task-history-funds">
                              {item.kind === "accepted" ? "Начислено" : "Фонд"}:{" "}
                              {item.fundXp} XP и {item.fundPoints} баллов
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
                {!denied && (
                  <div className="task-history-actions">
                    <button
                      type="button"
                      className="tasks-action"
                      disabled={query.isFetching}
                      onClick={() => void query.refetch()}
                    >
                      {query.isFetching && !query.isFetchingNextPage
                        ? "Обновляем события…"
                        : hasError
                          ? "Повторить загрузку событий"
                          : "Обновить события"}
                    </button>
                    {query.hasNextPage && (
                      <button
                        type="button"
                        className="tasks-action"
                        disabled={query.isFetching}
                        onClick={() => void query.fetchNextPage()}
                      >
                        {query.isFetchingNextPage
                          ? "Загружаем…"
                          : "Показать более ранние события"}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
