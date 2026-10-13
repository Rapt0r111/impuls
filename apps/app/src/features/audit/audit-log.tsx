"use client";

import {
  apiErrorSchema,
  auditResponseSchema,
  type AuditResponse,
} from "@impuls/contracts";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import "./audit-log.css";
import { actionLabels } from "@/features/access-admin/action-labels";
import { CatalogTerms } from "../catalog-admin/catalog-terms";

type Action = AuditResponse["items"][number]["action"];
const actionNames: Record<Action, string> = {
  "task.create": "Создание задачи",
  "task.assign": "Назначение задачи",
  "task.edit": "Изменение черновика",
  "task.cancel": "Отмена задачи",
  "task.return": "Возврат отчёта",
  "task.accept": "Приёмка результата",
  "ledger.correct": "Корректировка начисления",
  "reward.reserve": "Резерв по заявке",
  "reward.cancel": "Отмена заявки",
  "reward.approve": "Одобрение заявки",
  "reward.reject": "Отказ по заявке",
  "reward.fulfill": "Выдача поощрений",
  "reward.expire": "Истечение резерва",
  "catalog.create": "Создание позиции каталога",
  "catalog.publish": "Публикация условий каталога",
  "catalog.cancel": "Отмена будущих условий каталога",
  "quota.publish": "Публикация периода квоты",
  "access.grant": "Выдача права",
  "access.revoke": "Отзыв права",
  "member.admit": "Допуск участника",
  "member.remove": "Отзыв допуска участника",
};
const fieldNames: Record<
  AuditResponse["items"][number]["values"][number]["field"],
  string
> = {
  from: "Прежний статус",
  to: "Новый статус",
  status: "Статус",
  version: "Версия задачи",
  title: "Сохранённое название",
  criteria: "Критерии",
  categoryCode: "Категория",
  priority: "Приоритет",
  dueAt: "Срок (UTC)",
  fundXp: "Фонд XP",
  fundPoints: "Фонд баллов",
  assigneeId: "ID исполнителя",
  ruleSetId: "ID правил",
  ruleVersion: "Версия правил",
  xp: "Начислено XP",
  points: "Начислено баллов",
  xpDelta: "Изменение XP",
  pointsDelta: "Изменение баллов",
  seasonKey: "Исходный месяц",
  balanceVersion: "Версия баланса",
  price: "Цена в событии",
  rewardVersion: "Версия позиции в событии",
  quotaPeriodId: "ID периода квоты",
  availableDelta: "Изменение доступных баллов",
  reservedDelta: "Изменение резерва баллов",
  entitlementId: "ID владения",
};
const statuses: Record<string, string> = {
  draft: "Черновик",
  assigned: "Назначена",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_work: "На доработке",
  accepted: "Принята",
  cancelled: "Отменена",
  pending: "Ожидает решения",
  approved: "Одобрена",
  rejected: "Отказано",
  fulfilled: "Выдана",
  expired: "Срок резерва истёк",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критический",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
class AuditError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Audit request failed");
  }
}
async function load(
  scope: string,
  action: Action | "all",
  cursor: string | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "20" });
  if (scope) params.set("scope", scope);
  if (action !== "all") params.set("action", action);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/admin/audit?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json());
    throw new AuditError(
      response.status,
      parsed.success ? parsed.data.code : "UNAVAILABLE",
    );
  }
  return auditResponseSchema.parse(await response.json());
}

export function AuditLog() {
  const { loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const [scope, setScope] = useState("");
  const [action, setAction] = useState<Action | "all">("all");
  const queryKey = ["admin-audit", scope, action] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => load(scope, action, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    networkMode: "always",
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const error = query.error;
  const accessError =
    error instanceof AuditError && [401, 403].includes(error.status);
  const hidden = error instanceof AuditError && error.status === 404;
  useEffect(() => {
    if (accessError && error instanceof AuditError) loseAccess(error.status);
  }, [accessError, error, loseAccess]);
  const first = !accessError && !hidden ? query.data?.pages[0] : undefined;
  const items = first ? query.data!.pages.flatMap((page) => page.items) : [];
  const message = accessError
    ? "Доступ изменился. Повторите вход через Telegram."
    : hidden
      ? error.code === "AUDIT_DISABLED"
        ? "Синтетический журнал выключен."
        : "Журнал недоступен."
      : error instanceof AuditError && error.code === "INVALID_CURSOR"
        ? "Страница недоступна. Обновите журнал с начала."
        : "Не удалось загрузить журнал. Проверьте соединение и повторите загрузку.";
  function refresh() {
    client.setQueryData<InfiniteData<AuditResponse, string | null>>(
      queryKey,
      (data) =>
        data
          ? {
              pages: data.pages.slice(0, 1),
              pageParams: data.pageParams.slice(0, 1),
            }
          : data,
    );
    void query.refetch();
  }
  return (
    <section
      className="tasks-section audit-section"
      aria-labelledby="audit-title"
    >
      <div className="tasks-heading">
        <div>
          <h2 id="audit-title">Журнал действий</h2>
        </div>
        <button
          type="button"
          className="tasks-action"
          aria-label="Обновить журнал"
          disabled={query.isFetching}
          onClick={refresh}
        >
          Обновить
        </button>
      </div>
      <p className="audit-intro">Действия по задачам, заявкам и поощрениям.</p>
      {first ? (
        <>
          <div className="audit-filters">
            {first.scopes.length > 1 ? (
              <label className="tasks-filter">
                <span id="audit-scope-label">Область</span>
                <select
                  aria-labelledby="audit-scope-label"
                  value={scope || first.scope.id}
                  onChange={(e) => setScope(e.target.value)}
                >
                  {first.scopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="tasks-filter">
              <span id="audit-action-label">Действие</span>
              <select
                aria-labelledby="audit-action-label"
                value={action}
                onChange={(e) => setAction(e.target.value as Action | "all")}
              >
                <option value="all">Все действия</option>
                {Object.entries(actionNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="audit-asof">Обновлено {date(first.updatedAt)} МСК.</p>
        </>
      ) : null}
      {query.isPending ? (
        <p className="tasks-state" role="status">
          Загружаем журнал…
        </p>
      ) : null}
      {query.isError ? (
        <div className="tasks-state" role="alert">
          <p>{message}</p>
          {items.length > 0 ? (
            <p>
              Показаны ранее подтверждённые записи. Время чтения указано выше.
            </p>
          ) : null}
          {!accessError && !hidden ? (
            <button
              type="button"
              className="tasks-action"
              disabled={query.isFetching}
              onClick={refresh}
            >
              Повторить загрузку
            </button>
          ) : null}
        </div>
      ) : null}
      {first && items.length === 0 && !query.isError ? (
        <p className="tasks-state">
          Записанных действий по выбранному фильтру нет.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ol className="audit-list">
          {items.map((item) => (
            <li key={item.id}>
              <h3>{actionNames[item.action]}</h3>
              <p className="audit-meta">
                {item.actor.displayName} ·{" "}
                <time dateTime={item.occurredAt}>
                  {date(item.occurredAt)} МСК
                </time>
              </p>
              {item.creation ? (
                <div>
                  <p>
                    Первоначальные выключенные условия, версия 1. Квота при
                    создании не задаётся.
                  </p>
                  <CatalogTerms
                    value={item.creation.initial}
                    history
                    label="Условия при создании"
                  />
                </div>
              ) : null}
              {item.catalog ? (
                <div className="audit-task">
                  <p>
                    Версия {item.catalog.previousVersion} →{" "}
                    {item.catalog.published.version}. Сохранённые условия на
                    момент публикации.
                  </p>
                  <CatalogTerms
                    value={item.catalog.published}
                    label="Опубликованные условия"
                  />
                </div>
              ) : null}
              {item.access ? (
                <div className="audit-task">
                  <p>
                    {item.action === "access.grant"
                      ? "Выдано право"
                      : "Отозвано право"}{" "}
                    «{actionLabels[item.access.permission]}» участнику{" "}
                    {item.access.subject.displayName}.
                  </p>
                  <p>
                    {item.access.validUntil
                      ? `Срок права: до ${date(item.access.validUntil)} МСК.`
                      : "Срок права: без ограничения."}
                  </p>
                </div>
              ) : null}
              {item.member ? (
                <div className="audit-task">
                  <p>
                    {item.action === "member.admit"
                      ? item.member.userCreated
                        ? "Допущен новый участник"
                        : item.member.userReactivated
                          ? "Допущен вновь участник"
                          : "Допущен участник"
                      : "Отозван допуск участника"}{" "}
                    {item.member.subject.displayName}.
                  </p>
                  <p>
                    {item.action === "member.admit"
                      ? item.member.validUntil
                        ? `Срок допуска: до ${date(item.member.validUntil)} МСК.`
                        : "Срок допуска: без ограничения."
                      : `Снято прав: ${item.member.revokedBindings}.${
                          item.member.userDeactivated
                            ? " Учётная запись отключена."
                            : ""
                        }`}
                  </p>
                </div>
              ) : null}
              {item.cancellation ? (
                <div className="audit-task">
                  <p>
                    Будущая версия {item.cancellation.cancelled.version}{" "}
                    отменена. Её условия не вступят в силу.
                  </p>
                  <CatalogTerms
                    value={item.cancellation.cancelled}
                    history
                    label="Отменённые условия"
                  />
                </div>
              ) : null}
              {item.quota ? (
                <div className="audit-task">
                  <p>
                    Опубликованный период: {date(item.quota.startsAt)} —{" "}
                    {date(item.quota.endsAt)} МСК.
                  </p>
                  <p>
                    Всего мест при публикации: {item.quota.capacity}. Это
                    сохранённые параметры, без текущих резервов и выдач.
                  </p>
                </div>
              ) : null}
              {item.task ? (
                <p className="audit-task">
                  Задача сейчас: {item.task.currentTitle}
                </p>
              ) : null}
              {item.reward ? (
                <>
                  <p className="audit-task">
                    Позиция при подаче: {item.reward.title}
                  </p>
                  <p className="audit-meta">
                    Получатель сейчас: {item.reward.recipient.displayName}
                  </p>
                </>
              ) : null}
              <p className="audit-reason">
                <strong>Основание:</strong> {item.reason}
              </p>
              <details className="audit-evidence">
                <summary>Сохранённые значения и идентификаторы</summary>
                {item.reward ? (
                  <dl aria-label="Условия при подаче заявки">
                    <div>
                      <dt>Условия при подаче</dt>
                      <dd>{item.reward.conditions}</dd>
                    </div>
                    <div>
                      <dt>Цена при подаче</dt>
                      <dd>
                        {item.reward.price.toLocaleString("ru-RU")} баллов
                      </dd>
                    </div>
                    <div>
                      <dt>Версия позиции при подаче</dt>
                      <dd>{item.reward.rewardVersion}</dd>
                    </div>
                    <div>
                      <dt>Начало периода квоты</dt>
                      <dd>{date(item.reward.periodStart)} МСК</dd>
                    </div>
                    <div>
                      <dt>Конец периода квоты</dt>
                      <dd>{date(item.reward.periodEnd)} МСК</dd>
                    </div>
                    <div>
                      <dt>Сохранённый срок резерва</dt>
                      <dd>
                        {item.reward.expiresAt
                          ? `${date(item.reward.expiresAt)} МСК`
                          : "Не задан"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {item.values.length === 0 ? (
                  <p>Дополнительные значения не записаны.</p>
                ) : (
                  <dl>
                    {item.values.map((value) => (
                      <div key={value.field}>
                        <dt>
                          {value.field === "version" && item.reward
                            ? "Версия заявки в событии"
                            : fieldNames[value.field]}
                        </dt>
                        <dd>
                          {typeof value.value === "number"
                            ? new Intl.NumberFormat("ru-RU").format(value.value)
                            : ["from", "to", "status", "priority"].includes(
                                  value.field,
                                )
                              ? (statuses[value.value] ?? value.value)
                              : value.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <dl className="audit-ids">
                  <div>
                    <dt>Событие</dt>
                    <dd>{item.id}</dd>
                  </div>
                  {item.task ? (
                    <div>
                      <dt>Задача</dt>
                      <dd>{item.task.id}</dd>
                    </div>
                  ) : null}
                  {item.reward ? (
                    <>
                      <div>
                        <dt>Заявка</dt>
                        <dd>{item.reward.redemptionId}</dd>
                      </div>
                      <div>
                        <dt>Позиция</dt>
                        <dd>{item.reward.rewardId}</dd>
                      </div>
                      <div>
                        <dt>Версия позиции</dt>
                        <dd>{item.reward.rewardVersionId}</dd>
                      </div>
                      <div>
                        <dt>Период квоты</dt>
                        <dd>{item.reward.quotaPeriodId}</dd>
                      </div>
                      <div>
                        <dt>Получатель</dt>
                        <dd>{item.reward.recipient.id}</dd>
                      </div>
                    </>
                  ) : null}
                  {item.reviewId ? (
                    <div>
                      <dt>Решение по отчёту</dt>
                      <dd>{item.reviewId}</dd>
                    </div>
                  ) : null}
                  {item.correctionId ? (
                    <div>
                      <dt>Корректировка</dt>
                      <dd>{item.correctionId}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Запрос</dt>
                    <dd>{item.requestId}</dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ol>
      ) : null}
      {first && query.hasNextPage ? (
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching || query.isError}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Загружаем…" : "Более ранние действия"}
        </button>
      ) : null}
    </section>
  );
}
