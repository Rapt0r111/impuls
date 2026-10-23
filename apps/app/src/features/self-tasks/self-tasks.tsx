"use client";

import {
  selfTaskListResponseSchema,
  selfTaskOptionsResponseSchema,
  selfTaskResponseSchema,
  TASK_POINTS_MAX,
  type SelfTask,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { PointsScaleHint } from "@/shared/ui/points-scale-hint";
import "./self-tasks.css";

const SELF_KEY = ["self-tasks"];

type View = "mine" | "verify" | "commander";

const statusNames: Record<SelfTask["status"], string> = {
  awaiting_verification: "Ждёт проверяющего",
  awaiting_commander: "Ждёт командира",
  in_review: "На приёмке",
  needs_work: "На доработке",
  accepted: "Принято",
  cancelled: "Отклонено",
};

function useSelfList(view: View) {
  return useQuery({
    queryKey: [...SELF_KEY, view],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/v1/self-tasks?view=${view}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`Self tasks: ${response.status}`);
      return selfTaskListResponseSchema.parse(await response.json()).items;
    },
    retry: false,
  });
}

// Tasks waiting for this person's verdict; the Проверка tab shows when there are any.
export function useWaitingForVerifier() {
  return useSelfList("verify");
}

function useSelfOptions() {
  return useQuery({
    queryKey: [...SELF_KEY, "options"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/self-tasks?view=options", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok)
        throw new Error(`Self task options: ${response.status}`);
      return selfTaskOptionsResponseSchema.parse(await response.json());
    },
    retry: false,
  });
}

type Outcome =
  { ok: true } | { ok: false; message: string } | { ok: "unconfirmed" };

// One POST. 401/403 hand over to the session handler; other failures carry the server's message.
async function post(
  path: string,
  body: unknown,
  csrfToken: string,
  key: string,
  onAccess: (status: number) => void,
): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/self-tasks${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: "unconfirmed" };
  }
  if (response.status === 401 || response.status === 403) {
    onAccess(response.status);
    return { ok: false, message: "Доступ к приложению отозван" };
  }
  if (response.status === 429) {
    return { ok: false, message: mutationLimitMessage(response) };
  }
  if (response.ok) {
    selfTaskResponseSchema.parse(await response.json());
    return { ok: true };
  }
  const error = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return {
    ok: false,
    message:
      error?.message ??
      "Не удалось сохранить. Обновите список и попробуйте снова.",
  };
}

const dateText = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(value),
  );

function Requested({ task }: { task: SelfTask }) {
  return (
    <p className="self-task-meta">
      <span className="task-chip task-chip--points">
        просит {task.requestedPoints} баллов
      </span>
      {task.requestedXp !== null ? (
        <span className="task-chip task-chip--xp">
          просит {task.requestedXp} XP
        </span>
      ) : null}
    </p>
  );
}

// The member reports a finished task, asks for points (and optionally XP), and picks verifiers.
function ReportForm() {
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const options = useSelfOptions();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [points, setPoints] = useState("");
  const [xp, setXp] = useState("");
  const [verifier, setVerifier] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Same key for a retry of the same report after a lost response; a new key otherwise.
  const key = useRef<string | null>(null);

  if (options.isPending) return <p className="tasks-state">Загружаем…</p>;
  if (options.isError || !options.data?.scopeId) {
    return (
      <p className="tasks-empty">
        Отчёты недоступны: вы пока не в области задач.
      </p>
    );
  }
  const candidates = options.data.verifiers;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !options.data?.scopeId) return;
    const requestedPoints = Number(points);
    const requestedXp = xp.trim() === "" ? null : Number(xp);
    if (
      !Number.isInteger(requestedPoints) ||
      requestedPoints < 0 ||
      requestedPoints > TASK_POINTS_MAX
    ) {
      setMessage(`Укажите баллы целым числом от 0 до ${TASK_POINTS_MAX}.`);
      return;
    }
    if (
      requestedXp !== null &&
      (!Number.isInteger(requestedXp) || requestedXp < 0)
    ) {
      setMessage("XP — целое число от 0, или оставьте поле пустым.");
      return;
    }
    setPending(true);
    setMessage(null);
    const idem = key.current ?? crypto.randomUUID();
    key.current = idem;
    const outcome = await post(
      "",
      {
        scopeId: options.data.scopeId,
        title,
        text,
        requestedPoints,
        requestedXp,
        verifierIds: [verifier],
      },
      csrfToken,
      idem,
      loseAccess,
    );
    setPending(false);
    if (outcome.ok === "unconfirmed") {
      setMessage(
        "Ответ не получен. Нажмите «Отправить» ещё раз: повтор не создаст второй отчёт.",
      );
      return;
    }
    key.current = null;
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    setTitle("");
    setText("");
    setPoints("");
    setXp("");
    setVerifier("");
    setMessage("Отчёт отправлен проверяющему.");
    await client.invalidateQueries({ queryKey: SELF_KEY });
  }

  return (
    <form className="self-form" onSubmit={(event) => void submit(event)}>
      <h3>Отчёт о сделанной задаче</h3>
      <label className="self-field">
        <span>Название</span>
        <input
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="self-field">
        <span>Что сделано и результат</span>
        <textarea
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          required
        />
      </label>
      <div className="self-row">
        <label className="self-field">
          <span>Баллы, которые просите</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={TASK_POINTS_MAX}
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            required
          />
        </label>
        <label className="self-field">
          <span>XP (необязательно)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            value={xp}
            onChange={(event) => setXp(event.target.value)}
          />
        </label>
      </div>
      <PointsScaleHint />
      <fieldset className="self-field">
        <legend>Ответственный проверяющий</legend>
        {candidates.length ? (
          candidates.map((person) => (
            <label key={person.id} className="self-check">
              <input
                type="radio"
                name="self-verifier"
                checked={verifier === person.id}
                onChange={() => setVerifier(person.id)}
              />
              {person.displayName}
            </label>
          ))
        ) : (
          <p className="self-hint">
            В области пока нет проверяющих. Попросите командира выдать право
            проверки.
          </p>
        )}
      </fieldset>
      {message ? (
        <p role="status" className="self-message">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        className="tasks-action"
        disabled={pending || verifier === ""}
      >
        {pending ? "Отправляем…" : "Отправить проверяющему"}
      </button>
    </form>
  );
}

// A failed list must say so; hiding it looks the same as having no tasks.
function ListError({ title }: { title: string }) {
  return (
    <section className="self-section" aria-label={title}>
      <h3>{title}</h3>
      <p role="alert" className="self-message">
        Не удалось загрузить список. Обновите страницу.
      </p>
    </section>
  );
}

// A failed refresh keeps the rows already on screen; the alert says they may be stale.
function StaleAlert() {
  return (
    <p role="alert" className="self-message">
      Не удалось обновить список. Показан последний загруженный.
    </p>
  );
}

const onReview = (status: SelfTask["status"]) =>
  status === "awaiting_verification" || status === "awaiting_commander";

function MyReports({
  title = "Мои отчёты",
  pendingOnly = false,
}: {
  title?: string;
  pendingOnly?: boolean;
}) {
  const mine = useSelfList("mine");
  if (mine.isPending) return null;
  if (mine.isError && !mine.data) return <ListError title={title} />;
  const rows = (mine.data ?? []).filter(
    (task) => !pendingOnly || onReview(task.status),
  );
  if (!rows.length && !mine.isError) return null;
  return (
    <section className="self-section" aria-label={title}>
      <h3>{title}</h3>
      {mine.isError ? <StaleAlert /> : null}
      <ul className="self-list">
        {rows.map((task) => (
          <li key={task.id} className="self-card">
            <div className="self-card-head">
              <strong>{task.title}</strong>
              <span className="self-status">{statusNames[task.status]}</span>
            </div>
            <Requested task={task} />
            <p className="self-hint">Обновлено {dateText(task.updatedAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Verifier queue: the reports waiting for this person's approval or decline.
function VerifyQueue() {
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const waiting = useSelfList("verify");
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [xps, setXps] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const key = useRef(new Map<string, string>());

  if (waiting.isPending) return <p className="tasks-state">Загружаем…</p>;
  if (waiting.isError && !waiting.data)
    return <ListError title="Ждут вашей проверки" />;
  if (!waiting.data?.length && !waiting.isError)
    return (
      <p className="tasks-empty">Пока нет задач, которые ждут вашей оценки.</p>
    );
  const rows = waiting.data ?? [];

  async function act(task: SelfTask, decision: "approve" | "decline") {
    if (pendingId) return;
    const raw = scores[task.id] ?? "";
    const score = Number(raw);
    if (
      decision === "approve" &&
      (raw.trim() === "" ||
        !Number.isInteger(score) ||
        score < 0 ||
        score > TASK_POINTS_MAX)
    ) {
      setMessage(`Укажите баллы целым числом от 0 до ${TASK_POINTS_MAX}.`);
      return;
    }
    const rawXp = xps[task.id] ?? String(task.requestedXp ?? 0);
    const fundXp = Number(rawXp);
    if (
      decision === "approve" &&
      (rawXp.trim() === "" || !Number.isInteger(fundXp) || fundXp < 0)
    ) {
      setMessage("XP — целое число от 0.");
      return;
    }
    const intent = `${task.id}:${task.version}:${decision}`;
    const idem = key.current.get(intent) ?? crypto.randomUUID();
    key.current.set(intent, idem);
    setPendingId(task.id);
    setMessage(null);
    const body =
      decision === "approve"
        ? {
            decision,
            expectedVersion: task.version,
            fundPoints: score,
            fundXp,
          }
        : { decision, expectedVersion: task.version, reason };
    const outcome = await post(
      `/${task.id}/verify`,
      body,
      csrfToken,
      idem,
      loseAccess,
    );
    setPendingId(null);
    if (outcome.ok === "unconfirmed") {
      setMessage(
        "Ответ не получен. Нажмите кнопку ещё раз: повтор не создаст второе решение.",
      );
      return;
    }
    key.current.delete(intent);
    if (!outcome.ok) {
      setMessage(outcome.message);
      await client.invalidateQueries({ queryKey: SELF_KEY });
      return;
    }
    setOpen(null);
    setReason("");
    await client.invalidateQueries({ queryKey: SELF_KEY });
  }

  return (
    <section className="self-section" aria-label="Ждут вашей проверки">
      <h3>Ждут вашей проверки</h3>
      {waiting.isError ? <StaleAlert /> : null}
      {message ? (
        <p role="alert" className="self-message">
          {message}
        </p>
      ) : null}
      <ul className="self-list">
        {rows.map((task) => (
          <li key={task.id} className="self-card">
            <div className="self-card-head">
              <strong>{task.title}</strong>
              <span className="self-status">{task.author.displayName}</span>
            </div>
            <p className="self-text">{task.text}</p>
            <Requested task={task} />
            <label className="self-field">
              <span>Баллы за задачу</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={TASK_POINTS_MAX}
                value={scores[task.id] ?? ""}
                onChange={(event) =>
                  setScores((all) => ({
                    ...all,
                    [task.id]: event.target.value,
                  }))
                }
              />
            </label>
            <PointsScaleHint />
            <label className="self-field">
              <span>XP (командир утвердит)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100000}
                value={xps[task.id] ?? String(task.requestedXp ?? 0)}
                onChange={(event) =>
                  setXps((all) => ({ ...all, [task.id]: event.target.value }))
                }
              />
            </label>
            <div className="self-actions">
              <button
                type="button"
                className="tasks-action"
                disabled={pendingId !== null}
                onClick={() => void act(task, "approve")}
              >
                Передать командиру
              </button>
              <button
                type="button"
                className="tasks-action"
                disabled={pendingId !== null}
                onClick={() => setOpen(open === task.id ? null : task.id)}
              >
                Отклонить
              </button>
            </div>
            {open === task.id ? (
              <div className="self-decline">
                <label className="self-field">
                  <span>Причина (участник увидит её в истории)</span>
                  <textarea
                    value={reason}
                    maxLength={2000}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="tasks-action"
                  disabled={pendingId !== null || reason.trim() === ""}
                  onClick={() => void act(task, "decline")}
                >
                  Отклонить отчёт
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Commander queue: the verifier's score is shown, not edited. The commander sets XP, then
// forwards the report to acceptance, or declines it.
function DecisionQueue() {
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const waiting = useSelfList("commander");
  const [xps, setXps] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const key = useRef(new Map<string, string>());

  if (waiting.isError && !waiting.data)
    return <ListError title="Ждут решения командира" />;
  if (!waiting.data?.length && !waiting.isError) return null;
  const rows = waiting.data ?? [];

  async function act(task: SelfTask, decision: "forward" | "decline") {
    if (pendingId) return;
    const fundXp = Number(
      xps[task.id] ?? task.verifiedXp ?? task.requestedXp ?? 0,
    );
    const intent = `${task.id}:${task.version}:${decision}`;
    const idem = key.current.get(intent) ?? crypto.randomUUID();
    key.current.set(intent, idem);
    if (decision === "forward" && (!Number.isInteger(fundXp) || fundXp < 0)) {
      setMessage("XP — целое число от 0.");
      return;
    }
    const body =
      decision === "forward"
        ? { decision, expectedVersion: task.version, fundXp }
        : {
            decision,
            expectedVersion: task.version,
            reason: reason[task.id] ?? "",
          };
    setPendingId(task.id);
    setMessage(null);
    const outcome = await post(
      `/${task.id}/decide`,
      body,
      csrfToken,
      idem,
      loseAccess,
    );
    setPendingId(null);
    if (outcome.ok === "unconfirmed") {
      setMessage(
        "Ответ не получен. Нажмите кнопку ещё раз: повтор не создаст второе решение.",
      );
      return;
    }
    key.current.delete(intent);
    if (!outcome.ok) setMessage(outcome.message);
    await client.invalidateQueries({ queryKey: SELF_KEY });
    await client.invalidateQueries({ queryKey: ["review-queue"] });
  }

  return (
    <section className="self-section" aria-label="Ждут решения командира">
      <h3>Ждут решения командира</h3>
      {waiting.isError ? <StaleAlert /> : null}
      {message ? (
        <p role="alert" className="self-message">
          {message}
        </p>
      ) : null}
      <ul className="self-list">
        {rows.map((task) => (
          <li key={task.id} className="self-card">
            <div className="self-card-head">
              <strong>{task.title}</strong>
              <span className="self-status">{task.author.displayName}</span>
            </div>
            <p className="self-text">{task.text}</p>
            <Requested task={task} />
            <p className="self-task-meta">
              <span className="task-chip task-chip--points">
                проверяющий оценил: {task.verifiedPoints ?? "не указано"} баллов
              </span>
            </p>
            <div className="self-row">
              <label className="self-field">
                <span>Начислить XP</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100000}
                  value={
                    xps[task.id] ??
                    String(task.verifiedXp ?? task.requestedXp ?? 0)
                  }
                  onChange={(event) =>
                    setXps((all) => ({ ...all, [task.id]: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="self-actions">
              <button
                type="button"
                className="tasks-action"
                disabled={pendingId !== null}
                onClick={() => void act(task, "forward")}
              >
                Утвердить и передать на приёмку
              </button>
            </div>
            <div className="self-decline">
              <label className="self-field">
                <span>Причина отказа</span>
                <textarea
                  value={reason[task.id] ?? ""}
                  maxLength={2000}
                  onChange={(event) =>
                    setReason((all) => ({
                      ...all,
                      [task.id]: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                type="button"
                className="tasks-action"
                disabled={pendingId !== null || !(reason[task.id] ?? "").trim()}
                onClick={() => void act(task, "decline")}
              >
                Отклонить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// «Свои задачи»: отчёт о сделанной задаче и очередь командира. Очередь проверяющего
// вынесена в отдельный раздел (VerifierQueuePanel). Пустая очередь командира скрыта.
export function SelfTasksPanel() {
  return (
    <div className="self-panel">
      <p className="self-hint">
        Расскажите о задаче, которую уже выполнили. Ответственный проверяющий
        оценит её баллами от 0 до 100 и передаст командиру. Командир утверждает
        итог, назначает XP или отклоняет отчёт.
      </p>
      <ReportForm />
      <MyReports />
      <DecisionQueue />
    </div>
  );
}

// Вкладка «Проверка»: задачи, которые проверяет этот человек, и его собственные отчёты,
// которые сейчас на проверке у проверяющего или командира.
export function ReviewTabSelfTasks() {
  return (
    <div className="self-panel">
      <VerifyQueue />
      <MyReports title="Мои задачи на проверке" pendingOnly />
    </div>
  );
}
