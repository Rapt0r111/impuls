"use client";

import { IntInput } from "@/shared/ui/int-input";
import { PointsScaleHint } from "@/shared/ui/points-scale-hint";
import { XpLimitHint } from "@/shared/ui/xp-limit-hint";
import { Select } from "@/shared/ui/select";
import { useTelegramBack } from "@/shared/telegram/back-navigation";

import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";

import {
  apiErrorSchema,
  TASK_POINTS_MAX,
  TASK_XP_MAX,
  taskCreateRequestSchema,
  taskEditRequestSchema,
  taskCancelRequestSchema,
  taskManagementListResponseSchema,
  taskManagementOptionsResponseSchema,
  taskManagementResponseSchema,
  type ManagementTask,
  type TaskCreateRequest,
  type TaskEditRequest,
  type TaskManagementOptionsResponse,
} from "@impuls/contracts";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
  useAuthorizedSession,
  useManyScopes,
} from "@/features/auth/session-context";
import { TaskTimeline } from "@/features/tasks/task-timeline";
import { TaskHistory } from "@/features/tasks/task-history";
import "./task-management.css";

const priorityOptions = [
  { value: "normal", label: "Штатный" },
  { value: "high", label: "Высокий" },
  { value: "critical", label: "Критический" },
];

type ScopeOption = TaskManagementOptionsResponse["scopes"][number];
type Draft = Omit<TaskCreateRequest, "dueAt"> & { dueAt: string };
type Attempt =
  | { action: "create"; key: string; body: string }
  | {
      action: "assign";
      key: string;
      body: string;
      taskId: string;
      recipient: string;
    };
type ChangeDraft = {
  action: "edit" | "cancel";
  task: ManagementTask;
  fields: TaskEditRequest;
};
type ChangeAttempt = {
  action: "edit" | "cancel";
  key: string;
  body: string;
  taskId: string;
};

class ManagementRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`Task management request failed: ${status}`);
  }
}

const priorityNames: Record<ManagementTask["priority"], string> = {
  critical: "Критический",
  high: "Высокий",
  normal: "Штатный",
};

const statusNames: Record<ManagementTask["status"], string> = {
  draft: "Черновик",
  assigned: "Назначена",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_work: "На доработке",
  accepted: "Принята",
  cancelled: "Отменена",
};

// Категория — необязательная метка для себя; база требует непустое значение.
const NO_CATEGORY = "Без категории";

function emptyDraft(): Draft {
  return {
    scopeId: "",
    ruleSetId: "",
    title: "",
    criteria: "",
    categoryCode: "",
    priority: "normal",
    dueAt: "",
    fundXp: 0,
    fundPoints: 0,
    openForClaim: false,
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatFunds(task: ManagementTask): string {
  return `${task.fundXp} XP · ${task.fundPoints} баллов`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function loadManagementPage(cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/task-management?${params}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new ManagementRequestError(response.status);
  return taskManagementListResponseSchema.parse(await response.json());
}

async function loadOptions(signal: AbortSignal) {
  const response = await fetch("/api/v1/task-management/options", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new ManagementRequestError(response.status);
  return taskManagementOptionsResponseSchema.parse(await response.json());
}

function requestMessage(error: Error | null): string {
  if (!navigator.onLine)
    return "Нет соединения. Проверьте сеть и повторите запрос.";
  if (error instanceof ManagementRequestError && error.status === 401)
    return "Сессия завершилась. Войдите снова.";
  if (error instanceof ManagementRequestError && error.status === 403)
    return "Доступ изменился. Проверьте вход снова.";
  return "Не удалось загрузить данные управления задачами.";
}

export function TaskManagement() {
  const manyScopes = useManyScopes();
  const { csrfToken, reportDirty, confirmLeave, loseAccess } =
    useAuthorizedSession();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  // Кому сразу назначить новую задачу: id участника или пусто (черновик).
  const [newAssignee, setNewAssignee] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    Attempt["action"] | ChangeAttempt["action"] | null
  >(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const attempt = useRef<Attempt | ChangeAttempt | null>(null);
  const [change, setChange] = useState<ChangeDraft | null>(null);
  useTelegramBack(
    change !== null,
    () => {
      if (confirmLeave()) setChange(null);
    },
    30,
  );
  const running = useRef(false);

  const options = useQuery({
    queryKey: ["task-management-options"],
    queryFn: ({ signal }) => loadOptions(signal),
    retry: false,
  });
  const list = useInfiniteQuery({
    queryKey: ["task-management"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadManagementPage(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const availableScopes = options.data?.scopes ?? [];
  const createScopes = availableScopes.filter((scope) => scope.canCreate);
  // Новая задача всегда берёт действующие настройки начислений: сервер отдаёт их первыми.
  const currentRuleSetId = options.data?.ruleSets[0]?.id ?? "";
  // Одна область — поле не показываем, задача создаётся в ней.
  const singleScope = createScopes.length === 1;
  const scopeId = draft.scopeId || (singleScope ? createScopes[0]!.id : "");
  const currentScope = availableScopes.find((scope) => scope.id === scopeId);
  const hasDraft = Boolean(
    draft.scopeId ||
    draft.title ||
    draft.criteria ||
    draft.categoryCode ||
    draft.dueAt ||
    draft.fundXp ||
    draft.fundPoints ||
    draft.openForClaim ||
    newAssignee,
  );

  useEffect(() => {
    reportDirty(hasDraft || change !== null || pending || uncertain);
    return () => reportDirty(false);
  }, [hasDraft, change, pending, uncertain, reportDirty]);

  useEffect(() => {
    for (const queryError of [options.error, list.error]) {
      if (
        queryError instanceof ManagementRequestError &&
        (queryError.status === 401 || queryError.status === 403)
      ) {
        loseAccess(queryError.status);
        return;
      }
    }
  }, [options.error, list.error, loseAccess]);

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (key === "scopeId") setNewAssignee("");
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  function recoverableMessage(status: number, code?: string): string {
    if (status === 404)
      return "Задача больше недоступна. Введённые данные сохранены; список и варианты обновлены.";
    if (status === 409)
      return "Данные задачи изменились. Черновик сохранён; список обновлён. Проверьте актуальные сведения перед новым действием.";
    if (status === 422 && (code?.includes("RULE") || code?.includes("rule")))
      return "Настройки начислений изменились. Обновите экран и повторите; поля сохранены.";
    if (
      status === 422 &&
      (code?.includes("ASSIGNEE") || code?.includes("assignee"))
    )
      return "Исполнитель больше не участвует. Выберите другого участника; критерии и поля сохранены.";
    if (status === 400 || status === 422)
      return "Проверьте поля задачи или доступность исполнителя. Введённые значения сохранены.";
    return "Сервер не подтвердил результат. Повторите тот же запрос с сохранённым ключом.";
  }

  async function send(
    action: "create" | "assign" | "edit" | "cancel",
    task?: ManagementTask,
  ) {
    if (running.current || (!attempt.current && (uncertain || pending))) return;

    let nextAttempt = attempt.current;
    if (!nextAttempt) {
      if (action === "create") {
        const dueAt = draft.dueAt ? new Date(draft.dueAt) : null;
        if (dueAt && !Number.isFinite(dueAt.getTime())) {
          setError("Проверьте срок задачи.");
          return;
        }
        const parsed = taskCreateRequestSchema.safeParse({
          ...draft,
          scopeId,
          ruleSetId: currentRuleSetId,
          categoryCode: draft.categoryCode.trim() || NO_CATEGORY,
          dueAt: dueAt ? dueAt.toISOString() : "",
        });
        if (!parsed.success) {
          setError(
            "Заполните название, критерии и срок. Суммы должны быть целыми неотрицательными числами.",
          );
          return;
        }
        nextAttempt = {
          action,
          key: crypto.randomUUID(),
          body: JSON.stringify(parsed.data),
        };
      } else if (action === "assign") {
        if (!task) return;
        const scope = availableScopes.find(
          (candidate) => candidate.id === task.scope.id,
        );
        const assigneeId = assignees[task.id];
        const recipient = scope?.assignees.find(
          (person) => person.id === assigneeId,
        );
        if (!scope?.canAssign || !recipient) {
          setError("Выберите исполнителя.");
          return;
        }
        const accepted = window.confirm(
          `Назначить задачу «${task.title}» участнику ${recipient.displayName}${manyScopes ? ` в области «${task.scope.name}»` : ""}?\n\nКритерии: ${task.criteria}\n\nФонд: ${formatFunds(task)}`,
        );
        if (!accepted) return;
        nextAttempt = {
          action,
          key: crypto.randomUUID(),
          taskId: task.id,
          recipient: recipient.displayName,
          body: JSON.stringify({
            assigneeId: recipient.id,
            expectedVersion: task.version,
          }),
        };
      } else {
        if (!change || change.action !== action) return;
        const raw =
          action === "edit"
            ? {
                ...change.fields,
                categoryCode: change.fields.categoryCode.trim() || NO_CATEGORY,
              }
            : {
                expectedVersion: change.fields.expectedVersion,
                reason: change.fields.reason,
              };
        const parsed = (
          action === "edit" ? taskEditRequestSchema : taskCancelRequestSchema
        ).safeParse(raw);
        if (!parsed.success) {
          setError(
            "Проверьте поля, срок в UTC и обязательную причину (до 2000 символов).",
          );
          return;
        }
        if (
          !window.confirm(
            `${action === "edit" ? "Сохранить черновик" : "Отменить задачу"} «${change.task.title}»?\nИсполнитель: ${change.task.assignee?.displayName ?? "не назначен"}\nФонд: ${action === "edit" ? `${change.fields.fundXp} XP · ${change.fields.fundPoints} баллов` : formatFunds(change.task)}\nПричина: ${parsed.data.reason}`,
          )
        )
          return;
        nextAttempt = {
          action,
          taskId: change.task.id,
          key: crypto.randomUUID(),
          body: JSON.stringify(parsed.data),
        };
      }
      attempt.current = nextAttempt;
    }
    const currentAttempt = nextAttempt;
    let followUp: Attempt | null = null;

    running.current = true;
    setPending(true);
    setPendingAction(currentAttempt.action);
    setError(null);
    setSuccess(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        currentAttempt.action === "create"
          ? "/api/v1/tasks"
          : `/api/v1/tasks/${currentAttempt.taskId}/${currentAttempt.action}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": currentAttempt.key,
          },
          body: currentAttempt.body,
        },
      );
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        attempt.current = null;
        loseAccess(response.status);
        return;
      }
      if (!response.ok) {
        if (response.status === 429) {
          setUncertain(true);
          setError(mutationLimitMessage(response));
          return;
        }
        const parsedError = apiErrorSchema.safeParse(payload);
        const code = parsedError.success ? parsedError.data.code : undefined;
        if ([400, 404, 409, 422].includes(response.status)) {
          attempt.current = null;
          setUncertain(false);
          setError(recoverableMessage(response.status, code));
          if ([404, 409, 422].includes(response.status)) {
            await client.invalidateQueries({ queryKey: ["task-management"] });
            await client.invalidateQueries({
              queryKey: ["task-management-options"],
            });
          }
          return;
        }
        throw new Error("Mutation result is unknown");
      }

      const result = taskManagementResponseSchema.parse(payload);
      attempt.current = null;
      setUncertain(false);
      if (currentAttempt.action === "create") {
        const recipient = currentScope?.assignees.find(
          (person) => person.id === newAssignee,
        );
        setDraft(emptyDraft());
        setNewAssignee("");
        setSuccess(
          result.task.openForClaim
            ? `Свободная задача «${result.task.title}» создана. Участники увидят её в разделе «Задачи».`
            : `Черновик «${result.task.title}» создан.`,
        );
        // Исполнитель выбран в форме: назначение уходит отдельным запросом
        // с собственным ключом, как кнопка «Назначить» в списке.
        if (recipient && currentScope?.canAssign && !result.task.openForClaim)
          followUp = {
            action: "assign",
            key: crypto.randomUUID(),
            taskId: result.task.id,
            recipient: recipient.displayName,
            body: JSON.stringify({
              assigneeId: recipient.id,
              expectedVersion: result.task.version,
            }),
          };
      } else if (currentAttempt.action === "assign") {
        setAssignees((current) => ({
          ...current,
          [currentAttempt.taskId]: "",
        }));
        setSuccess(
          `Задача назначена: ${currentAttempt.recipient}. Исполнитель увидит её в разделе «Задачи».`,
        );
      } else {
        setChange(null);
        setSuccess(
          currentAttempt.action === "edit"
            ? "Изменения черновика сохранены."
            : "Задача отменена. Отчёты и история сохранены; начислений нет.",
        );
      }
      await client.invalidateQueries({ queryKey: ["task-management"] });
      await client.invalidateQueries({ queryKey: ["task-timeline"] });
      await client.invalidateQueries({ queryKey: ["assigned-tasks"] });
      await client.invalidateQueries({ queryKey: ["assigned-task"] });
      await client.invalidateQueries({ queryKey: ["review-queue"] });
    } catch {
      setUncertain(attempt.current !== null);
      setError(
        navigator.onLine
          ? "Не удалось подтвердить результат. Данные и ключ сохранены; повторите тот же запрос."
          : "Нет соединения. Данные и ключ сохранены; восстановите сеть и повторите тот же запрос.",
      );
    } finally {
      window.clearTimeout(timeout);
      running.current = false;
      setPending(false);
      setPendingAction(null);
    }
    if (followUp) {
      attempt.current = followUp;
      await send("assign");
    }
  }

  function retryAttempt() {
    const currentAttempt = attempt.current;
    if (!currentAttempt) return;
    const task =
      currentAttempt.action === "assign"
        ? items.find((item) => item.id === currentAttempt.taskId)
        : undefined;
    void send(currentAttempt.action, task);
  }

  const optionsError = options.isError && options.data === undefined;
  const listError = list.isError && list.data === undefined;
  const accessLost = [options.error, list.error].some(
    (queryError) =>
      queryError instanceof ManagementRequestError &&
      (queryError.status === 401 || queryError.status === 403),
  );

  return (
    <section className="task-mgmt" aria-labelledby="task-mgmt-title">
      <header className="task-mgmt__heading">
        <div>
          <h2 id="task-mgmt-title">Управление задачами</h2>
          <p>Создавайте задачи и следите за ними.</p>
        </div>
      </header>

      {error && (
        <p
          className="task-mgmt__feedback task-mgmt__feedback--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="task-mgmt__feedback task-mgmt__feedback--success"
          role="status"
        >
          {success}
        </p>
      )}
      {options.isError && options.data && (
        <p
          className="task-mgmt__feedback task-mgmt__feedback--error"
          role="alert"
        >
          Не удалось обновить варианты. Используются последние подтверждённые
          участники и настройки начислений.
        </p>
      )}

      {options.isPending ? (
        <p className="task-mgmt__state" role="status">
          Загружаем участников и настройки начислений…
        </p>
      ) : accessLost ? (
        <p className="task-mgmt__state" role="alert">
          {requestMessage(options.error ?? list.error)}
        </p>
      ) : optionsError ? (
        <div className="task-mgmt__state" role="alert">
          <p>{requestMessage(options.error)}</p>
          <button
            type="button"
            className="task-mgmt__button"
            onClick={() => void options.refetch()}
          >
            Повторить загрузку
          </button>
        </div>
      ) : (
        <>
          {availableScopes.every(
            (scope) =>
              !scope.canCreate &&
              !scope.canAssign &&
              !scope.canEdit &&
              !scope.canCancel,
          ) && (
            <p className="task-mgmt__hint">
              Изменение задач сейчас недоступно. Обновите полномочия или
              обратитесь к администратору.
            </p>
          )}
          {createScopes.length > 0 && (
            <form
              className="task-mgmt__form"
              onSubmit={(event) => {
                event.preventDefault();
                void send("create");
              }}
            >
              <div className="task-mgmt__section-heading">
                <h3>Новая задача</h3>
              </div>
              <p className="task-mgmt__note">
                XP и баллы исполнитель получит после приёмки отчёта.
              </p>
              <div className="task-mgmt__fields">
                {singleScope ? null : (
                  <label>
                    <span id="task-mgmt-scope-label">Область</span>
                    <Select
                      labelledBy="task-mgmt-scope-label"
                      value={scopeId}
                      disabled={pending || uncertain}
                      onValueChange={(next) => setField("scopeId", next)}
                      options={[
                        { value: "", label: "Выберите область" },
                        ...createScopes.map((scope) => ({
                          value: scope.id,
                          label: scope.name,
                        })),
                      ]}
                    />
                  </label>
                )}
                <label className="task-mgmt__wide">
                  <span id="task-mgmt-title-label">Название</span>
                  <input
                    aria-labelledby="task-mgmt-title-label"
                    maxLength={120}
                    value={draft.title}
                    disabled={pending || uncertain}
                    onChange={(event) => setField("title", event.target.value)}
                    required
                  />
                </label>
                <label className="task-mgmt__wide">
                  <span id="task-mgmt-criteria-label">Критерии результата</span>
                  <textarea
                    aria-labelledby="task-mgmt-criteria-label"
                    rows={4}
                    maxLength={2000}
                    value={draft.criteria}
                    disabled={pending || uncertain}
                    onChange={(event) =>
                      setField("criteria", event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  <span id="task-mgmt-category-label">Категория</span>
                  <input
                    aria-labelledby="task-mgmt-category-label"
                    maxLength={40}
                    placeholder="Необязательно, например: уборка"
                    value={draft.categoryCode}
                    disabled={pending || uncertain}
                    onChange={(event) =>
                      setField("categoryCode", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span id="task-mgmt-priority-label">Приоритет</span>
                  <Select
                    labelledBy="task-mgmt-priority-label"
                    value={draft.priority}
                    disabled={pending || uncertain}
                    onValueChange={(next) =>
                      setField("priority", next as Draft["priority"])
                    }
                    options={priorityOptions}
                  />
                </label>
                <label>
                  <span id="task-mgmt-due-label">Срок</span>
                  <input
                    aria-labelledby="task-mgmt-due-label"
                    type="datetime-local"
                    value={draft.dueAt}
                    disabled={pending || uncertain}
                    onChange={(event) => setField("dueAt", event.target.value)}
                    required
                  />
                </label>
                <div className="task-mgmt__pair">
                  <label>
                    <span id="task-mgmt-xp-label">Фонд XP</span>
                    <IntInput
                      labelledBy="task-mgmt-xp-label"
                      value={draft.fundXp}
                      disabled={pending || uncertain}
                      max={TASK_XP_MAX}
                      onValue={(n) => setField("fundXp", n)}
                    />
                  </label>
                  <label>
                    <span id="task-mgmt-points-label">Фонд баллов</span>
                    <IntInput
                      labelledBy="task-mgmt-points-label"
                      value={draft.fundPoints}
                      disabled={pending || uncertain}
                      max={TASK_POINTS_MAX}
                      onValue={(n) => setField("fundPoints", n)}
                    />
                  </label>
                </div>
                <PointsScaleHint />
                <XpLimitHint />
              </div>
              {currentScope ? (
                <label className="task-mgmt__wide">
                  <span id="task-mgmt-who-label">Кто выполняет</span>
                  <Select
                    labelledBy="task-mgmt-who-label"
                    value={draft.openForClaim ? "open" : newAssignee}
                    disabled={pending || uncertain}
                    onValueChange={(value) => {
                      setField("openForClaim", value === "open");
                      setNewAssignee(value === "open" ? "" : value);
                    }}
                    options={[
                      { value: "", label: "Назначу позже (черновик)" },
                      {
                        value: "open",
                        label: "Любой участник: свободная задача",
                      },
                      ...(currentScope.canAssign
                        ? currentScope.assignees.map((person) => ({
                            value: person.id,
                            label: person.displayName,
                          }))
                        : []),
                    ]}
                  />
                </label>
              ) : null}
              <button
                className="task-mgmt__button task-mgmt__button--primary"
                type="submit"
                disabled={
                  pending || uncertain || !options.data?.ruleSets.length
                }
              >
                {pending && pendingAction === "create"
                  ? "Создаём…"
                  : pending && pendingAction === "assign"
                    ? "Назначаем…"
                    : newAssignee && !draft.openForClaim
                      ? "Создать и назначить"
                      : "Создать задачу"}
              </button>
              {hasDraft && (
                <button
                  className="task-mgmt__button task-mgmt__clear"
                  type="button"
                  disabled={pending || uncertain}
                  onClick={() => {
                    if (!confirmLeave()) return;
                    setDraft(emptyDraft());
                    setNewAssignee("");
                    setError(null);
                  }}
                >
                  Очистить поля
                </button>
              )}
            </form>
          )}

          <section
            className="task-mgmt__list-section"
            aria-labelledby="task-mgmt-list-title"
          >
            <div className="task-mgmt__section-heading">
              <h3 id="task-mgmt-list-title">Все задачи</h3>
              {items.length > 0 ? (
                <button
                  type="button"
                  className="task-mgmt__button"
                  disabled={list.isFetching}
                  onClick={() => void list.refetch()}
                >
                  Обновить
                </button>
              ) : null}
            </div>
            {list.isPending ? (
              <p className="task-mgmt__state" role="status">
                Загружаем задачи…
              </p>
            ) : listError ? (
              <div className="task-mgmt__state" role="alert">
                <p>{requestMessage(list.error)}</p>
                <button
                  type="button"
                  className="task-mgmt__button"
                  onClick={() => void list.refetch()}
                >
                  Повторить загрузку
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="tasks-empty">Доступных задач пока нет.</p>
            ) : (
              <>
                <ul className="task-mgmt__items">
                  {items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      scope={availableScopes.find(
                        (scope) => scope.id === task.scope.id,
                      )}
                      selectedAssignee={assignees[task.id] ?? ""}
                      onSelect={(value) =>
                        setAssignees((current) => ({
                          ...current,
                          [task.id]: value,
                        }))
                      }
                      disabled={pending || uncertain}
                      onAssign={() => void send("assign", task)}
                      onChange={(action) => {
                        if (change && !confirmLeave()) return;
                        setError(null);
                        setSuccess(null);
                        setChange({
                          action,
                          task,
                          fields: {
                            title: task.title,
                            criteria: task.criteria,
                            categoryCode: task.categoryCode,
                            priority: task.priority,
                            dueAt: task.dueAt,
                            fundXp: task.fundXp,
                            fundPoints: task.fundPoints,
                            expectedVersion: task.version,
                            reason: "",
                          },
                        });
                      }}
                      changeForm={
                        change?.task.id === task.id ? (
                          <TaskChangeForm
                            change={change}
                            currentTask={task}
                            disabled={pending || uncertain}
                            pending={pending}
                            onFields={(fields) =>
                              setChange({ ...change, fields })
                            }
                            onRefreshVersion={() =>
                              setChange({
                                ...change,
                                task,
                                fields: {
                                  ...change.fields,
                                  expectedVersion: task.version,
                                },
                              })
                            }
                            onClose={() => {
                              if (confirmLeave()) setChange(null);
                            }}
                            onSubmit={() => void send(change.action)}
                          />
                        ) : null
                      }
                    />
                  ))}
                </ul>
                {list.isError && (
                  <p
                    className="task-mgmt__feedback task-mgmt__feedback--error"
                    role="alert"
                  >
                    Не удалось обновить список. Показаны последние загруженные
                    данные.
                  </p>
                )}
                {list.hasNextPage && (
                  <button
                    type="button"
                    className="task-mgmt__button task-mgmt__more"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
                  </button>
                )}
                {list.isFetchNextPageError && (
                  <p
                    className="task-mgmt__feedback task-mgmt__feedback--error"
                    role="alert"
                  >
                    {requestMessage(list.error)}
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}

      {uncertain && (
        <div className="task-mgmt__retry">
          <p role="status">
            Запрос ожидает подтверждения. Повтор отправит те же данные с тем же
            ключом.
          </p>
          <button
            type="button"
            className="task-mgmt__button task-mgmt__button--primary"
            disabled={pending}
            onClick={retryAttempt}
          >
            {pending ? "Проверяем…" : "Повторить тот же запрос"}
          </button>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  scope,
  selectedAssignee,
  onSelect,
  disabled,
  onAssign,
  onChange,
  changeForm,
}: {
  task: ManagementTask;
  scope: ScopeOption | undefined;
  selectedAssignee: string;
  onSelect(value: string): void;
  disabled: boolean;
  onAssign(): void;
  onChange(action: "edit" | "cancel"): void;
  changeForm: React.ReactNode;
}) {
  const manyScopes = useManyScopes();
  const canAssign = task.status === "draft" && Boolean(scope?.canAssign);
  const { historyScopeIds } = useAuthorizedSession();
  return (
    <li className="task-mgmt__item">
      <div className="task-mgmt__item-main">
        <div className="task-mgmt__item-title">
          <h4>{task.title}</h4>
          <span className="task-mgmt__status">
            {task.status === "draft" && task.openForClaim
              ? "Свободная"
              : statusNames[task.status]}
          </span>
        </div>
        <p className="task-mgmt__item-meta">
          {task.priority !== "normal"
            ? `${priorityNames[task.priority]} · `
            : ""}
          {task.assignee ? `${task.assignee.displayName} · ` : ""}
          до {formatDate(task.dueAt)} · {formatFunds(task)}
        </p>
      </div>
      {canAssign && (
        <div className="task-mgmt__assign">
          {scope?.assignees.length ? (
            <>
              <label>
                <span id={`task-mgmt-assignee-label-${task.id}`}>
                  {manyScopes
                    ? `Участник области «${scope.name}»`
                    : "Кому назначить"}
                </span>
                <Select
                  labelledBy={`task-mgmt-assignee-label-${task.id}`}
                  value={selectedAssignee}
                  disabled={disabled}
                  onValueChange={onSelect}
                  options={[
                    { value: "", label: "Выберите исполнителя" },
                    ...scope.assignees.map((person) => ({
                      value: person.id,
                      label: person.displayName,
                    })),
                  ]}
                />
              </label>
              <button
                type="button"
                className="task-mgmt__button"
                disabled={disabled || !selectedAssignee}
                onClick={onAssign}
              >
                Назначить
              </button>
            </>
          ) : (
            <p className="task-mgmt__hint">
              Пока нет участников, которым можно назначить задачу.
            </p>
          )}
        </div>
      )}
      {/* Критерии, история и редкие действия свёрнуты: в списке видно
          главное — название, статус, исполнитель, срок и награда. */}
      <details className="task-mgmt__details">
        <summary>Подробнее</summary>
        {manyScopes || task.categoryCode !== NO_CATEGORY ? (
          <p className="task-mgmt__item-meta">
            {[
              manyScopes ? task.scope.name : null,
              task.categoryCode !== NO_CATEGORY
                ? `категория ${task.categoryCode}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <p className="task-mgmt__criteria">{task.criteria}</p>
        {historyScopeIds?.includes(task.scope.id) && (
          <>
            <TaskTimeline taskId={task.id} />
            <TaskHistory taskId={task.id} />
          </>
        )}
        {!changeForm && (
          <div className="task-mgmt__change-actions">
            {scope?.canEdit && task.manageable && task.status === "draft" && (
              <button
                type="button"
                className="task-mgmt__button"
                disabled={disabled}
                onClick={() => onChange("edit")}
              >
                Редактировать черновик
              </button>
            )}
            {scope?.canCancel &&
              task.manageable &&
              !["accepted", "cancelled"].includes(task.status) && (
                <button
                  type="button"
                  className="task-mgmt__button"
                  disabled={disabled}
                  onClick={() => onChange("cancel")}
                >
                  Отменить задачу
                </button>
              )}
          </div>
        )}
      </details>
      {changeForm}
    </li>
  );
}

function TaskChangeForm({
  change,
  currentTask,
  disabled,
  pending,
  onFields,
  onRefreshVersion,
  onClose,
  onSubmit,
}: {
  change: ChangeDraft;
  currentTask: ManagementTask;
  disabled: boolean;
  pending: boolean;
  onFields(fields: TaskEditRequest): void;
  onRefreshVersion(): void;
  onClose(): void;
  onSubmit(): void;
}) {
  const f = change.fields;
  const labelId = useId();
  const stale = currentTask.version !== f.expectedVersion;
  const closed =
    change.action === "edit"
      ? currentTask.status !== "draft"
      : ["accepted", "cancelled"].includes(currentTask.status);
  function field<K extends keyof TaskEditRequest>(
    name: K,
    value: TaskEditRequest[K],
  ) {
    onFields({ ...f, [name]: value });
  }
  return (
    <form
      className="task-mgmt__form"
      aria-busy={pending}
      aria-label={
        change.action === "edit" ? "Редактирование черновика" : "Отмена задачи"
      }
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>
        {change.action === "edit"
          ? "Редактирование черновика"
          : "Отмена задачи"}
      </h3>
      <p className="task-mgmt__note">
        {change.action === "edit"
          ? "После назначения условия заморожены."
          : "Отчёты и история сохранятся. Задача выйдет из очереди проверки. Начислений при отмене нет."}{" "}
        Версия {f.expectedVersion} ·{" "}
        {change.task.assignee?.displayName ?? "Исполнитель не назначен"} ·{" "}
        {formatFunds(change.task)}.
      </p>
      {closed ? (
        <p role="alert">
          Состояние задачи больше не допускает это действие. Закройте форму и
          проверьте список.
        </p>
      ) : (
        stale && (
          <div role="alert">
            <p>
              Задача изменилась. Поля сохранены. Сверьте актуальные данные в
              строке выше.
            </p>
            <button
              type="button"
              className="task-mgmt__button"
              disabled={disabled}
              onClick={onRefreshVersion}
            >
              Использовать версию {currentTask.version}
            </button>
          </div>
        )
      )}
      <fieldset
        disabled={disabled || closed}
        className="task-mgmt__change-fields"
      >
        {change.action === "edit" && (
          <div className="task-mgmt__fields">
            <label>
              <span id={`${labelId}-title`}>Название</span>
              <input
                aria-labelledby={`${labelId}-title`}
                value={f.title}
                maxLength={120}
                required
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label className="task-mgmt__wide">
              <span id={`${labelId}-criteria`}>Критерии результата</span>
              <textarea
                aria-labelledby={`${labelId}-criteria`}
                rows={4}
                value={f.criteria}
                maxLength={2000}
                required
                onChange={(e) => field("criteria", e.target.value)}
              />
            </label>
            <label>
              <span id={`${labelId}-category`}>Категория</span>
              <input
                aria-labelledby={`${labelId}-category`}
                value={f.categoryCode}
                maxLength={40}
                placeholder="Необязательно, например: уборка"
                onChange={(e) => field("categoryCode", e.target.value)}
              />
            </label>
            <label>
              <span id={`${labelId}-priority`}>Приоритет</span>
              <Select
                labelledBy={`${labelId}-priority`}
                value={f.priority}
                onValueChange={(next) =>
                  field("priority", next as TaskEditRequest["priority"])
                }
                options={priorityOptions}
              />
            </label>
            <label>
              <span id={`${labelId}-due`}>Срок (UTC)</span>
              <input
                aria-labelledby={`${labelId}-due`}
                type="datetime-local"
                value={f.dueAt.slice(0, 16)}
                required
                onChange={(e) =>
                  field(
                    "dueAt",
                    e.target.value
                      ? new Date(`${e.target.value}Z`).toISOString()
                      : "",
                  )
                }
              />
            </label>
            <label>
              <span id={`${labelId}-xp`}>Фонд XP</span>
              <IntInput
                labelledBy={`${labelId}-xp`}
                value={f.fundXp}
                max={TASK_XP_MAX}
                onValue={(n) => field("fundXp", n)}
              />
            </label>
            <label>
              <span id={`${labelId}-points`}>Фонд баллов</span>
              <IntInput
                labelledBy={`${labelId}-points`}
                value={f.fundPoints}
                max={TASK_POINTS_MAX}
                onValue={(n) => field("fundPoints", n)}
              />
            </label>
          </div>
        )}
        {change.action === "edit" ? (
          <>
            <PointsScaleHint />
            <XpLimitHint />
          </>
        ) : null}
        <div className="task-mgmt__fields">
          <label className="task-mgmt__wide">
            <span id={`${labelId}-reason`}>
              {change.action === "edit"
                ? "Причина изменения"
                : "Причина отмены"}
            </span>
            <textarea
              aria-labelledby={`${labelId}-reason`}
              rows={3}
              value={f.reason}
              maxLength={2000}
              required
              onChange={(e) => field("reason", e.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          className="task-mgmt__button task-mgmt__button--primary"
          disabled={stale}
        >
          {pending
            ? change.action === "edit"
              ? "Сохраняем…"
              : "Отменяем…"
            : change.action === "edit"
              ? "Сохранить изменения"
              : "Подтвердить отмену"}
        </button>
      </fieldset>
      <button
        type="button"
        className="task-mgmt__button"
        disabled={disabled}
        onClick={onClose}
      >
        Закрыть форму
      </button>
    </form>
  );
}
