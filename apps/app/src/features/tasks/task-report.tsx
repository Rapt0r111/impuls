"use client";

import {
  taskStartResponseSchema,
  taskSubmissionResponseSchema,
  type TaskDetailResponse,
} from "@impuls/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";

type Attempt = { action: "start" | "submit"; key: string; body: string };

export function TaskReport({ task }: { task: TaskDetailResponse["task"] }) {
  const { csrfToken, reportDirty, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const running = useRef(false);

  useEffect(() => {
    reportDirty(text.length > 0 || pending || uncertain);
    return () => reportDirty(false);
  }, [text, pending, uncertain, reportDirty]);

  async function mutate(action: Attempt["action"]) {
    if (running.current) return;
    if (action === "submit" && !text.trim()) {
      setError("Опишите выполненную работу и результат.");
      return;
    }
    running.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    const intent = attempt.current ?? {
      action,
      key: crypto.randomUUID(),
      body: JSON.stringify(
        action === "start"
          ? { action, expectedVersion: task.version }
          : { text: text.trim(), expectedVersion: task.version },
      ),
    };
    attempt.current = intent;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `/api/v1/tasks/${task.id}${intent.action === "submit" ? "/submissions" : ""}`,
        {
          method: intent.action === "submit" ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": intent.key,
          },
          body: intent.body,
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        loseAccess(response.status);
        return;
      }
      if (!response.ok) {
        if (response.status === 429) {
          setUncertain(true);
          setError(mutationLimitMessage(response));
          return;
        }
        if (response.status === 409) {
          attempt.current = null;
          setUncertain(false);
          setError(
            "Задача изменилась. Обновляем состояние; текст отчёта сохранён. Проверьте критерии перед повторной отправкой.",
          );
          await client.invalidateQueries({
            queryKey: ["assigned-task", task.id],
          });
          await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
        } else if (response.status === 404) {
          attempt.current = null;
          setUncertain(false);
          setError(
            "Задача больше недоступна. Закройте форму и обновите список.",
          );
          await client.invalidateQueries({
            queryKey: ["assigned-task", task.id],
          });
        } else if (response.status === 400 || response.status === 422) {
          attempt.current = null;
          setUncertain(false);
          setError("Проверьте отчёт: от 1 до 4000 символов. Текст сохранён.");
        } else {
          throw new Error("Mutation result is unknown");
        }
        return;
      }
      const raw: unknown = await response.json();
      const result =
        intent.action === "start"
          ? taskStartResponseSchema.parse(raw)
          : taskSubmissionResponseSchema.parse(raw);
      attempt.current = null;
      setUncertain(false);
      if (intent.action === "submit") setText("");
      setSuccess(
        intent.action === "submit"
          ? "Отчёт отправлен на проверку. XP и баллы ещё не начислены."
          : "Задача в работе. Теперь можно отправить отчёт.",
      );
      await client.cancelQueries({ queryKey: ["assigned-task", task.id] });
      client.setQueryData(["assigned-task", task.id], { task: result.task });
      await client.invalidateQueries({ queryKey: ["task-history", task.id] });
      await client.invalidateQueries({ queryKey: ["task-timeline", task.id] });
      await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
    } catch {
      setUncertain(attempt.current !== null);
      setError(
        navigator.onLine
          ? "Не удалось подтвердить результат. Текст сохранён; повторите тот же запрос."
          : "Нет соединения. Текст сохранён; восстановите сеть и повторите тот же запрос.",
      );
    } finally {
      window.clearTimeout(timeout);
      running.current = false;
      setPending(false);
    }
  }

  const canStart = task.status === "assigned" || task.status === "needs_work";
  return (
    <div className="task-report">
      {task.latestReview && (
        <section
          aria-label={
            task.latestReview.decision === "accept"
              ? "Результат приёмки"
              : "Причина возврата"
          }
        >
          <h4>
            {task.latestReview.decision === "accept"
              ? "Результат принят"
              : "Возвращено на доработку"}
          </h4>
          {task.latestReview.decision === "accept" && (
            <p className="task-report-success">
              Начислено {task.latestReview.fundXp} XP и{" "}
              {task.latestReview.fundPoints} баллов
            </p>
          )}
          <p className="tasks-detail-criteria">{task.latestReview.reason}</p>
        </section>
      )}
      {task.latestSubmission && (
        <section aria-labelledby="last-report-title">
          <h4 id="last-report-title">Последний отправленный отчёт</h4>
          <p className="tasks-detail-criteria">{task.latestSubmission.text}</p>
        </section>
      )}
      {success && (
        <p role="status" className="task-report-success">
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className="task-report-error">
          {error}
        </p>
      )}
      {uncertain ? (
        <>
          {text && <p className="tasks-detail-criteria">{text}</p>}
          <button
            type="button"
            className="tasks-action task-report-primary"
            disabled={pending}
            onClick={() => void mutate(attempt.current!.action)}
          >
            {pending ? "Проверяем…" : "Повторить тот же запрос"}
          </button>
        </>
      ) : canStart ? (
        <button
          type="button"
          className="tasks-action task-report-primary"
          disabled={pending}
          onClick={() => void mutate("start")}
        >
          {pending
            ? "Сохраняем…"
            : task.status === "needs_work"
              ? "Продолжить работу"
              : "Начать работу"}
        </button>
      ) : task.status === "in_progress" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("submit");
          }}
        >
          <label htmlFor="task-report-text">Отчёт о выполнении</label>
          <p id="task-report-help">
            Что сделано и как результат отвечает критериям. Сдача не начисляет
            XP или баллы.
          </p>
          <textarea
            id="task-report-text"
            aria-describedby="task-report-help task-report-length"
            maxLength={4000}
            rows={6}
            value={text}
            disabled={pending}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          <p id="task-report-length" className="task-report-length">
            {text.length} / 4000 символов
          </p>
          <button
            type="submit"
            className="tasks-action task-report-primary"
            disabled={pending || !text.trim()}
          >
            {pending ? "Отправляем…" : "Отправить на проверку"}
          </button>
        </form>
      ) : task.status === "in_review" ? (
        <p>Отчёт на проверке. Начисление появится после приёмки.</p>
      ) : null}
      {text && task.status !== "in_progress" && !uncertain && (
        <section aria-label="Несданный текст">
          <h4>Ваш несданный текст</h4>
          <p className="tasks-detail-criteria">{text}</p>
        </section>
      )}
    </div>
  );
}
