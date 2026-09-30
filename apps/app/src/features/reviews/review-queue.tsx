"use client";

import {
  apiErrorSchema,
  reviewListResponseSchema,
  taskReturnResponseSchema,
  taskAcceptanceResponseSchema,
  type ReviewQueueItem,
} from "@impuls/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";

class ReviewError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super("Review request failed");
  }
}
async function loadQueue(cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/reviews?${params}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(await response.json());
    throw new ReviewError(
      response.status,
      error.success ? error.data.code : undefined,
    );
  }
  return reviewListResponseSchema.parse(await response.json());
}

function ReturnForm({
  item,
  onClose,
}: {
  item: ReviewQueueItem;
  onClose(): void;
}) {
  const { csrfToken, reportDirty, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"return" | "accept">("return");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const intent = useRef<{
    key: string;
    body: string;
    action: "return" | "accept";
  } | null>(null);
  const running = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  useEffect(() => {
    reportDirty(Boolean(reason) || confirmed || pending || uncertain);
    return () => reportDirty(false);
  }, [reason, confirmed, pending, uncertain, reportDirty]);

  async function send() {
    if (
      running.current ||
      blocked ||
      (!intent.current &&
        (!reason.trim() || (action === "accept" && !confirmed)))
    )
      return;
    running.current = true;
    setPending(true);
    setError(null);
    const attempt = intent.current ?? {
      key: crypto.randomUUID(),
      action,
      body: JSON.stringify({
        action,
        expectedVersion: item.task.version,
        reason: reason.trim(),
      }),
    };
    intent.current = attempt;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `/api/v1/submissions/${item.submissionId}/review`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": attempt.key,
          },
          body: attempt.body,
        },
      );
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json());
        const code = parsed.success ? parsed.data.code : undefined;
        if (response.status === 401 || code === "ACCESS_REVOKED") {
          loseAccess(response.status);
          return;
        }
        if (
          [400, 403, 404, 409, 422].includes(response.status) ||
          code === "ECONOMY_DISABLED"
        ) {
          intent.current = null;
          setUncertain(false);
          if (response.status !== 400) setBlocked(true);
          setError(
            response.status === 409
              ? "Решение уже изменилось. Причина сохранена. Закройте форму и обновите очередь перед новым решением."
              : code === "ECONOMY_DISABLED" || code === "ECONOMY_RULES_INVALID"
                ? "Синтетические начисления недоступны. Основание сохранено. Закройте форму и обновите очередь."
                : code === "RECIPIENT_REVOKED"
                  ? "Доступ исполнителя отозван. Решение не сохранено."
                  : response.status === 400
                    ? "Укажите причину от 1 до 2000 символов."
                    : "Отчёт или право проверки больше недоступны. Закройте форму и обновите очередь.",
          );
          // Keep this form and its draft mounted until the reviewer closes it.
          return;
        }
        throw new Error("Return result is unknown");
      }
      const result = (
        attempt.action === "accept"
          ? taskAcceptanceResponseSchema
          : taskReturnResponseSchema
      ).parse(await response.json());
      intent.current = null;
      setUncertain(false);
      setReason("");
      setConfirmed(false);
      setBlocked(true);
      setSuccess(
        "award" in result
          ? `Результат принят. Начислено ${result.award.xp} XP и ${result.award.points} баллов · синтетический режим. Основание: ${result.review.reason}`
          : `Возврат сохранён. Исполнитель увидит причину: ${result.review.reason}`,
      );
      await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
      await client.invalidateQueries({ queryKey: ["account-ledger"] });
      await client.invalidateQueries({
        queryKey: ["assigned-task", item.task.id],
      });
    } catch {
      setUncertain(true);
      setError(
        navigator.onLine
          ? "Результат не подтверждён. Причина сохранена; повторите тот же запрос."
          : "Нет соединения. Причина сохранена; восстановите сеть и повторите тот же запрос.",
      );
    } finally {
      window.clearTimeout(timeout);
      running.current = false;
      setPending(false);
    }
  }
  return (
    <section className="tasks-detail" aria-labelledby="review-detail-title">
      <div className="tasks-detail-top">
        <h3
          id="review-detail-title"
          className="review-detail-heading"
          ref={heading}
          tabIndex={-1}
        >
          {item.task.title}
        </h3>
        <button className="tasks-close" onClick={onClose} type="button">
          Закрыть
        </button>
      </div>
      <dl>
        <div>
          <dt>Исполнитель</dt>
          <dd>{item.author.displayName}</dd>
        </div>
        <div>
          <dt>Область</dt>
          <dd>{item.task.scope.name}</dd>
        </div>
        <div>
          <dt>Версия правил</dt>
          <dd>{item.task.ruleVersion}</dd>
        </div>
      </dl>
      <div className="task-report">
        <h4>Критерии</h4>
        <p className="tasks-detail-criteria">{item.task.criteria}</p>
        <h4>Отчёт · попытка {item.attemptNumber}</h4>
        <p className="tasks-detail-criteria">{item.text}</p>
      </div>
      <form
        className="task-report"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {item.acceptance.enabled && (
          <fieldset
            className="review-decision"
            disabled={pending || uncertain || blocked}
          >
            <legend>Решение по отчёту</legend>
            <label>
              <input
                type="radio"
                name="review-action"
                checked={action === "return"}
                onChange={() => {
                  setAction("return");
                  setConfirmed(false);
                }}
              />{" "}
              Вернуть на доработку
            </label>
            <label>
              <input
                type="radio"
                name="review-action"
                checked={action === "accept"}
                onChange={() => {
                  setAction("accept");
                  setConfirmed(false);
                }}
              />{" "}
              Принять результат
            </label>
          </fieldset>
        )}
        {action === "accept" && (
          <section
            className="review-preview"
            aria-label="Предварительное начисление"
          >
            <h4>Проверка перед приёмкой</h4>
            <p>
              {item.author.displayName} получит{" "}
              <strong>{item.task.fundXp} XP</strong> и{" "}
              <strong>{item.task.fundPoints} баллов</strong>.
            </p>
            <p>
              Версия задачи {item.task.version} · правила{" "}
              {item.task.ruleVersion} · синтетический режим
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={pending || uncertain || blocked}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{" "}
              Подтверждаю результат и указанный фонд
            </label>
          </section>
        )}
        <label htmlFor="review-reason">
          {action === "accept" ? "Основание приёмки" : "Причина возврата"}
        </label>
        <p id="review-help">
          {action === "accept"
            ? "Укажите, чем подтверждено выполнение критериев. Фонд задаётся серверной версией задачи."
            : "Что нужно исправить, чтобы выполнить критерии. Возврат не начисляет XP или баллы."}
        </p>
        <textarea
          id="review-reason"
          maxLength={2000}
          rows={5}
          value={reason}
          disabled={pending || uncertain || blocked}
          aria-describedby="review-help review-length"
          onChange={(event) => setReason(event.target.value)}
        />
        <p id="review-length" className="task-report-length">
          {reason.length} / 2000 символов
        </p>
        {error && (
          <p className="task-report-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="task-report-success" role="status">
            {success}
          </p>
        )}
        {!blocked && (
          <button
            className="tasks-action task-report-primary"
            disabled={
              pending ||
              (!uncertain &&
                (!reason.trim() || (action === "accept" && !confirmed)))
            }
            type="submit"
          >
            {pending
              ? "Сохраняем…"
              : uncertain
                ? "Повторить тот же запрос"
                : action === "accept"
                  ? "Подтвердить приёмку и начисление"
                  : "Вернуть на доработку"}
          </button>
        )}
      </form>
    </section>
  );
}

function QueueContent() {
  const { confirmLeave, loseAccess } = useAuthorizedSession();
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const queue = useInfiniteQuery({
    queryKey: ["review-queue"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadQueue(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  useEffect(() => {
    if (
      queue.error instanceof ReviewError &&
      (queue.error.status === 401 || queue.error.code === "ACCESS_REVOKED")
    )
      loseAccess(queue.error.status);
  }, [queue.error, loseAccess]);
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const denied =
    queue.error instanceof ReviewError && queue.error.status === 403;
  return (
    <section className="tasks-section" aria-labelledby="reviews-title">
      <div className="tasks-heading">
        <div>
          <h2 id="reviews-title">Очередь проверки</h2>
          <p>Отчёты в вашей области. Собственные результаты исключены.</p>
        </div>
        <button
          className="tasks-action"
          type="button"
          onClick={() => {
            if (confirmLeave()) {
              setSelected(null);
              void queue.refetch();
            }
          }}
        >
          Обновить очередь
        </button>
      </div>
      {queue.isPending ? (
        <p role="status">Загружаем отчёты…</p>
      ) : queue.isError ? (
        <div className="tasks-state" role="alert">
          <p>
            {denied
              ? "Право проверки изменилось. Проверьте вход снова."
              : !navigator.onLine
                ? "Нет соединения. Восстановите сеть и обновите очередь."
                : "Очередь недоступна. Повторите загрузку."}
          </p>
        </div>
      ) : items.length === 0 ? (
        <p className="tasks-state">Нет отчётов, ожидающих проверки.</p>
      ) : (
        <ul className="tasks-list">
          {items.map((item) => (
            <li key={item.submissionId}>
              <button
                type="button"
                className="tasks-row"
                aria-expanded={selected?.submissionId === item.submissionId}
                onClick={() => {
                  if (confirmLeave()) setSelected(item);
                }}
              >
                <span className="tasks-row-main">
                  <strong>{item.task.title}</strong>
                  <span>
                    {item.author.displayName} · {item.task.scope.name}
                  </span>
                </span>
                <span className="tasks-row-fund">
                  <strong>Проверить</strong>
                  <span>Попытка {item.attemptNumber}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {queue.hasNextPage && !queue.isError && (
        <button
          type="button"
          className="tasks-action tasks-more"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          Показать ещё
        </button>
      )}
      {selected && (
        <ReturnForm
          key={selected.submissionId}
          item={selected}
          onClose={() => {
            if (confirmLeave()) {
              setSelected(null);
              void queue.refetch();
            }
          }}
        />
      )}
    </section>
  );
}
export function ReviewQueue() {
  const { canReview } = useAuthorizedSession();
  return canReview ? <QueueContent /> : null;
}
