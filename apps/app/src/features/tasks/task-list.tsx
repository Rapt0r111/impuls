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
import { useEffect, useState, type ReactNode } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { TaskReport } from "./task-report";
import { TaskHistory } from "./task-history";
import { TaskTimeline } from "./task-timeline";
import { Home } from "@/features/home/home";
import { ReviewQueue } from "@/features/reviews/review-queue";
import { AccountLedger } from "@/features/ledger/account-ledger";
import { TaskManagement } from "@/features/task-management/task-management";
import { Leaderboard } from "@/features/ranking/leaderboard";
import { ParticipantProfile } from "@/features/profile/participant-profile";
import { AuditLog } from "@/features/audit/audit-log";
import { CatalogAdmin } from "@/features/catalog-admin/catalog-admin";
import { AccessAdmin } from "@/features/access-admin/access-admin";
import { NotificationStatus } from "@/features/notifications/notification-status";
import { RewardCatalog } from "@/features/rewards/reward-catalog";
import { MoreMenu, type MoreTarget } from "@/features/more/more-menu";

const moreTargets: MoreTarget[] = [
  "profile",
  "ledger",
  "reviews",
  "management",
  "catalog-admin",
  "access",
  "audit",
  "notifications",
];

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

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// «Сегодня до 18:00» или «до 24 окт. 2026 г., 12:00»: срок читается без расчёта в уме.
function dueLabel(value: string): string {
  const due = new Date(value),
    now = new Date();
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  return sameDay
    ? `Сегодня до ${timeLabel(value)}`
    : `до ${dateLabel(value)}, ${timeLabel(value)}`;
}

// Остаток времени до срока; после срока — просрочка. Считается при отрисовке,
// поэтому в отчётах не появляется придуманной точности: единица не мельче минуты.
function remainingLabel(value: string): string {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  const absolute = Math.abs(minutes);
  const days = Math.floor(absolute / 1440),
    hours = Math.floor((absolute % 1440) / 60),
    rest = absolute % 60;
  const parts = days
    ? [`${days} д`, hours ? `${hours} ч` : null]
    : hours
      ? [`${hours} ч`, rest ? `${rest} мин` : null]
      : [`${rest} мин`];
  const text = parts.filter(Boolean).join(" ");
  return minutes < 0 ? `просрочено на ${text}` : `осталось ${text}`;
}

// Критерии приходят одним текстом; нумерация строится по непустым строкам.
function criteriaLines(criteria: string): string[] {
  const lines = criteria
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*\d.)\s]+/, "").trim())
    .filter(Boolean);
  return lines.length > 1 ? lines : [];
}

// Значок состояния задачи в карточке: форма отличается, а не только цвет.
const statusIcons: Record<string, ReactNode> = {
  assigned: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="3" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  in_progress: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  in_review: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  needs_work: (
    <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />
  ),
  accepted: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  cancelled: <path d="M6 6l12 12M18 6 6 18" />,
};

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

  const openTask = detail.data?.task;
  if (selectedId)
    return (
      <section className="tasks-section" aria-labelledby="task-detail-title">
        <button
          type="button"
          className="more-back task-back"
          onClick={() => {
            if (confirmLeave()) setSelectedId(null);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
          <span>Задачи</span>
        </button>
        <section className="tasks-detail" aria-labelledby="task-detail-title">
          {detail.isPending ? (
            <>
              <h2 id="task-detail-title">Задача</h2>
              <p role="status">Загружаем детали…</p>
            </>
          ) : detail.isError && !openTask ? (
            <>
              <h2 id="task-detail-title">Задача</h2>
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
            </>
          ) : openTask ? (
            <>
              <div className="task-detail-top">
                <span
                  className={`task-chip task-chip--status task-chip--${openTask.status}`}
                >
                  {statusNames[openTask.status]}
                </span>
                <span className="task-detail-due">
                  {dueLabel(openTask.dueAt)}
                </span>
              </div>
              <h2 id="task-detail-title">{openTask.title}</h2>
              <p className="task-detail-remaining">
                {remainingLabel(openTask.dueAt)}
              </p>
              <div className="task-detail-funds">
                <span className="task-chip task-chip--xp">
                  {openTask.fundXp} XP
                </span>
                <span className="task-chip task-chip--points">
                  {openTask.fundPoints} баллов
                </span>
                <span
                  className={`task-chip task-chip--priority task-chip--${openTask.priority}`}
                >
                  {priorityNames[openTask.priority]}
                </span>
              </div>
              {detail.isError && (
                <p role="alert">
                  {taskError(detail.error)} Последнее подтверждённое состояние:{" "}
                  {dateLabel(openTask.updatedAt)}.
                </p>
              )}
              <section aria-labelledby="task-criteria-title">
                <h3 id="task-criteria-title">Критерии задачи</h3>
                {criteriaLines(openTask.criteria).length ? (
                  <ol className="task-criteria">
                    {criteriaLines(openTask.criteria).map((line, index) => (
                      <li key={`${index}-${line}`}>
                        <span aria-hidden="true">{index + 1}</span>
                        {line}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="tasks-detail-criteria">{openTask.criteria}</p>
                )}
              </section>
              <dl>
                <div>
                  <dt>Область</dt>
                  <dd>{openTask.scope.name}</dd>
                </div>
                <div>
                  <dt>Версия правил</dt>
                  <dd>{openTask.ruleVersion}</dd>
                </div>
              </dl>
              <TaskReport key={selectedId} task={openTask} />
              <TaskTimeline
                key={`timeline-${selectedId}`}
                taskId={selectedId}
              />
              <TaskHistory key={`history-${selectedId}`} taskId={selectedId} />
            </>
          ) : null}
        </section>
      </section>
    );

  return (
    <section className="tasks-section" aria-labelledby="tasks-title">
      <div className="tasks-heading">
        <div>
          <h2 id="tasks-title">Задачи</h2>
          <p>Ваши текущие и завершённые назначения.</p>
        </div>
      </div>
      <div className="tasks-seg" role="group" aria-label="Статус">
        {[["all", "Все"], ...Object.entries(statusNames)].map(
          ([value, label]) => (
            <button
              type="button"
              key={value}
              className="tasks-seg-item"
              aria-pressed={status === value}
              onClick={() => {
                if (!confirmLeave()) return;
                setStatus(value as StatusFilter);
                setSelectedId(null);
              }}
            >
              {label}
            </button>
          ),
        )}
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
                  onClick={() => {
                    if (confirmLeave()) setSelectedId(task.id);
                  }}
                >
                  <span
                    className={`task-tile task-tile--${task.status}`}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24">{statusIcons[task.status]}</svg>
                  </span>
                  <span className="tasks-row-main">
                    <strong>{task.title}</strong>
                  </span>
                  <span className="tasks-row-meta">
                    <span
                      className={`task-chip task-chip--status task-chip--${task.status}`}
                    >
                      {statusNames[task.status]}
                    </span>
                    <span className="tasks-row-due">
                      до {dateLabel(task.dueAt)}
                    </span>
                  </span>
                  <span className="tasks-row-fund">
                    <span className="task-chip task-chip--xp">
                      {task.fundXp} XP
                    </span>
                    <span className="task-chip task-chip--points">
                      {task.fundPoints} баллов
                    </span>
                    <span
                      className={`task-chip task-chip--priority task-chip--${task.priority}`}
                    >
                      {priorityNames[task.priority]}
                    </span>
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
    </section>
  );
}

// Линейные иконки 24×24, как в прототипе R0 (stroke 1.7, round).
const tabIcons: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v10h12V10M10 20v-5h4v5" />
    </>
  ),
  tasks: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  rewards: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M8 8a2.5 2.5 0 1 1 4-2M16 8a2.5 2.5 0 1 0-4-2" />
    </>
  ),
  ranking: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4v1a3 3 0 0 0 3 3M16 6h4v1a3 3 0 0 1-3 3" />
      <path d="M12 13v4M8 20h8M10 17h4" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </>
  ),
};

type WorkspaceView =
  "home" | "tasks" | "ranking" | "rewards" | "more" | MoreTarget;

function TaskWorkspace() {
  const {
    canReview,
    canReadAudit,
    canInspectCatalog,
    accessScopes,
    canReadNotificationStatus,
    canManageTasks,
    confirmLeave,
  } = useAuthorizedSession();
  const [view, setView] = useState<WorkspaceView>(
    canReview ? "reviews" : "home",
  );
  const rootView: WorkspaceView = canReview ? "reviews" : "home";
  const inMore = view === "more" || moreTargets.includes(view as MoreTarget);
  // Назад из раздела «Ещё» ведёт в меню «Ещё», из самого меню — на стартовый экран.
  const goBack = () => {
    if (!confirmLeave()) return;
    setView(view === "more" || !inMore ? rootView : "more");
  };
  useTelegramBack(view !== rootView, goBack, 10);
  // Раздел сообщает странице, какой экран открыт: «Главная» получает крупную шапку.
  useEffect(() => {
    document.documentElement.dataset.view = view;
    return () => {
      delete document.documentElement.dataset.view;
    };
  }, [view]);
  const tabs: { id: WorkspaceView; label: string; accessibleLabel: string }[] =
    [
      { id: "home", label: "Главная", accessibleLabel: "Главная" },
      { id: "tasks", label: "Задачи", accessibleLabel: "Мои задачи" },
      { id: "ranking", label: "Рейтинг", accessibleLabel: "Рейтинг" },
      { id: "rewards", label: "Поощрения", accessibleLabel: "Поощрения" },
      { id: "more", label: "Ещё", accessibleLabel: "Ещё" },
    ];
  const isCurrent = (id: WorkspaceView) =>
    id === "more" ? inMore : view === id;
  return (
    <>
      <nav className="workspace-nav" aria-label="Рабочие разделы">
        <div className="workspace-nav-personal">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className="workspace-tab"
              aria-label={item.accessibleLabel}
              aria-pressed={isCurrent(item.id)}
              onClick={() => {
                if (confirmLeave()) setView(item.id);
              }}
            >
              <span className="workspace-tab-pill" aria-hidden="true">
                <svg className="workspace-tab-icon" viewBox="0 0 24 24">
                  {tabIcons[item.id]}
                </svg>
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
      {inMore && view !== "more" ? (
        <button type="button" className="more-back" onClick={goBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
          <span>Ещё</span>
        </button>
      ) : null}
      {view === "more" ? (
        <MoreMenu
          onOpen={(to) => {
            if (confirmLeave()) setView(to);
          }}
        />
      ) : view === "rewards" ? (
        <RewardCatalog />
      ) : view === "catalog-admin" && canInspectCatalog ? (
        <CatalogAdmin />
      ) : view === "access" && accessScopes?.length ? (
        <AccessAdmin />
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
      ) : view === "home" ? (
        <Home onNavigate={setView} />
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
