"use client";
import {
  accessChangeResponseSchema,
  accessListResponseSchema,
  grantableActions,
  type AccessListResponse,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { Select } from "@/shared/ui/select";
import { actionLabels } from "./action-labels";
import { MemberAdmin } from "./member-admin";
import "../notifications/notification-status.css";
import "../catalog-admin/catalog-admin.css";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

// Набор «Командир»: всё для работы с задачами и заявками, без управления доступом.
const commanderActions = [
  "task.view",
  "task.create",
  "task.assign",
  "task.edit",
  "task.cancel",
  "task.review",
  "reward.decide",
  "reward.fulfill",
] as const;
const COMMANDER = "preset:commander";

type Binding = AccessListResponse["members"][number]["bindings"][number];

type Change =
  | {
      path: "grants";
      summary: string;
      // Права выдаются по одному запросу на право; каждый со своим ключом.
      actions: string[];
      body: {
        scope: string;
        subjectId: string;
        action: string;
        validUntil: string | null;
        reason: string;
      };
    }
  | {
      path: "revocations";
      summary: string;
      body: {
        scope: string;
        bindingId: string;
        expectedVersion: number;
        reason: string;
      };
    };

// Группы прав для выбора в форме выдачи: задачи, поощрения, каталог, остальное.
const rightGroup = (action: string) =>
  action.startsWith("task.")
    ? "Задачи"
    : action.startsWith("reward.")
      ? "Поощрения"
      : action.startsWith("admin.catalog")
        ? "Каталог"
        : "Прочее";
const rightGroupOrder = ["Задачи", "Поощрения", "Каталог", "Прочее"];
// Права идут подряд по группам, иначе заголовки групп в списке повторились бы.
const groupedRights = [...grantableActions].sort(
  (a, b) =>
    rightGroupOrder.indexOf(rightGroup(a)) -
    rightGroupOrder.indexOf(rightGroup(b)),
);

export function AccessAdmin() {
  const {
    accessScopes = [],
    csrfToken,
    loseAccess,
    reportDirty,
    confirmLeave,
  } = useAuthorizedSession();
  const client = useQueryClient();
  const id = useId();
  const [scope, setScope] = useState(accessScopes[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [action, setAction] = useState<string>(COMMANDER);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Change | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [memberDirty, setMemberDirty] = useState(false);
  // Отозванные права остаются на своих местах до смены области, только меняют вид.
  const [revokedRights, setRevokedRights] = useState<
    Record<string, { userId: string; binding: Binding }>
  >({});
  const intent = useRef<{
    keys: string[];
    done: number;
    change: Change;
  } | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  const query = useQuery({
    queryKey: ["admin-access", scope],
    enabled: Boolean(scope),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/v1/admin/access?${new URLSearchParams({ scope })}`,
        { signal, credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok)
        throw Object.assign(Error("load"), { status: response.status });
      return accessListResponseSchema.parse(await response.json());
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const status401 = (query.error as { status?: number } | null)?.status;
  useEffect(() => {
    if (status401 === 401 || status401 === 403) {
      client.setQueriesData<AccessListResponse | null>(
        { queryKey: ["admin-access"] },
        () => null,
      );
      loseAccess(status401);
    }
  }, [status401, client, loseAccess]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const dirty = Boolean(reason || until || preview || memberDirty);
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(false);
  }, [dirty, reportDirty]);
  const data = status401 ? null : query.data;
  const members = data?.members ?? [];
  const reset = () => {
    setPreview(null);
    setRevokeId(null);
    setReason("");
    setUntil("");
    setStatus("");
    setSubmitted(false);
    setBlocked(false);
    intent.current = null;
  };
  function stage(change: Change) {
    intent.current = null;
    setPreview(change);
    setBlocked(false);
    setSubmitted(false);
    setStatus("");
  }
  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= {
      keys: (preview.path === "grants" ? preview.actions : [""]).map(() =>
        crypto.randomUUID(),
      ),
      done: 0,
      change: preview,
    };
    const current = intent.current;
    const { change } = current;
    setSubmitted(true);
    running.current = true;
    setPending(true);
    setStatus("Сохраняем изменение…");
    try {
      const total = current.keys.length;
      while (current.done < total) {
        const body =
          change.path === "grants"
            ? { ...change.body, action: change.actions[current.done]! }
            : change.body;
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 15000);
        let response: Response;
        try {
          response = await fetch(`/api/v1/admin/access/${change.path}`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
              "Idempotency-Key": current.keys[current.done]!,
            },
            body: JSON.stringify(body),
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!alive.current) return;
        if ([401, 403].includes(response.status)) {
          loseAccess(response.status);
          return;
        }
        if (response.status === 404) {
          client.setQueriesData<AccessListResponse | null>(
            { queryKey: ["admin-access"] },
            () => null,
          );
          setBlocked(true);
          setStatus("Управление доступом недоступно.");
          return;
        }
        if (response.status === 429) {
          setStatus(mutationLimitMessage(response));
          return;
        }
        if ([400, 409, 413, 422].includes(response.status)) {
          setBlocked(true);
          setStatus(
            `${current.done ? `Выдано прав: ${current.done} из ${total}. ` : ""}Изменение отклонено: право уже изменилось, срок неверен или получатель недопустим. Закройте форму и обновите список.`,
          );
          void query.refetch();
          return;
        }
        if (!response.ok) throw Error("unconfirmed");
        const saved = accessChangeResponseSchema.parse(await response.json());
        if (!alive.current) return;
        if (
          saved.scope !== scope ||
          (change.path === "grants"
            ? saved.kind !== "grant" ||
              saved.binding.subjectId !== change.body.subjectId ||
              saved.binding.action !== change.actions[current.done]
            : saved.kind !== "revoke" ||
              saved.binding.id !== change.body.bindingId)
        )
          throw Error("unconfirmed");
        current.done += 1;
      }
      reportDirty(false);
      if (change.path === "revocations") {
        const owner = members.find((m) =>
          m.bindings.some((b) => b.id === change.body.bindingId),
        );
        const binding = owner?.bindings.find(
          (b) => b.id === change.body.bindingId,
        );
        if (owner && binding)
          setRevokedRights((prev) => ({
            ...prev,
            [binding.id]: { userId: owner.userId, binding },
          }));
      }
      reset();
      void query.refetch();
      setStatus(
        change.path === "revocations"
          ? "Право отозвано."
          : total > 1
            ? `Выдано прав: ${total}. Участнику нужно заново открыть приложение.`
            : "Право выдано.",
      );
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Основание сохранено. Повторите тот же запрос, чтобы получить подтверждение сервера.",
        );
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }
  const pendingForm = preview ? (
    <div className="catalog-publication tasks-filter">
      <h4>Проверьте изменение</h4>
      <p className="admin-catalog-conditions">{preview.summary}</p>
      <p className="admin-catalog-conditions">
        Основание: {preview.body.reason}
      </p>
      <p className="notification-note">
        Получатель выйдет из текущих сессий и войдёт заново. Журнал изменений
        неизменяем.
      </p>
      {!submitted ? (
        <button
          type="button"
          className="tasks-action"
          onClick={() => setPreview(null)}
        >
          Вернуться к форме
        </button>
      ) : null}
      <button
        type="button"
        className="tasks-action"
        disabled={pending || blocked}
        onClick={() => void send()}
      >
        {pending
          ? "Сохраняем…"
          : submitted
            ? "Повторить тот же запрос"
            : "Подтвердить изменение"}
      </button>
      {blocked ? (
        <button type="button" className="tasks-action" onClick={reset}>
          Закрыть форму
        </button>
      ) : null}
    </div>
  ) : null;
  const subject = members.find((m) => m.userId === subjectId);
  // Порядок тот же, что у сервера (по действию); отозванное остаётся на месте.
  const shownBindings = (m: (typeof members)[number]) =>
    [
      ...m.bindings.map((binding) => ({ binding, revoked: false })),
      ...Object.values(revokedRights)
        .filter(
          (r) =>
            r.userId === m.userId &&
            !m.bindings.some((b) => b.id === r.binding.id),
        )
        .map((r) => ({ binding: r.binding, revoked: true })),
    ].sort((x, y) =>
      x.binding.action < y.binding.action
        ? -1
        : x.binding.action > y.binding.action
          ? 1
          : 0,
    );
  return (
    <section
      className="tasks-section notification-section admin-catalog-section"
      aria-labelledby={`${id}-title`}
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <h2 id={`${id}-title`}>Управление доступом</h2>
        <button
          type="button"
          className="tasks-action"
          aria-label="Обновить список доступа"
          disabled={query.isFetching}
          onClick={() => {
            if (confirmLeave()) {
              reset();
              void query.refetch();
            }
          }}
        >
          Обновить
        </button>
      </div>
      <p className="notification-intro">
        Кто что может делать. Свои права изменить нельзя.
      </p>
      {accessScopes.length > 1 ? (
        <div className="tasks-filter notification-scope">
          <span id={`${id}-scope-label`}>Область</span>
          <Select
            labelledBy={`${id}-scope-label`}
            value={scope}
            onValueChange={(next) => {
              if (confirmLeave()) {
                reset();
                setSubjectId("");
                setRevokedRights({});
                setScope(next);
              }
            }}
            options={accessScopes.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      ) : null}
      {query.isPending && scope ? (
        <p className="tasks-state" role="status">
          Загружаем права…
        </p>
      ) : null}
      {query.isError && !status401 ? (
        <p className="tasks-state" role="alert">
          Список доступа недоступен. Обновите страницу.
        </p>
      ) : null}
      {data ? (
        <>
          <ul className="admin-catalog-items" aria-label="Участники">
            {members.map((m) => {
              const rows = shownBindings(m);
              const bindings = rows.length ? (
                <ul>
                  {rows.map(({ binding: b, revoked }) => (
                    <li
                      key={b.id}
                      className={
                        revoked
                          ? "access-binding access-binding--revoked"
                          : "access-binding"
                      }
                    >
                      <span>
                        {actionLabels[b.action]}
                        {b.validUntil
                          ? ` · до ${dateTime.format(new Date(b.validUntil))}`
                          : " · без срока"}
                        {revoked ? " · отозвано" : null}
                      </span>
                      {data.canManage && !m.isSelf && !revoked ? (
                        <button
                          type="button"
                          className="tasks-action"
                          aria-label={`Отозвать: ${actionLabels[b.action]}, ${m.displayName}`}
                          disabled={Boolean(preview)}
                          onClick={() => {
                            if (revokeId === b.id) setRevokeId(null);
                            else {
                              setRevokeId(b.id);
                              setReason("");
                            }
                          }}
                        >
                          {revokeId === b.id ? "Не отзывать" : "Отозвать"}
                        </button>
                      ) : null}
                      {revokeId === b.id && !preview && !revoked ? (
                        <form
                          className="catalog-publication tasks-filter"
                          onSubmit={(event) => {
                            event.preventDefault();
                            stage({
                              path: "revocations",
                              summary: `Отозвать «${actionLabels[b.action]}» у ${m.displayName}.`,
                              body: {
                                scope,
                                bindingId: b.id,
                                expectedVersion: b.version,
                                reason: reason.trim(),
                              },
                            });
                          }}
                        >
                          <div className="catalog-publication-field">
                            <label htmlFor={`${id}-rr-${b.id}`}>
                              Основание отзыва
                            </label>
                            <textarea
                              id={`${id}-rr-${b.id}`}
                              required
                              maxLength={500}
                              rows={2}
                              value={reason}
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                            />
                          </div>
                          <button
                            type="submit"
                            className="tasks-action"
                            disabled={!reason.trim()}
                          >
                            Проверить отзыв
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null;
              return (
                <li key={m.userId}>
                  <strong>
                    {m.displayName}
                    {m.isSelf ? " (вы)" : ""}
                  </strong>
                  {bindings ?? (
                    <p className="notification-note">Выданных прав нет.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
          {data.canManage && !revokeId ? (
            preview ? (
              pendingForm
            ) : (
              // Формы свёрнуты: сначала виден список людей и их прав.
              <details className="access-form">
                <summary>Выдать право</summary>
                <form
                  className="catalog-publication tasks-filter"
                  aria-labelledby={`${id}-grant`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const validUntil = until ? new Date(until) : null;
                    if (validUntil && !(validUntil.getTime() > Date.now())) {
                      setStatus("Срок права должен быть в будущем.");
                      return;
                    }
                    const held = new Set(
                      subject?.bindings.map((binding) => binding.action) ?? [],
                    );
                    const actions =
                      action === COMMANDER
                        ? commanderActions.filter((a) => !held.has(a))
                        : [action];
                    if (!actions.length) {
                      setStatus("У участника уже есть все права командира.");
                      return;
                    }
                    const term = validUntil
                      ? ` до ${dateTime.format(validUntil)}`
                      : " без срока";
                    stage({
                      path: "grants",
                      actions,
                      summary:
                        action === COMMANDER
                          ? `Сделать ${subject?.displayName ?? ""} командиром${term}: ${actions.map((a) => actionLabels[a as (typeof grantableActions)[number]].toLowerCase()).join(", ")}.`
                          : `Выдать «${actionLabels[action as (typeof grantableActions)[number]]}» участнику ${subject?.displayName ?? ""}${term}.`,
                      body: {
                        scope,
                        subjectId,
                        action,
                        validUntil: validUntil
                          ? validUntil.toISOString()
                          : null,
                        reason: reason.trim(),
                      },
                    });
                  }}
                >
                  <h4 id={`${id}-grant`} className="sr-only">
                    Выдать право
                  </h4>
                  <div className="catalog-publication-field">
                    <label id={`${id}-subject-label`}>Участник</label>
                    <Select
                      labelledBy={`${id}-subject-label`}
                      value={subjectId}
                      onValueChange={setSubjectId}
                      options={[
                        { value: "", label: "Выберите участника" },
                        ...members
                          .filter((m) => !m.isSelf)
                          .map((m) => ({
                            value: m.userId,
                            label: m.displayName,
                          })),
                      ]}
                    />
                  </div>
                  <div className="catalog-publication-field">
                    <label id={`${id}-action-label`}>Право</label>
                    <Select
                      labelledBy={`${id}-action-label`}
                      value={action}
                      onValueChange={setAction}
                      options={[
                        {
                          value: COMMANDER,
                          label: "Командир: задачи, проверка, заявки",
                        },
                        ...groupedRights.map((a) => ({
                          value: a,
                          label: actionLabels[a],
                          group: rightGroup(a),
                        })),
                      ]}
                    />
                  </div>
                  <div className="catalog-publication-field">
                    <label htmlFor={`${id}-until`}>
                      Действует до (необязательно)
                    </label>
                    <input
                      id={`${id}-until`}
                      type="datetime-local"
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                    />
                  </div>
                  <div className="catalog-publication-field">
                    <label htmlFor={`${id}-reason`}>Основание выдачи</label>
                    <textarea
                      id={`${id}-reason`}
                      required
                      maxLength={500}
                      rows={2}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="tasks-action"
                    disabled={!subjectId || !reason.trim()}
                  >
                    Проверить выдачу
                  </button>
                </form>
              </details>
            )
          ) : null}
          {revokeId && preview ? pendingForm : null}
          {!data.canManage ? (
            <p className="notification-note">
              Изменение прав выключено или не назначено вам. Доступен просмотр.
            </p>
          ) : null}
          {data.canManageMembers ? (
            <details className="access-form">
              <summary>Допуск участников</summary>
              <MemberAdmin
                key={scope}
                scope={scope}
                data={data}
                onDirty={setMemberDirty}
                onChanged={() => void query.refetch()}
                onUnavailable={() => {
                  client.setQueriesData<AccessListResponse | null>(
                    { queryKey: ["admin-access"] },
                    () => null,
                  );
                  setBlocked(true);
                  setStatus("Управление составом недоступно.");
                }}
              />
            </details>
          ) : null}
        </>
      ) : null}
      {status && !data ? (
        <p role={blocked ? "alert" : "status"}>{status}</p>
      ) : null}
    </section>
  );
}
