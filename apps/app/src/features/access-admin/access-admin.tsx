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
import { actionLabels } from "./action-labels";
import { MemberAdmin } from "./member-admin";
import "../notifications/notification-status.css";
import "../catalog-admin/catalog-admin.css";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

type Change =
  | {
      path: "grants";
      summary: string;
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
  const [action, setAction] = useState<string>(grantableActions[0]);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Change | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [memberDirty, setMemberDirty] = useState(false);
  const intent = useRef<{ key: string; change: Change } | null>(null);
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
    setStatus("");
  }
  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= { key: crypto.randomUUID(), change: preview };
    const { key, change } = intent.current;
    setSubmitted(true);
    running.current = true;
    setPending(true);
    setStatus("Сохраняем изменение…");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`/api/v1/admin/access/${change.path}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(change.body),
      });
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
        setStatus("Управление доступом в этой области недоступно.");
        return;
      }
      if (response.status === 429) {
        setStatus(mutationLimitMessage(response));
        return;
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        setBlocked(true);
        setStatus(
          "Изменение отклонено: право уже изменилось, срок неверен или получатель недопустим. Закройте форму и обновите список.",
        );
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
            saved.binding.action !== change.body.action
          : saved.kind !== "revoke" ||
            saved.binding.id !== change.body.bindingId)
      )
        throw Error("unconfirmed");
      reportDirty(false);
      reset();
      void query.refetch();
      setStatus(change.path === "grants" ? "Право выдано." : "Право отозвано.");
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Основание сохранено. Повторите тот же запрос, чтобы получить подтверждение сервера.",
        );
    } finally {
      clearTimeout(timeout);
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
    </div>
  ) : null;
  const subject = members.find((m) => m.userId === subjectId);
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
        Синтетические права участников области. Права управления доступом здесь
        не выдаются. Свои права изменить нельзя.
      </p>
      {accessScopes.length > 1 ? (
        <label className="tasks-filter notification-scope">
          <span>Область</span>
          <select
            value={scope}
            onChange={(event) => {
              if (confirmLeave()) {
                reset();
                setSubjectId("");
                setScope(event.target.value);
              }
            }}
          >
            {accessScopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
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
          <ul className="admin-catalog-items" aria-label="Участники области">
            {members.map((m) => (
              <li key={m.userId}>
                <strong>
                  {m.displayName}
                  {m.isSelf ? " (вы)" : ""}
                </strong>
                {m.bindings.length ? (
                  <ul>
                    {m.bindings.map((b) => (
                      <li key={b.id}>
                        {actionLabels[b.action]}
                        {b.validUntil
                          ? ` · до ${dateTime.format(new Date(b.validUntil))} МСК`
                          : " · без срока"}
                        {data.canManage && !m.isSelf ? (
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
                        {revokeId === b.id && !preview ? (
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
                ) : (
                  <p className="notification-note">Выданных прав нет.</p>
                )}
              </li>
            ))}
          </ul>
          {data.canManage && !revokeId ? (
            preview ? (
              pendingForm
            ) : (
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
                  stage({
                    path: "grants",
                    summary: `Выдать «${actionLabels[action as (typeof grantableActions)[number]]}» участнику ${subject?.displayName ?? ""}${validUntil ? ` до ${dateTime.format(validUntil)} МСК` : " без срока"}.`,
                    body: {
                      scope,
                      subjectId,
                      action,
                      validUntil: validUntil ? validUntil.toISOString() : null,
                      reason: reason.trim(),
                    },
                  });
                }}
              >
                <h4 id={`${id}-grant`}>Выдать право</h4>
                <div className="catalog-publication-field">
                  <label htmlFor={`${id}-subject`}>Участник</label>
                  <select
                    id={`${id}-subject`}
                    required
                    value={subjectId}
                    onChange={(event) => setSubjectId(event.target.value)}
                  >
                    <option value="">Выберите участника</option>
                    {members
                      .filter((m) => !m.isSelf)
                      .map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="catalog-publication-field">
                  <label htmlFor={`${id}-action`}>Право</label>
                  <select
                    id={`${id}-action`}
                    value={action}
                    onChange={(event) => setAction(event.target.value)}
                  >
                    {grantableActions.map((a) => (
                      <option key={a} value={a}>
                        {actionLabels[a]}
                      </option>
                    ))}
                  </select>
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
            )
          ) : null}
          {revokeId && preview ? pendingForm : null}
          {!data.canManage ? (
            <p className="notification-note">
              Изменение прав выключено или не назначено вам. Доступен просмотр.
            </p>
          ) : null}
          {data.canManageMembers ? (
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
                setStatus("Управление составом в этой области недоступно.");
              }}
            />
          ) : null}
        </>
      ) : null}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
    </section>
  );
}
