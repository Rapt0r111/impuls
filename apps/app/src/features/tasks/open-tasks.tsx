"use client";

import {
  openTaskListResponseSchema,
  taskClaimResponseSchema,
  type OpenTask,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  useAuthorizedSession,
  useManyScopes,
} from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import "./open-tasks.css";

export const OPEN_TASKS_KEY = ["open-tasks"];

class OpenTasksError extends Error {
  constructor(readonly status: number) {
    super(`Open tasks request failed: ${status}`);
  }
}

async function loadOpenTasks(signal: AbortSignal): Promise<OpenTask[]> {
  const response = await fetch("/api/v1/tasks/open", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new OpenTasksError(response.status);
  return openTaskListResponseSchema.parse(await response.json()).items;
}

// Свободные задачи области, которые участник может взять. Пустой список при выключенной
// функции или ошибке: раздел тогда просто не показывается.
export function useOpenTasks() {
  // Ошибка (в том числе потеря доступа) просто скрывает раздел: потерю доступа
  // обрабатывают основные запросы списка задач.
  return useQuery({
    queryKey: OPEN_TASKS_KEY,
    queryFn: ({ signal }) => loadOpenTasks(signal),
    retry: false,
  });
}

const priorityNames = {
  critical: "Критический",
  high: "Высокий",
  normal: "Штатный",
} as const;

const dueText = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function OpenTaskList({
  items,
  onClaimed,
}: {
  items: OpenTask[];
  onClaimed(taskId: string): void;
}) {
  const manyScopes = useManyScopes();
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Один ключ на одно намерение «взять эту версию задачи»: повтор после обрыва
  // не создаст второе назначение.
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);

  async function claim(task: OpenTask) {
    if (running.current) return;
    if (
      !window.confirm(
        `Взять задачу «${task.title}»?\n\n${manyScopes ? `Область: ${task.scope.name}\n` : ""}Срок: ${dueText(task.dueAt)}\nНаграда за приёмку: до ${task.fundXp} XP и ${task.fundPoints} баллов\n\nПосле этого задача станет вашей, и остальные её не увидят.`,
      )
    )
      return;
    running.current = true;
    setPendingId(task.id);
    setMessage(null);
    const intent = `${task.id}:${task.version}`;
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          action: "claim",
          expectedVersion: task.version,
        }),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        loseAccess(response.status);
        return;
      }
      if (response.status === 429) {
        setMessage(mutationLimitMessage(response));
        return;
      }
      if (response.status === 409 || response.status === 404) {
        keys.current.delete(intent);
        const body = (await response.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        if (body?.code === "OPEN_TASK_LIMIT" && body.message) {
          setMessage(body.message);
          return;
        }
        setMessage("Эту задачу уже взяли или она изменилась. Список обновлён.");
        await client.invalidateQueries({ queryKey: OPEN_TASKS_KEY });
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      const saved = taskClaimResponseSchema.parse(await response.json());
      keys.current.delete(intent);
      await client.invalidateQueries({ queryKey: OPEN_TASKS_KEY });
      await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
      onClaimed(saved.task.id);
    } catch {
      setMessage(
        "Результат не подтверждён. Нажмите «Взять» ещё раз: вторая задача не создастся.",
      );
    } finally {
      window.clearTimeout(timeout);
      running.current = false;
      setPendingId(null);
    }
  }

  return (
    <>
      <p className="open-tasks-note">
        Свободные задачи. Возьмите ту, которую готовы выполнить: она станет
        вашей и появится в «Активных».
      </p>
      {message ? (
        <p role="alert" className="open-tasks-message">
          {message}
        </p>
      ) : null}
      {items.length ? (
        <ul className="open-tasks">
          {items.map((task) => (
            <li key={task.id} className="open-task">
              <div className="open-task-head">
                <strong>{task.title}</strong>
                {manyScopes ? (
                  <span className="open-task-scope">{task.scope.name}</span>
                ) : null}
              </div>
              <p className="open-task-criteria">{task.criteria}</p>
              <p className="open-task-meta">
                <span className="task-chip task-chip--xp">
                  {task.fundXp} XP
                </span>
                <span className="task-chip task-chip--points">
                  {task.fundPoints} баллов
                </span>
                {task.priority !== "normal" ? (
                  <span
                    className={`task-chip task-chip--priority task-chip--${task.priority}`}
                  >
                    {priorityNames[task.priority]}
                  </span>
                ) : null}
                <span className="open-task-due">до {dueText(task.dueAt)}</span>
              </p>
              <button
                type="button"
                className="tasks-action open-task-claim"
                disabled={pendingId !== null}
                onClick={() => void claim(task)}
              >
                {pendingId === task.id ? "Берём…" : "Взять"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tasks-empty">Свободных задач сейчас нет.</p>
      )}
    </>
  );
}
