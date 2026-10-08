"use client";

import {
  taskDetailResponseSchema,
  taskListResponseSchema,
  type TaskDetailResponse,
  type TaskListResponse,
} from "@impuls/contracts";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { TaskReport } from "./task-report";
import { TaskHistory } from "./task-history";
import { TaskTimeline } from "./task-timeline";
import { ReviewQueue } from "@/features/reviews/review-queue";
import { AccountLedger } from "@/features/ledger/account-ledger";
import { TaskManagement } from "@/features/task-management/task-management";
import { Leaderboard } from "@/features/ranking/leaderboard";
import { ParticipantProfile } from "@/features/profile/participant-profile";
import { AuditLog } from "@/features/audit/audit-log";
import { CatalogAdmin } from "@/features/catalog-admin/catalog-admin";
import { NotificationStatus } from "@/features/notifications/notification-status";
import { RewardCatalog } from "@/features/rewards/reward-catalog";

type TaskStatus = TaskListResponse["items"][number]["status"];
type StatusFilter = TaskStatus | "all";

const statusNames: Record<TaskStatus, string> = {
  assigned: "Назначена",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_work: "На доработке",
  accepted: "Принята",
  cancelled: "Отменена",
};

const priorityNames = {
  critical: "Критический",
  high: "Высокий",
  normal: "Штатный",
} as const;

class TaskRequestError extends Error {
  constructor(readonly status: number) {
    super(`Task request failed: ${status}`);
  }
}

async function readTasks(
  cursor: string | null,
  status: StatusFilter,
  signal: AbortSignal,
): Promise<TaskListResponse> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (status !== "all") params.set("status", status);
  const response = await fetch(`/api/v1/tasks?${params}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new TaskRequestError(response.status);
  return taskListResponseSchema.parse(await response.json());
}

async function readTask(
  taskId: string,
  signal: AbortSignal,
): Promise<TaskDetailResponse> {
  const response = await fetch(`/api/v1/tasks/${taskId}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new TaskRequestError(response.status);
  return taskDetailResponseSchema.parse(await response.json());
}

function taskError(error: Error | null): string {
  if (!navigator.onLine)
    return "Нет соединения. Проверьте сеть и повторите загрузку.";
  if (error instanceof TaskRequestError) {
    if (error.status === 401)
      return "Сессия завершилась. Проверьте вход снова.";
    if (error.status === 403) return "Доступ изменился. Проверьте вход снова.";
    if (error.status === 404) return "Задача больше недоступна.";
  }
  return "Не удалось загрузить задачи. Повторите попытку.";
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function TaskListContent() {
  const { confirmLeave, loseAccess } = useAuthorizedSession();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useTelegramBack(
    selectedId !== null,
    () => {
      if (confirmLeave()) setSelectedId(null);
    },
    30,
  );
  const tasks = useInfiniteQuery({
    queryKey: ["assigned-tasks", status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readTasks(pageParam, status, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["assigned-task", selectedId],
    queryFn: ({ signal }) => readTask(selectedId!, signal),
    enabled: selectedId !== null,
    retry: false,
  });
  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    for (const error of [tasks.error, detail.error]) {
      if (
        error instanceof TaskRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        loseAccess(error.status);
        return;
      }
    }
  }, [tasks.error, detail.error, loseAccess]);
  const accessError =
    (tasks.isError || tasks.isFetchNextPageError) &&
    tasks.error instanceof TaskRequestError &&
    (tasks.error.status === 401 || tasks.error.status === 403);

  return (
    <section className="tasks-section" aria-labelledby="tasks-title">
      <div className="tasks-heading">
        <div>
          <h2 id="tasks-title">Назначенные задачи</h2>
          <p>Ваши текущие и завершённые назначения.</p>
        </div>
        <label className="tasks-filter">
          <span>Статус</span>
          <select
            value={status}
            onChange={(event) => {
              if (!confirmLeave()) return;
              setStatus(event.target.value as StatusFilter);
              setSelectedId(null);
            }}
          >
            <option value="all">Все</option>
            {Object.entries(statusNames).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tasks.isPending ? (
        <p className="tasks-state" role="status">
          Загружаем задачи…
        </p>
      ) : accessError ? (
        <div className="tasks-state" role="alert">
          <p>{taskError(tasks.error)}</p>
          <button
            type="button"
            className="tasks-action"
            onClick={() => window.location.reload()}
          >
            Проверить вход
          </button>
        </div>
      ) : tasks.isError && items.length === 0 ? (
        <div className="tasks-state" role="alert">
          <p>{taskError(tasks.error)}</p>
          <button
            type="button"
            className="tasks-action"
            onClick={() =>
              accessError ? window.location.reload() : void tasks.refetch()
            }
          >
            {accessError ? "Проверить вход" : "Повторить загрузку"}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="tasks-state">По выбранному статусу задач нет.</p>
      ) : (
        <>
          <ul className="tasks-list">
            {items.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="tasks-row"
                  aria-expanded={selectedId === task.id}
                  onClick={() => {
                    if (confirmLeave())
                      setSelectedId(selectedId === task.id ? null : task.id);
                  }}
                >
                  <span className="tasks-row-main">
                    <strong>{task.title}</strong>
                    <span>
                      {statusNames[task.status]} · до {dateLabel(task.dueAt)}
                    </span>
                  </span>
                  <span className="tasks-row-fund">
                    <strong>{task.fundXp} XP</strong>
                    <span>{task.fundPoints} баллов</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {tasks.hasNextPage && (
            <button
              type="button"
              className="tasks-action tasks-more"
              disabled={tasks.isFetchingNextPage}
              onClick={() => void tasks.fetchNextPage()}
            >
              {tasks.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
          {tasks.isFetchNextPageError && (
            <p className="tasks-state" role="alert">
              {taskError(tasks.error)}
            </p>
          )}
        </>
      )}

      {selectedId && (
        <section className="tasks-detail" aria-labelledby="task-detail-title">
          <div className="tasks-detail-top">
            <h3 id="task-detail-title">Критерии задачи</h3>
            <button
              type="button"
              className="tasks-close"
              onClick={() => {
                if (confirmLeave()) setSelectedId(null);
              }}
            >
              Закрыть
            </button>
          </div>
          {detail.isPending ? (
            <p role="status">Загружаем детали…</p>
          ) : detail.isError && !detail.data ? (
            <div role="alert">
              <p>{taskError(detail.error)}</p>
              {!(
                detail.error instanceof TaskRequestError &&
                detail.error.status === 404
              ) && (
                <button
                  type="button"
                  className="tasks-action"
                  onClick={() => void detail.refetch()}
                >
                  Повторить
                </button>
              )}
            </div>
          ) : detail.data ? (
            <>
              {detail.isError && (
                <p role="alert">
                  {taskError(detail.error)} Последнее подтверждённое состояние:{" "}
                  {dateLabel(detail.data.task.updatedAt)}.
                </p>
              )}
              <p className="tasks-detail-criteria">
                {detail.data.task.criteria}
              </p>
              <dl>
                <div>
                  <dt>Приоритет</dt>
                  <dd>{priorityNames[detail.data.task.priority]}</dd>
                </div>
                <div>
                  <dt>Область</dt>
                  <dd>{detail.data.task.scope.name}</dd>
                </div>
                <div>
                  <dt>Версия правил</dt>
                  <dd>{detail.data.task.ruleVersion}</dd>
                </div>
              </dl>
              <TaskReport key={selectedId} task={detail.data.task} />
              <TaskTimeline
                key={`timeline-${selectedId}`}
                taskId={selectedId}
              />
              <TaskHistory key={`history-${selectedId}`} taskId={selectedId} />
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}

function TaskWorkspace() {
  const {
    canReview,
    canReadAudit,
    canInspectCatalog,
    canReadNotificationStatus,
    canManageTasks,
    canSetTasks,
    confirmLeave,
  } = useAuthorizedSession();
  const [view, setView] = useState<
    | "tasks"
    | "reviews"
    | "ledger"
    | "management"
    | "ranking"
    | "profile"
    | "audit"
    | "catalog-admin"
    | "notifications"
    | "rewards"
  >(canReview ? "reviews" : "tasks");
  const rootView = canReview ? "reviews" : "tasks";
  useTelegramBack(
    view !== rootView,
    () => {
      if (confirmLeave()) setView(rootView);
    },
    10,
  );
  type Destination = {
    id: typeof view;
    label: string;
    accessibleLabel: string;
  };
  const personal: Destination[] = [
    { id: "tasks", label: "Задачи", accessibleLabel: "Мои задачи" },
    { id: "ledger", label: "Баланс", accessibleLabel: "Баланс и журнал" },
    { id: "rewards", label: "Каталог", accessibleLabel: "Поощрения" },
    { id: "ranking", label: "Рейтинг", accessibleLabel: "Рейтинг" },
    { id: "profile", label: "Профиль", accessibleLabel: "Мой профиль" },
  ];
  const operations: Destination[] = [];
  if (canReview)
    operations.push({
      id: "reviews",
      label: "Проверка",
      accessibleLabel: "Проверка отчётов",
    });
  if (canManageTasks)
    operations.push({
      id: "management",
      label: canSetTasks ? "Постановка" : "История",
      accessibleLabel: canSetTasks ? "Постановка задач" : "Задачи и история",
    });
  if (canInspectCatalog)
    operations.push({
      id: "catalog-admin",
      label: "Конфигурация",
      accessibleLabel: "Управление каталогом",
    });
  if (canReadAudit)
    operations.push({
      id: "audit",
      label: "Журнал",
      accessibleLabel: "Журнал действий",
    });
  if (canReadNotificationStatus)
    operations.push({
      id: "notifications",
      label: "Уведомления",
      accessibleLabel: "Состояние уведомлений",
    });
  const destination = (item: Destination) => (
    <button
      key={item.id}
      type="button"
      className="workspace-tab"
      aria-label={item.accessibleLabel}
      aria-pressed={view === item.id}
      onClick={() => {
        if (confirmLeave()) setView(item.id);
      }}
    >
      {item.label}
    </button>
  );
  return (
    <>
      <nav className="workspace-nav" aria-label="Рабочие разделы">
        <div className="workspace-nav-personal">
          {personal.map(destination)}
        </div>
        {operations.length ? (
          <div className="workspace-nav-operations">
            {operations.map(destination)}
          </div>
        ) : null}
      </nav>
      {view === "rewards" ? (
        <RewardCatalog />
      ) : view === "catalog-admin" && canInspectCatalog ? (
        <CatalogAdmin />
      ) : view === "notifications" && canReadNotificationStatus ? (
        <NotificationStatus />
      ) : view === "audit" && canReadAudit ? (
        <AuditLog />
      ) : view === "management" && canManageTasks ? (
        <TaskManagement />
      ) : view === "profile" ? (
        <ParticipantProfile />
      ) : view === "ranking" ? (
        <Leaderboard />
      ) : view === "ledger" ? (
        <AccountLedger />
      ) : view === "reviews" && canReview ? (
        <ReviewQueue />
      ) : (
        <TaskListContent />
      )}
    </>
  );
}

export function TaskList() {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <TaskWorkspace />
    </QueryClientProvider>
  );
}
