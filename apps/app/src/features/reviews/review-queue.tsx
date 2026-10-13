"use client";

import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";

import {
  apiErrorSchema,
  reviewListResponseSchema,
  taskReturnResponseSchema,
  taskAcceptanceResponseSchema,
  type ReviewQueueItem,
} from "@impuls/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  useAuthorizedSession,
  useManyScopes,
} from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { TaskTimeline } from "@/features/tasks/task-timeline";
import { TaskHistory } from "@/features/tasks/task-history";

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
  const manyScopes = useManyScopes();
  const { csrfToken, reportDirty, loseAccess, historyScopeIds } =
    useAuthorizedSession();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"return" | "accept">("return");
  const [confirmed, setConfirmed] = useState(false);
  const { adjustment, bonuses } = item.acceptance.options;
  const [baseXp, setBaseXp] = useState(String(item.task.fundXp));
  const [basePoints, setBasePoints] = useState(String(item.task.fundPoints));
  const [bonusCode, setBonusCode] = useState("");
  const bonus = bonuses.find((b) => b.code === bonusCode) ?? null;
  const parsedBaseXp = /^\d{1,7}$/.test(baseXp) ? Number(baseXp) : null;
  const parsedBasePoints = /^\d{1,7}$/.test(basePoints)
    ? Number(basePoints)
    : null;
  const adjusted =
    parsedBaseXp !== item.task.fundXp ||
    parsedBasePoints !== item.task.fundPoints;
  const awardProblem =
    action !== "accept"
      ? null
      : parsedBaseXp === null || parsedBasePoints === null
        ? "Укажите целые неотрицательные значения."
        : adjusted &&
            (!adjustment ||
              parsedBaseXp > adjustment.maxXp ||
              parsedBasePoints > adjustment.maxPoints ||
              parsedBaseXp < adjustment.minXp ||
              parsedBasePoints < adjustment.minPoints)
          ? adjustment
            ? `XP от ${adjustment.minXp} до ${adjustment.maxXp}, баллы от ${adjustment.minPoints} до ${adjustment.maxPoints} по настройкам начислений.`
            : "Настройки начислений не разрешают корректировку."
          : null;
  const totalXp = (parsedBaseXp ?? 0) + (bonus?.xp ?? 0);
  const totalPoints = (parsedBasePoints ?? 0) + (bonus?.points ?? 0);
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
    reportDirty(
      Boolean(reason) ||
        confirmed ||
        pending ||
        uncertain ||
        adjusted ||
        bonusCode !== "",
    );
    return () => reportDirty(false);
  }, [reason, confirmed, pending, uncertain, adjusted, bonusCode, reportDirty]);

  async function send() {
    if (
      running.current ||
      blocked ||
      (!intent.current &&
        (!reason.trim() ||
          (action === "accept" && (!confirmed || awardProblem !== null))))
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
        ...(action === "accept" && adjusted
          ? { baseXp: parsedBaseXp, basePoints: parsedBasePoints }
          : {}),
        ...(action === "accept" && bonus ? { bonusCode: bonus.code } : {}),
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
        if (response.status === 429) {
          setUncertain(true);
          setError(mutationLimitMessage(response));
          return;
        }
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
          if (response.status !== 400 && code !== "AWARD_INVALID")
            setBlocked(true);
          setError(
            response.status === 409
              ? "Решение уже изменилось. Причина сохранена. Закройте форму и обновите очередь перед новым решением."
              : code === "ECONOMY_DISABLED" || code === "ECONOMY_RULES_INVALID"
                ? "Синтетические начисления недоступны. Основание сохранено. Закройте форму и обновите очередь."
                : code === "RECIPIENT_REVOKED"
                  ? "Доступ исполнителя отозван. Решение не сохранено."
                  : code === "AWARD_INVALID"
                    ? "Корректировка или бонус не разрешены настройками начислений. Измените выбор и подтвердите снова."
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
          ? `Результат принят. Начислено ${result.award.xp} XP и ${result.award.points} баллов${
              result.award.breakdown?.bonus
                ? ` (бонус «${result.award.breakdown.bonus.title}»: ${result.award.breakdown.bonus.xp} XP и ${result.award.breakdown.bonus.points} баллов)`
                : ""
            }. Основание: ${result.review.reason}`
          : `Возврат сохранён. Исполнитель увидит причину: ${result.review.reason}`,
      );
      await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
      await client.invalidateQueries({ queryKey: ["account-ledger"] });
      await client.invalidateQueries({
        queryKey: ["task-history", item.task.id],
      });
      await client.invalidateQueries({
        queryKey: ["task-timeline", item.task.id],
      });
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
        {manyScopes ? (
          <div>
            <dt>Область</dt>
            <dd>{item.task.scope.name}</dd>
          </div>
        ) : null}
      </dl>
      <div className="task-report">
        <h4>Критерии</h4>
        <p className="tasks-detail-criteria">{item.task.criteria}</p>
        <h4>Отчёт · попытка {item.attemptNumber}</h4>
        <p className="tasks-detail-criteria">{item.text}</p>
      </div>
      {historyScopeIds?.includes(item.task.scope.id) && (
        <>
          <TaskTimeline taskId={item.task.id} />
          <TaskHistory taskId={item.task.id} />
        </>
      )}
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
            {(adjustment || bonuses.length > 0) && (
              <fieldset
                className="review-award"
                disabled={pending || uncertain || blocked}
              >
                <legend>Начисление</legend>
                {adjustment && (
                  <>
                    <label htmlFor="review-base-xp">
                      Базовый XP (фонд {item.task.fundXp}, от {adjustment.minXp}{" "}
                      до {adjustment.maxXp})
                    </label>
                    <input
                      id="review-base-xp"
                      inputMode="numeric"
                      value={baseXp}
                      onChange={(event) => {
                        setBaseXp(event.target.value.trim());
                        setConfirmed(false);
                      }}
                    />
                    <label htmlFor="review-base-points">
                      Базовые баллы (фонд {item.task.fundPoints}, от{" "}
                      {adjustment.minPoints} до {adjustment.maxPoints})
                    </label>
                    <input
                      id="review-base-points"
                      inputMode="numeric"
                      value={basePoints}
                      onChange={(event) => {
                        setBasePoints(event.target.value.trim());
                        setConfirmed(false);
                      }}
                    />
                  </>
                )}
                {bonuses.length > 0 && (
                  <>
                    <label htmlFor="review-bonus">
                      Бонус (не более одного)
                    </label>
                    <select
                      id="review-bonus"
                      value={bonusCode}
                      onChange={(event) => {
                        setBonusCode(event.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="">Без бонуса</option>
                      {bonuses.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.title} (+{b.xp} XP / +{b.points} баллов)
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </fieldset>
            )}
            {awardProblem && (
              <p className="task-report-error" role="alert">
                {awardProblem}
              </p>
            )}
            <p>
              {item.author.displayName} получит{" "}
              <strong>{awardProblem ? "—" : `${totalXp} XP`}</strong> и{" "}
              <strong>{awardProblem ? "—" : `${totalPoints} баллов`}</strong>.
              {bonus && !awardProblem
                ? ` Из них бонус «${bonus.title}»: ${bonus.xp} XP и ${bonus.points} баллов.`
                : ""}
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={pending || uncertain || blocked}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{" "}
              {bonus || adjusted
                ? "Подтверждаю результат и указанное начисление"
                : "Подтверждаю результат и указанный фонд"}
            </label>
          </section>
        )}
        <label htmlFor="review-reason">
          {action === "accept" ? "Основание приёмки" : "Причина возврата"}
        </label>
        <p id="review-help">
          {action === "accept"
            ? bonus || adjusted
              ? "Объясните корректировку или бонус и чем подтверждено выполнение критериев."
              : "Укажите, чем подтверждено выполнение критериев. Фонд задаётся серверной версией задачи."
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
                (!reason.trim() ||
                  (action === "accept" &&
                    (!confirmed || awardProblem !== null))))
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
  const manyScopes = useManyScopes();
  const { confirmLeave, loseAccess } = useAuthorizedSession();
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const queue = useInfiniteQuery({
    queryKey: ["review-queue"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadQueue(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const closeSelected = () => {
    if (confirmLeave()) {
      setSelected(null);
      void queue.refetch();
    }
  };
  useTelegramBack(selected !== null, closeSelected, 30);
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
          <p>Отчёты участников. Собственные результаты исключены.</p>
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
                    {item.author.displayName}
                    {manyScopes ? ` · ${item.task.scope.name}` : ""}
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
          onClose={closeSelected}
        />
      )}
    </section>
  );
}
export function ReviewQueue() {
  const { canReview } = useAuthorizedSession();
  return canReview ? <QueueContent /> : null;
}
