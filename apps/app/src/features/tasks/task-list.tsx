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
import {
  useAuthorizedSession,
  useManyScopes,
} from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { TaskReport } from "./task-report";
import { OpenTaskList, useOpenTasks } from "./open-tasks";
import { TaskHistory } from "./task-history";
import { TaskTimeline } from "./task-timeline";
import { Home } from "@/features/home/home";
import { ReviewQueue } from "@/features/reviews/review-queue";
import { AccountLedger } from "@/features/ledger/account-ledger";
import { TaskManagement } from "@/features/task-management/task-management";
import { Leaderboard } from "@/features/ranking/leaderboard";
import { ParticipantProfile } from "@/features/profile/participant-profile";
import { AuditLog } from "@/features/audit/audit-log";
import { RulesAdmin } from "@/features/rules-admin/rules-admin";
import { CatalogAdmin } from "@/features/catalog-admin/catalog-admin";
import { AccessAdmin } from "@/features/access-admin/access-admin";
import { NotificationStatus } from "@/features/notifications/notification-status";
import { RewardCatalog } from "@/features/rewards/reward-catalog";
import { MoreScreen, type MoreDestination } from "@/features/more/more-screen";

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

// Три раздела списка по макету. Фильтрация выполняется по загруженным
// страницам, поэтому число в разделе показывается только когда список полный.
type Segment = "active" | "review" | "done" | "open";
const segments: readonly (readonly [Segment, string])[] = [
  ["active", "Активные"],
  ["review", "Проверка"],
  ["done", "Готово"],
];
const emptyText: Record<Segment, string> = {
  active:
    "Задач в работе нет. Здесь появятся задачи, которые вам назначат или которые вы возьмёте сами.",
  review: "На проверке ничего нет. Сюда попадают отправленные отчёты.",
  done: "Принятых задач пока нет.",
  open: "Свободных задач сейчас нет.",
};
const segmentOf = (status: TaskStatus): Segment =>
  status === "in_review"
    ? "review"
    : status === "accepted" || status === "cancelled"
      ? "done"
      : "active";

const timeLabel = (date: Date) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
const dayKey = (date: Date) =>
  date.getFullYear() * 400 + date.getMonth() * 32 + date.getDate();

// «Сегодня, 18:00», «Завтра, 12:00» или «24 октября»; для невыполненной задачи
// с прошедшим сроком — «Просрочено · 8 октября».
function dueInfo(value: string, status: TaskStatus) {
  const due = new Date(value);
  const now = new Date();
  const open = segmentOf(status) === "active";
  const diff = dayKey(due) - dayKey(now);
  const long = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(due.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(due);
  if (open && due.getTime() < now.getTime())
    return { text: `Просрочено · ${long}`, tone: "late" as const };
  if (diff === 0)
    return { text: `Сегодня, ${timeLabel(due)}`, tone: "today" as const };
  if (diff === 1)
    return { text: `Завтра, ${timeLabel(due)}`, tone: "soon" as const };
  return { text: long, tone: "later" as const };
}

function DueIcon({ tone }: { tone: "late" | "today" | "soon" | "later" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {tone === "today" || tone === "late" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      ) : (
        <>
          <rect x="4" y="5" width="16" height="15" rx="3" />
          <path d="M4 10h16M9 3v4M15 3v4" />
        </>
      )}
    </svg>
  );
}

function TaskListContent() {
  const manyScopes = useManyScopes();
  const { confirmLeave, loseAccess } = useAuthorizedSession();
  // Пока участник не выбрал раздел сам, открывается первый непустой.
  const [chosen, setChosen] = useState<Segment | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useTelegramBack(
    selectedId !== null,
    () => {
      if (confirmLeave()) setSelectedId(null);
    },
    30,
  );
  const tasks = useInfiniteQuery({
    queryKey: ["assigned-tasks", "all"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readTasks(pageParam, "all", signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["assigned-task", selectedId],
    queryFn: ({ signal }) => readTask(selectedId!, signal),
    enabled: selectedId !== null,
    retry: false,
  });
  const openTasks = useOpenTasks();
  const openItems = openTasks.data ?? [];
  const allItems = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  const segment: Segment =
    chosen && (chosen !== "open" || openItems.length)
      ? chosen
      : (segments.find(([value]) =>
          allItems.some((task) => segmentOf(task.status) === value),
        )?.[0] ?? (openItems.length && !allItems.length ? "open" : "active"));
  const items = allItems.filter((task) => segmentOf(task.status) === segment);
  const complete = !tasks.hasNextPage && !tasks.isPending;
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
  const selected = allItems.find((task) => task.id === selectedId);

  if (selectedId) {
    const due = selected ? dueInfo(selected.dueAt, selected.status) : null;
    return (
      <section className="tasks-section task-screen" aria-label="Задача">
        <button
          type="button"
          className="screen-back"
          aria-label="Задачи: вернуться к списку"
          onClick={() => {
            if (confirmLeave()) setSelectedId(null);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
          Задачи
        </button>
        {detail.isPending ? (
          <p className="tasks-state" role="status">
            Загружаем детали…
          </p>
        ) : detail.isError && !detail.data ? (
          <div className="tasks-state" role="alert">
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
            <header className="task-hero">
              <div className="task-hero-meta">
                <span
                  className={`task-chip task-chip--status task-chip--${detail.data.task.status}`}
                >
                  {statusNames[detail.data.task.status]}
                </span>
                {selected && due ? (
                  <span className={`tasks-row-due tasks-row-due--${due.tone}`}>
                    <DueIcon tone={due.tone} />
                    {due.text}
                  </span>
                ) : null}
              </div>
              <h2>{detail.data.task.title}</h2>
              {selected ? (
                <div className="tasks-row-fund">
                  <span className="task-chip task-chip--xp">
                    {selected.fundXp} XP
                  </span>
                  <span className="task-chip task-chip--points">
                    {selected.fundPoints} баллов
                  </span>
                </div>
              ) : null}
            </header>
            <div className="tasks-detail">
              {detail.isError && (
                <p role="alert">
                  {taskError(detail.error)} Последнее подтверждённое состояние:{" "}
                  {dateLabel(detail.data.task.updatedAt)}.
                </p>
              )}
              <h3 id="task-detail-title">Критерии задачи</h3>
              <p className="tasks-detail-criteria">
                {detail.data.task.criteria}
              </p>
              <dl>
                <div>
                  <dt>Приоритет</dt>
                  <dd>{priorityNames[detail.data.task.priority]}</dd>
                </div>
                {manyScopes ? (
                  <div>
                    <dt>Область</dt>
                    <dd>{detail.data.task.scope.name}</dd>
                  </div>
                ) : null}
              </dl>
              <TaskReport key={selectedId} task={detail.data.task} />
              <TaskTimeline
                key={`timeline-${selectedId}`}
                taskId={selectedId}
              />
              <TaskHistory key={`history-${selectedId}`} taskId={selectedId} />
            </div>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="tasks-section" aria-labelledby="tasks-title">
      <div className="tasks-heading">
        <h2 id="tasks-title">Задачи</h2>
      </div>
      {segment === "open" ? (
        <button
          type="button"
          className="screen-back"
          aria-label="Свободные задачи: вернуться к моим задачам"
          onClick={() => setChosen("active")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
          Мои задачи
        </button>
      ) : (
        <>
          {openItems.length ? (
            <button
              type="button"
              className="open-tasks-banner"
              onClick={() => setChosen("open")}
            >
              <span>
                <strong>Свободные задачи</strong>
                <small>Можно взять самому</small>
              </span>
              <span className="task-chip task-chip--xp">
                {openItems.length}
              </span>
            </button>
          ) : null}
          {/* Без единой задачи переключать нечего: остаётся подсказка ниже. */}
          {allItems.length > 0 || !complete ? (
            <div className="tasks-seg" role="group" aria-label="Раздел списка">
              {segments.map(([value, label]) => {
                const count = allItems.filter(
                  (task) => segmentOf(task.status) === value,
                ).length;
                return (
                  <button
                    type="button"
                    key={value}
                    className="tasks-seg-item"
                    aria-pressed={segment === value}
                    onClick={() => setChosen(value)}
                  >
                    {label}
                    {complete && value !== "done" ? ` ${count}` : ""}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      )}

      {segment === "open" ? (
        <OpenTaskList
          items={openItems}
          onClaimed={(taskId) => {
            setChosen("active");
            setSelectedId(taskId);
          }}
        />
      ) : tasks.isPending ? (
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
      ) : tasks.isError && allItems.length === 0 ? (
        <div className="tasks-state" role="alert">
          <p>{taskError(tasks.error)}</p>
          <button
            type="button"
            className="tasks-action"
            onClick={() => void tasks.refetch()}
          >
            Повторить загрузку
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="tasks-state">
          {complete
            ? emptyText[segment]
            : "Среди загруженных задач с этим статусом нет. Нажмите «Показать ещё»."}
        </p>
      ) : (
        <ul className="tasks-list">
          {items.map((task) => {
            const due = dueInfo(task.dueAt, task.status);
            return (
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
                    <span
                      className={`tasks-row-due tasks-row-due--${due.tone}`}
                    >
                      <DueIcon tone={due.tone} />
                      {due.text}
                    </span>
                  </span>
                  <span className="tasks-row-fund">
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
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
    </section>
  );
}

// Линейные иконки 24×24, как в прототипе R0 (stroke 1.7, round).
const tabIcons: Record<string, ReactNode> = {
  home: (
    <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  ledger: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6c0 2.2-5 1.2-5 3.6 0 1 1 1.6 2.5 1.6s2.5-.6 2.5-1.6" />
    </>
  ),
  rewards: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M8 8a2.5 2.5 0 1 1 4-2M16 8a2.5 2.5 0 1 0-4-2" />
    </>
  ),
  ranking: <path d="M6 20v-7M12 20V5M18 20v-10" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </>
  ),
};

type WorkspaceView =
  | "home"
  | "tasks"
  | "ranking"
  | "rewards"
  | "more"
  | "profile"
  | "ledger"
  | "reviews"
  | "management"
  | "catalog-admin"
  | "access"
  | "audit"
  | "rules"
  | "notifications";
// Разделы, которые открываются из «Ещё»: у них вкладка «Ещё» активна, а возврат ведёт туда.
const moreViews: readonly WorkspaceView[] = [
  "more",
  "profile",
  "ledger",
  "reviews",
  "management",
  "catalog-admin",
  "access",
  "audit",
  "rules",
  "notifications",
];

function TaskWorkspace() {
  const {
    canReview,
    canReadAudit,
    canManageRules,
    canInspectCatalog,
    accessScopes,
    canReadNotificationStatus,
    canManageTasks,
    canSetTasks,
    confirmLeave,
  } = useAuthorizedSession();
  // Все начинают с «Главной»: у проверяющего там карточка очереди проверки.
  const rootView: WorkspaceView = "home";
  const [view, setView] = useState<WorkspaceView>(rootView);
  const inMore = moreViews.includes(view);
  // Экран, открытый карточкой на «Главной», возвращает туда же, а не в «Ещё».
  const [fromHome, setFromHome] = useState(false);
  const go = (next: WorkspaceView) => {
    if (confirmLeave()) {
      setFromHome(false);
      setView(next);
    }
  };
  useTelegramBack(
    view !== rootView,
    () => go(inMore && view !== "more" && !fromHome ? "more" : rootView),
    10,
  );
  const tabs: { id: WorkspaceView; label: string; accessibleLabel: string }[] =
    [
      { id: "home", label: "Главная", accessibleLabel: "Главная" },
      { id: "tasks", label: "Задачи", accessibleLabel: "Мои задачи" },
      { id: "ranking", label: "Рейтинг", accessibleLabel: "Рейтинг" },
      { id: "rewards", label: "Поощрения", accessibleLabel: "Поощрения" },
      { id: "more", label: "Ещё", accessibleLabel: "Ещё" },
    ];
  const destinations: MoreDestination[] = [
    { id: "ledger", label: "Баланс и журнал", group: "personal" },
  ];
  if (canReview)
    destinations.push({
      id: "reviews",
      label: "Очередь проверки",
      group: "commander",
    });
  if (canManageTasks)
    destinations.push({
      id: "management",
      label: canSetTasks ? "Постановка задач" : "Задачи и история",
      group: "commander",
    });
  if (canInspectCatalog)
    destinations.push({
      id: "catalog-admin",
      label: "Управление каталогом",
      group: "commander",
    });
  if (accessScopes?.length)
    destinations.push({
      id: "access",
      label: "Управление доступом",
      group: "commander",
    });
  if (canReadAudit)
    destinations.push({
      id: "audit",
      label: "Журнал действий",
      group: "commander",
    });
  if (canManageRules)
    destinations.push({
      id: "rules",
      label: "Настройки начислений",
      group: "commander",
    });
  if (canReadNotificationStatus)
    destinations.push({
      id: "notifications",
      label: "Состояние уведомлений",
      group: "commander",
    });
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
              aria-pressed={item.id === "more" ? inMore : view === item.id}
              onClick={() => go(item.id)}
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
        <button
          type="button"
          className="screen-back"
          aria-label={fromHome ? "Назад на «Главную»" : "Назад в раздел «Ещё»"}
          onClick={() => go(fromHome ? rootView : "more")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
          {fromHome ? "Главная" : "Ещё"}
        </button>
      ) : null}
      {view === "rewards" ? (
        <RewardCatalog />
      ) : view === "catalog-admin" && canInspectCatalog ? (
        <CatalogAdmin />
      ) : view === "access" && accessScopes?.length ? (
        <AccessAdmin />
      ) : view === "notifications" && canReadNotificationStatus ? (
        <NotificationStatus />
      ) : view === "audit" && canReadAudit ? (
        <AuditLog />
      ) : view === "rules" && canManageRules ? (
        <RulesAdmin />
      ) : view === "management" && canManageTasks ? (
        <TaskManagement />
      ) : view === "profile" ? (
        <ParticipantProfile />
      ) : view === "ranking" ? (
        <Leaderboard />
      ) : view === "home" ? (
        <Home
          onNavigate={(next) => {
            setFromHome(true);
            setView(next);
          }}
        />
      ) : view === "ledger" ? (
        <AccountLedger />
      ) : view === "reviews" && canReview ? (
        <ReviewQueue />
      ) : view === "more" ? (
        <MoreScreen
          destinations={destinations}
          onOpen={(id) => go(id as WorkspaceView)}
        />
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
