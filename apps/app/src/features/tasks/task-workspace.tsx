"use client";

import {
  taskDetailSchema,
  taskListSchema,
  type MeResponse,
  type PermissionsResponse,
  type TaskDetail,
  type TaskList,
} from "@impuls/contracts";
import { useEffect, useRef, useState } from "react";

type Props = {
  me: MeResponse;
  permissions: PermissionsResponse["permissions"] | null;
};

const statusText = {
  draft: "Черновик",
  assigned: "Назначена",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_work: "На доработке",
  accepted: "Принята",
  cancelled: "Отменена",
} as const;
const priorityText = {
  critical: "Критический",
  high: "Высокий",
  normal: "Штатный",
} as const;

export function TaskWorkspace({ me, permissions }: Props) {
  const [list, setList] = useState<TaskList | null>(null);
  const [listState, setListState] = useState<
    "loading" | "ready" | "error" | "session"
  >("loading");
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [report, setReport] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);

  async function loadList(cursor?: string, append = false) {
    setListState("loading");
    try {
      const url = cursor
        ? `/api/v1/tasks?cursor=${encodeURIComponent(cursor)}`
        : "/api/v1/tasks";
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401 || response.status === 403) {
        setListState("session");
        return;
      }
      if (!response.ok) throw new Error("list request failed");
      const parsed = taskListSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid list");
      setList(
        append && list
          ? { ...parsed.data, tasks: [...list.tasks, ...parsed.data.tasks] }
          : parsed.data,
      );
      setListState("ready");
    } catch {
      setListState("error");
    }
  }

  async function loadDetail(id: string) {
    setDetailState("loading");
    try {
      const response = await fetch(`/api/v1/tasks/${id}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("detail request failed");
      const parsed = taskDetailSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid detail");
      setDetail(parsed.data);
      setDetailState("idle");
    } catch {
      setDetailState("error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/tasks", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          setListState("session");
          return;
        }
        if (!response.ok) throw new Error("list request failed");
        const parsed = taskListSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("invalid list");
        setList(parsed.data);
        setListState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setListState("error");
      });
    return () => controller.abort();
  }, []);

  async function mutate(path: string, body: unknown, success: string) {
    const fingerprint = JSON.stringify({ path, body });
    const key =
      retry.current?.fingerprint === fingerprint
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { fingerprint, key };
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        retry.current = null;
        setReport("");
        setReturnReason("");
        setMessage(success);
        await loadList();
        if (detail) await loadDetail(detail.task.id);
      } else if (response.status === 409) {
        retry.current = null;
        setMessage(
          "Задача изменилась. Данные обновлены; проверьте их перед повтором.",
        );
        await loadList();
        if (detail) await loadDetail(detail.task.id);
      } else if (response.status === 401 || response.status === 403) {
        setMessage(
          "Сессия или полномочия изменились. Откройте приложение снова.",
        );
      } else if (response.status === 503) {
        setMessage(
          "Сервис временно недоступен. Текст сохранён; повторите действие.",
        );
      } else {
        retry.current = null;
        setMessage("Действие отклонено. Проверьте данные и обновите задачу.");
      }
    } catch {
      setMessage("Нет соединения. Текст сохранён; повторите действие.");
    } finally {
      setBusy(false);
    }
  }

  const task = detail?.task;
  const isMine = task?.assignedTo === me.user.id;
  const canReview = Boolean(
    task &&
    permissions?.some(
      (item) => item.action === "task.review" && item.scope.id === task.scopeId,
    ),
  );
  return (
    <section className="task-workspace" aria-labelledby="task-workspace-title">
      <div className="task-section-heading">
        <div>
          <span className="task-eyebrow">Рабочий раздел · R1</span>
          <h2 id="task-workspace-title">Задачи</h2>
        </div>
        <button
          type="button"
          className="task-text-button"
          onClick={() => void loadList()}
          disabled={listState === "loading"}
        >
          Обновить
        </button>
      </div>
      {listState === "loading" && !list && (
        <p role="status" className="task-muted">
          Загружаем задачи…
        </p>
      )}
      {listState === "session" && (
        <p role="alert" className="task-error">
          Доступ изменился. Откройте приложение через Telegram снова.
        </p>
      )}
      {listState === "error" && (
        <p role="alert" className="task-error">
          Задачи не загрузились. Повторите запрос.
        </p>
      )}
      {listState === "ready" && list?.tasks.length === 0 && (
        <p className="task-empty">
          Назначенных задач пока нет. Когда появится задача, здесь будут
          критерии и отчёт.
        </p>
      )}
      {list && list.tasks.length > 0 && (
        <ul className="task-list">
          {list.tasks.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`task-row${detail?.task.id === item.id ? " task-row--selected" : ""}`}
                onClick={() => {
                  setDetail(null);
                  setReport("");
                  setMessage("");
                  void loadDetail(item.id);
                }}
              >
                <span className="task-row-title">{item.title}</span>
                <span className="task-row-meta">
                  {statusText[item.status]} · {priorityText[item.priority]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list?.nextCursor && (
        <button
          type="button"
          className="task-text-button task-more"
          onClick={() => void loadList(list.nextCursor!, true)}
        >
          Показать ещё
        </button>
      )}
      {detailState === "loading" && (
        <p role="status" className="task-muted">
          Открываем задачу…
        </p>
      )}
      {detailState === "error" && (
        <p role="alert" className="task-error">
          Детали не загрузились. Выберите задачу снова.
        </p>
      )}
      {task && (
        <article className="task-detail" aria-labelledby="task-detail-title">
          <div className="task-detail-top">
            <span>{statusText[task.status]}</span>
            <span>v{task.version}</span>
          </div>
          <h3 id="task-detail-title">{task.title}</h3>
          <p className="task-detail-label">Критерии результата</p>
          <p className="task-criteria">{task.criteria}</p>
          <dl className="task-facts">
            <div>
              <dt>Приоритет</dt>
              <dd>{priorityText[task.priority]}</dd>
            </div>
            <div>
              <dt>Срок</dt>
              <dd>
                {task.dueAt
                  ? new Date(task.dueAt).toLocaleDateString("ru-RU")
                  : "Не указан"}
              </dd>
            </div>
            <div>
              <dt>Фонд</dt>
              <dd>
                {task.baseXp} XP · {task.basePoints} баллов
              </dd>
            </div>
            <div>
              <dt>Правила</dt>
              <dd>Версия {task.ruleSetVersion}</dd>
            </div>
          </dl>
          {detail.submission && (
            <div className="task-report-history">
              <p className="task-detail-label">Последний отчёт</p>
              <p>{detail.submission.report}</p>
              {detail.returnReason && (
                <p className="task-return-reason">
                  Причина возврата: {detail.returnReason}
                </p>
              )}
            </div>
          )}
          {isMine &&
            (task.status === "assigned" || task.status === "needs_work") && (
              <button
                type="button"
                className="task-primary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/api/v1/tasks/${task.id}/start`,
                    { expectedVersion: task.version },
                    "Задача в работе.",
                  )
                }
              >
                {task.status === "needs_work"
                  ? "Продолжить работу"
                  : "Начать работу"}
              </button>
            )}
          {isMine && task.status === "in_progress" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  `/api/v1/tasks/${task.id}/submissions`,
                  { expectedVersion: task.version, report: report.trim() },
                  "Отчёт отправлен на проверку. Начисления пока нет.",
                );
              }}
            >
              <label className="task-detail-label" htmlFor="task-report">
                Отчёт о результате
              </label>
              <textarea
                id="task-report"
                value={report}
                onChange={(event) => setReport(event.target.value)}
                minLength={1}
                maxLength={4000}
                required
                rows={5}
              />
              <button
                type="submit"
                className="task-primary"
                disabled={busy || !report.trim()}
              >
                Отправить на проверку
              </button>
            </form>
          )}
          {canReview &&
            !isMine &&
            task.status === "in_review" &&
            detail.submission && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    `/api/v1/submissions/${detail.submission!.id}/review`,
                    {
                      decision: "return",
                      expectedVersion: task.version,
                      reason: returnReason.trim(),
                    },
                    "Отчёт возвращён на доработку.",
                  );
                }}
              >
                <label className="task-detail-label" htmlFor="task-return">
                  Причина возврата
                </label>
                <textarea
                  id="task-return"
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  minLength={1}
                  maxLength={1000}
                  required
                  rows={3}
                />
                <button
                  type="submit"
                  className="task-secondary"
                  disabled={busy || !returnReason.trim()}
                >
                  Вернуть на доработку
                </button>
              </form>
            )}
          {task.status === "in_review" && isMine && (
            <p className="task-muted">
              Отчёт ожидает решения проверяющего. XP и баллы ещё не начислены.
            </p>
          )}
          {message && (
            <p role="status" className="task-message">
              {message}
            </p>
          )}
        </article>
      )}
    </section>
  );
}
