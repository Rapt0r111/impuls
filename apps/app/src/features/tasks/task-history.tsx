"use client";

import { taskHistoryResponseSchema } from "@impuls/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";

class HistoryError extends Error {
  constructor(readonly status: number) {
    super("Task history request failed");
  }
}
async function load(
  taskId: string,
  cursor: number | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "10" });
  if (cursor !== null) params.set("cursor", String(cursor));
  const response = await fetch(`/api/v1/tasks/${taskId}/history?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new HistoryError(response.status);
  const result = taskHistoryResponseSchema.parse(await response.json());
  if (result.taskId !== taskId) throw new Error("Unexpected history task");
  return result;
}
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function TaskHistory({ taskId }: { taskId: string }) {
  const { loseAccess } = useAuthorizedSession();
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const query = useInfiniteQuery({
    queryKey: ["task-history", taskId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => load(taskId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    enabled: expanded,
    networkMode: "always",
    retry: false,
  });
  const denied =
    query.error instanceof HistoryError &&
    [401, 403, 404].includes(query.error.status);
  useEffect(() => {
    if (
      query.error instanceof HistoryError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const items = denied
    ? []
    : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const first = denied ? undefined : query.data?.pages[0];
  const hasError = query.isError || query.isFetchNextPageError;
  const errorMessage = !hasError
    ? ""
    : query.error instanceof HistoryError && query.error.status === 404
      ? "Задача больше недоступна. Закройте деталь и обновите список."
      : denied
        ? "Доступ к истории изменился. Проверьте вход снова."
        : !navigator.onLine
          ? "Нет соединения. Восстановите сеть и повторите загрузку истории."
          : "Не удалось загрузить историю. Повторите попытку.";

  return (
    <section className="task-history" aria-label="История отчётов и решений">
      <button
        type="button"
        className="tasks-action task-history-toggle"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Скрыть историю отчётов" : "История отчётов и решений"}
      </button>
      <div id={regionId} hidden={!expanded}>
        {expanded && (
          <>
            <p>
              От новых попыток к старым. Для каждой сохранены отчёт и результат
              проверки.
            </p>
            {query.isPending ? (
              <p role="status">Загружаем историю…</p>
            ) : (
              <>
                {hasError && (
                  <p role="alert">
                    {errorMessage}
                    {first &&
                      ` Показана последняя подтверждённая история: ${date(first.asOf)}.`}
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
                        Отчётов пока нет. Первая запись появится после отправки
                        результата на проверку.
                      </p>
                    ) : (
                      <ol className="task-history-list">
                        {items.map((item) => (
                          <li key={item.id}>
                            <h4>
                              Попытка {item.attemptNumber} ·{" "}
                              {item.review?.decision === "accept"
                                ? "Принята"
                                : item.review
                                  ? "Возвращена на доработку"
                                  : "На проверке"}
                            </h4>
                            <p className="task-history-date">
                              Отправлена{" "}
                              <time dateTime={item.submittedAt}>
                                {date(item.submittedAt)}
                              </time>
                            </p>
                            <p className="tasks-detail-criteria task-history-text">
                              {item.text}
                            </p>
                            {item.review && (
                              <div className="task-history-decision">
                                <p>
                                  {item.review.decision === "accept"
                                    ? "Основание приёмки"
                                    : "Причина возврата"}
                                  : {item.review.reason}
                                </p>
                                <p>
                                  Проверяющий:{" "}
                                  {item.review.reviewer.displayName} ·{" "}
                                  <time dateTime={item.review.createdAt}>
                                    {date(item.review.createdAt)}
                                  </time>
                                </p>
                                {item.review.decision === "accept" && (
                                  <p className="task-history-funds">
                                    Начислено {item.review.fundXp} XP и{" "}
                                    {item.review.fundPoints} баллов ·
                                    синтетический режим
                                  </p>
                                )}
                              </div>
                            )}
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
                        ? "Обновляем…"
                        : hasError
                          ? "Повторить загрузку истории"
                          : "Обновить историю"}
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
                          : "Показать более ранние отчёты"}
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
