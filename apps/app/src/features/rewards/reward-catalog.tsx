"use client";

import {
  rewardCatalogResponseSchema,
  redemptionListResponseSchema,
  redemptionMutationResponseSchema,
  type RewardCatalogResponse,
  type Redemption,
  type RedemptionMutationResponse,
  type RedemptionListResponse,
} from "@impuls/contracts";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import "./rewards.css";
import { RewardDecisions } from "./reward-decisions";

class RewardError extends Error {
  constructor(readonly status: number) {
    super("Reward request failed");
  }
}
async function read<T>(
  url: string,
  signal: AbortSignal,
  parse: (value: unknown) => T,
) {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new RewardError(response.status);
  return parse(await response.json());
}
type Item = RewardCatalogResponse["items"][number];
type Selection =
  { action: "reserve"; item: Item } | { action: "cancel"; item: Redemption };
type Intent = { url: string; body: string; key: string };
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const deadlineDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
const errorText = (error: Error | null) =>
  error instanceof RewardError && [400, 409].includes(error.status)
    ? "Каталог или список заявок изменился; страница устарела. Нажмите «Обновить поощрения», чтобы начать с первой страницы."
    : error instanceof RewardError && error.status === 404
      ? "Синтетический каталог выключен или область больше недоступна. Обновите поощрения, чтобы проверить доступ."
      : "Не удалось загрузить поощрения. Проверьте соединение и повторите загрузку.";

export function RewardCatalog() {
  const {
    csrfToken,
    loseAccess,
    reportDirty,
    confirmLeave,
    canDecideRewards,
    canFulfillRewards,
  } = useAuthorizedSession();
  const client = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [fulfilling, setFulfilling] = useState(false);
  const [scope, setScope] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<
    "idle" | "unknown" | "conflict" | "success"
  >("idle");
  const pending = useRef<AbortController | null>(null);
  const formHeading = useRef<HTMLHeadingElement | null>(null);
  const catalog = useInfiniteQuery({
    queryKey: ["reward-catalog", scope],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (scope) params.set("scope", scope);
      if (pageParam) params.set("cursor", pageParam);
      try {
        const page = await read(`/api/v1/rewards?${params}`, signal, (v) =>
          rewardCatalogResponseSchema.parse(v),
        );
        return page;
      } catch (error) {
        if (error instanceof RewardError && error.status === 404)
          client.setQueryData<
            InfiniteData<RewardCatalogResponse, string | null>
          >(["reward-catalog", scope], (data) =>
            data ? { ...data, pages: [], pageParams: [] } : data,
          );
        throw error;
      }
    },
    getNextPageParam: (p) => p.nextCursor,
    retry: false,
  });
  const mine = useInfiniteQuery({
    queryKey: ["my-redemptions"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      read(
        `/api/v1/me/redemptions?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        signal,
        (v) => redemptionListResponseSchema.parse(v),
      ),
    getNextPageParam: (p) => p.nextCursor,
    retry: false,
  });
  useEffect(() => {
    for (const error of [catalog.error, mine.error])
      if (error instanceof RewardError && [401, 403].includes(error.status)) {
        loseAccess(error.status);
        break;
      }
  }, [catalog.error, mine.error, loseAccess]);
  useEffect(() => {
    reportDirty(Boolean(selection));
    if (selection) formHeading.current?.focus();
    return () => reportDirty(false);
  }, [selection, reportDirty]);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  function close() {
    if (sending || !confirmLeave()) return;
    setSelection(null);
    setReason("");
    setConfirmed(false);
    setIntent(null);
    setOutcome("idle");
    setMessage("");
  }
  useTelegramBack(selection !== null, close, 30);
  function choose(next: Selection) {
    if (!confirmLeave()) return;
    setSelection(next);
    setConfirmed(false);
    setReason("");
    setIntent(null);
    setOutcome("idle");
    setMessage("");
  }
  async function submit() {
    if (
      !selection ||
      sending ||
      (!intent &&
        (!confirmed || (selection.action === "cancel" && !reason.trim())))
    )
      return;
    const request = intent ?? {
      url:
        selection.action === "reserve"
          ? "/api/v1/redemptions"
          : `/api/v1/redemptions/${selection.item.id}/cancel`,
      body: JSON.stringify(
        selection.action === "reserve"
          ? {
              rewardVersionId: selection.item.id,
              quotaPeriodId: selection.item.quota.id,
              expectedVersion: selection.item.version,
            }
          : { expectedVersion: selection.item.version, reason: reason.trim() },
      ),
      key: crypto.randomUUID(),
    };
    setIntent(request);
    setSending(true);
    setMessage("");
    const controller = new AbortController();
    pending.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(request.url, {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": request.key,
        },
        body: request.body,
      });
      if ([401, 403].includes(response.status)) {
        reportDirty(false);
        loseAccess(response.status);
        return;
      }
      if (response.status === 429) {
        setOutcome("unknown");
        setMessage(
          `Слишком много действий. Повторите тот же запрос через ${response.headers.get("retry-after") ?? "несколько"} с.`,
        );
        return;
      }
      if (
        response.status === 409 ||
        response.status === 404 ||
        response.status === 400
      ) {
        const data: unknown = await response.json();
        setIntent(null);
        setOutcome("conflict");
        setConfirmed(false);
        setMessage(
          typeof data === "object" &&
            data !== null &&
            "message" in data &&
            typeof data.message === "string"
            ? data.message
            : "Условия изменились. Обновите данные.",
        );
        return;
      }
      if (!response.ok) throw new Error("Unconfirmed mutation");
      const data: RedemptionMutationResponse =
        redemptionMutationResponseSchema.parse(await response.json());
      setOutcome("success");
      setMessage(
        data.redemption.status === "pending"
          ? `Заявка сохранена. В резерве ${number(data.redemption.price)} баллов. Выдача ещё не подтверждена.`
          : `Заявка отменена. Возвращено ${number(data.redemption.price)} баллов и место в исходной квоте.`,
      );
      setSelection(null);
      setIntent(null);
      setReason("");
      setConfirmed(false);
      reportDirty(false);
      await Promise.all(
        [
          "reward-catalog",
          "my-redemptions",
          "account-ledger",
          "participant-profile",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    } catch {
      if (pending.current === controller) {
        setOutcome("unknown");
        setMessage(
          "Результат не подтверждён. Повторите тот же запрос, чтобы узнать итог без второго резерва или возврата.",
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        setSending(false);
      }
    }
  }
  function refresh() {
    client.setQueryData<InfiniteData<RewardCatalogResponse, string | null>>(
      ["reward-catalog", scope],
      (data) =>
        data
          ? { ...data, pages: data.pages.slice(0, 1), pageParams: [null] }
          : data,
    );
    client.setQueryData<InfiniteData<RedemptionListResponse, string | null>>(
      ["my-redemptions"],
      (data) =>
        data
          ? { ...data, pages: data.pages.slice(0, 1), pageParams: [null] }
          : data,
    );
    void catalog.refetch();
    void mine.refetch();
  }
  const catalogHidden =
    catalog.error instanceof RewardError && catalog.error.status === 404;
  const first = catalogHidden ? undefined : catalog.data?.pages[0];
  const projectedAvailable =
    selection && first
      ? first.balance.availablePoints +
        (selection.action === "reserve"
          ? -selection.item.price
          : selection.item.price)
      : null;
  const insufficientPreview =
    selection?.action === "reserve" &&
    projectedAvailable !== null &&
    projectedAvailable < 0;
  const items = catalogHidden
    ? []
    : (catalog.data?.pages.flatMap((p) => p.items) ?? []);
  const requests = mine.data?.pages.flatMap((p) => p.items) ?? [];
  const unavailable = catalog.isError || catalog.isFetchNextPageError;
  const locked = sending || outcome === "unknown";
  if (reviewing && canDecideRewards)
    return <RewardDecisions onClose={() => setReviewing(false)} />;
  if (fulfilling && canFulfillRewards)
    return (
      <RewardDecisions purpose="fulfill" onClose={() => setFulfilling(false)} />
    );
  return (
    <section
      className="tasks-section reward-catalog"
      aria-labelledby="rewards-title"
    >
      <div className="tasks-heading">
        <div>
          <h2 id="rewards-title">Поощрения</h2>
          <p>
            Синтетическая косметика. Баллы резервируются до решения; XP остаётся
            прежним.
          </p>
        </div>
        <button
          className="tasks-action"
          type="button"
          disabled={
            locked ||
            catalog.isFetching ||
            mine.isFetching ||
            selection !== null
          }
          onClick={refresh}
        >
          Обновить поощрения
        </button>
      </div>
      {(canDecideRewards || canFulfillRewards) && !selection && (
        <div className="reward-management-actions">
          {canDecideRewards && (
            <button
              type="button"
              className="tasks-action"
              onClick={() => {
                if (confirmLeave()) setReviewing(true);
              }}
            >
              Решения по заявкам
            </button>
          )}
          {canFulfillRewards && (
            <button
              type="button"
              className="tasks-action"
              onClick={() => {
                if (confirmLeave()) setFulfilling(true);
              }}
            >
              Выдача косметики
            </button>
          )}
        </div>
      )}
      {message && (
        <p
          className="tasks-state"
          role={outcome === "success" ? "status" : "alert"}
        >
          {message}
        </p>
      )}
      {selection ? (
        <div
          className="tasks-detail reward-confirmation"
          aria-labelledby="reward-confirm-title"
        >
          <h3 id="reward-confirm-title" ref={formHeading} tabIndex={-1}>
            {selection.action === "reserve"
              ? "Подтвердите резерв"
              : "Отменить заявку"}
          </h3>
          <strong>{selection.item.title}</strong>
          <p>{selection.item.conditions}</p>
          <p>
            {selection.action === "reserve"
              ? selection.item.reservationSeconds === null
                ? "Срок резерва не задан."
                : `Срок резерва: ${number(selection.item.reservationSeconds)} секунд с подачи.`
              : selection.item.expiresAt
                ? `Срок резерва: ${deadlineDate(selection.item.expiresAt)} МСК.`
                : "Срок резерва не задан."}{" "}
            По истечении срока баллы и место возвращаются после серверной
            обработки или решения уполномоченного. Возврат подтверждает статус
            заявки, а не часы устройства.
          </p>
          <p className="reward-price">
            {number(selection.item.price)} баллов{" "}
            {selection.action === "reserve"
              ? "перейдут в резерв"
              : "вернутся из резерва"}
          </p>
          {first && (
            <div className="reward-balance-preview">
              <p>
                Последний подтверждённый доступный баланс:{" "}
                {number(first.balance.availablePoints)} баллов.
              </p>
              <p>
                {insufficientPreview
                  ? "Недостаточно доступных баллов. Обновите условия."
                  : `После ${selection.action === "reserve" ? "резерва" : "отмены"} останется доступно: ${number(projectedAvailable!)} баллов.`}
              </p>
              <p>
                Предварительный расчёт по данным от {date(first.updatedAt)}.
                Итоговый баланс подтвердит сервер.
              </p>
            </div>
          )}
          {selection.action === "reserve" ? (
            <p>
              Квота: {date(selection.item.quota.startsAt)} –{" "}
              {date(selection.item.quota.endsAt)}.{" "}
              {outcome === "conflict"
                ? "Данные устарели, обновите условия."
                : `Свободно: ${selection.item.quota.available}.`}{" "}
              Условия версии {selection.item.version}. Резерв не означает
              выдачу.
            </p>
          ) : (
            <>
              <p>
                Исходная квота: {date(selection.item.periodStart)} –{" "}
                {date(selection.item.periodEnd)}. Условия версии{" "}
                {selection.item.rewardVersion} сохраняются.
              </p>
              <label className="reward-reason">
                Причина отмены
                <textarea
                  value={reason}
                  maxLength={2000}
                  disabled={locked}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="reward-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked || outcome === "conflict" || insufficientPreview}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {selection.action === "reserve"
              ? "Подтверждаю резерв баллов и одного места"
              : "Подтверждаю отмену и возврат резерва"}
          </label>
          <div className="task-history-actions">
            {outcome === "conflict" ? (
              <button
                type="button"
                className="tasks-action"
                onClick={() => {
                  setSelection(null);
                  setIntent(null);
                  setReason("");
                  setOutcome("idle");
                  setMessage("");
                  refresh();
                }}
              >
                Обновить условия
              </button>
            ) : (
              <button
                type="button"
                className="tasks-action task-report-primary"
                disabled={
                  sending ||
                  (!intent &&
                    (insufficientPreview ||
                      !confirmed ||
                      (selection.action === "cancel" && !reason.trim())))
                }
                onClick={() => void submit()}
              >
                {sending
                  ? "Подтверждаем…"
                  : intent
                    ? "Повторить тот же запрос"
                    : selection.action === "reserve"
                      ? "Создать заявку и резерв"
                      : "Отменить и вернуть баллы"}
              </button>
            )}
            <button
              type="button"
              className="tasks-action"
              disabled={sending}
              onClick={close}
            >
              Закрыть форму
            </button>
          </div>
        </div>
      ) : (
        <>
          {catalog.isPending ? (
            <p className="tasks-state" role="status">
              Загружаем каталог…
            </p>
          ) : (
            <>
              {unavailable && (
                <p className="tasks-state" role="alert">
                  {errorText(catalog.error)}
                  {first &&
                    " Показаны последние подтверждённые данные; создание заявки отключено до обновления."}
                </p>
              )}
              {first && (
                <>
                  <dl className="ledger-balances reward-balance">
                    <div>
                      <dt>Доступно</dt>
                      <dd>{number(first.balance.availablePoints)} баллов</dd>
                    </div>
                    <div>
                      <dt>В резерве</dt>
                      <dd>{number(first.balance.reservedPoints)} баллов</dd>
                    </div>
                  </dl>
                  {first.scopes.length > 1 && (
                    <label className="tasks-filter reward-scope">
                      Область
                      <select
                        value={scope || first.scope?.id || ""}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        {first.scopes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="ledger-asof">
                    {first.scope?.name ?? "Нет области каталога"} · подтверждено{" "}
                    {date(first.updatedAt)}
                  </p>
                  {items.length === 0 ? (
                    <p className="tasks-state">
                      {first.scope
                        ? "В этой области пока нет доступных косметических позиций с действующей квотой."
                        : "Для каталога требуется членство в области. Ваши прежние заявки остаются ниже."}
                    </p>
                  ) : (
                    <ul className="tasks-list reward-list">
                      {items.map((item) => {
                        const short =
                          item.price - first.balance.availablePoints;
                        const pending = requests.find(
                          (request) =>
                            request.status === "pending" &&
                            request.rewardId === item.rewardId,
                        );
                        return (
                          <li key={item.id}>
                            <div className="reward-row">
                              <div className="reward-row-body">
                                <div className="reward-row-head">
                                  <h3>{item.title}</h3>
                                  <strong className="reward-price">
                                    {number(item.price)} баллов
                                  </strong>
                                </div>
                                <p>{item.conditions}</p>
                                <p>
                                  Квота до {date(item.quota.endsAt)} · свободно{" "}
                                  {item.quota.available}
                                </p>
                                {item.hasPendingRequest ? (
                                  <span className="task-chip task-chip--in_review reward-state">
                                    Ждёт решения командира
                                  </span>
                                ) : null}
                                {!item.owned &&
                                !item.hasPendingRequest &&
                                item.quota.available > 0 &&
                                short > 0 ? (
                                  <div className="reward-meter">
                                    <progress
                                      max={item.price}
                                      value={Math.max(
                                        0,
                                        first.balance.availablePoints,
                                      )}
                                      aria-label={`Накоплено ${number(first.balance.availablePoints)} из ${number(item.price)} баллов`}
                                    />
                                    <span>
                                      Не хватает {number(short)} баллов
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                              <div className="reward-row-action">
                                <button
                                  className="tasks-action"
                                  type="button"
                                  disabled={
                                    unavailable ||
                                    catalog.isFetching ||
                                    item.hasPendingRequest ||
                                    item.owned ||
                                    item.quota.available === 0 ||
                                    first.balance.availablePoints < item.price
                                  }
                                  onClick={() =>
                                    choose({ action: "reserve", item })
                                  }
                                >
                                  {item.owned
                                    ? "Уже в коллекции"
                                    : item.hasPendingRequest
                                      ? "Заявка уже есть"
                                      : item.quota.available === 0
                                        ? "Нет свободных мест"
                                        : short > 0
                                          ? "Недостаточно баллов"
                                          : "Оформить заявку"}
                                </button>
                                {pending ? (
                                  <button
                                    className="tasks-action reward-cancel"
                                    type="button"
                                    disabled={
                                      mine.isError ||
                                      mine.isFetching ||
                                      mine.isFetchNextPageError
                                    }
                                    onClick={() =>
                                      choose({
                                        action: "cancel",
                                        item: pending,
                                      })
                                    }
                                  >
                                    Отменить запрос
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {catalog.hasNextPage && (
                    <button
                      type="button"
                      className="tasks-action tasks-more"
                      disabled={catalog.isFetching || unavailable}
                      onClick={() => void catalog.fetchNextPage()}
                    >
                      Ещё позиции
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {!(
            catalog.error instanceof RewardError &&
            catalog.error.status === 404 &&
            mine.error instanceof RewardError &&
            mine.error.status === 404
          ) && (
            <div className="reward-requests">
              <h3>Мои заявки</h3>
              {mine.isPending ? (
                <p role="status">Загружаем заявки…</p>
              ) : (
                <>
                  {(mine.isError || mine.isFetchNextPageError) && (
                    <p className="tasks-state" role="alert">
                      {errorText(mine.error)}
                      {requests.length > 0 &&
                        " Показаны сохранённые заявки; отмена отключена до обновления."}
                    </p>
                  )}
                  {!mine.isError && requests.length === 0 && (
                    <p>
                      Заявок пока нет. Перед подачей вы сможете проверить
                      условия и сумму резерва.
                    </p>
                  )}
                  <ul className="tasks-list">
                    {requests.map((item) => (
                      <li key={item.id}>
                        <div className="reward-row">
                          <div>
                            <h4>{item.title}</h4>
                            <p>
                              {item.status === "pending"
                                ? "В резерве, ожидает решения"
                                : item.status === "fulfilled"
                                  ? "Косметика выдана, право владения сохранено"
                                  : item.status === "approved"
                                    ? "Одобрена, резерв списан. Выдача ещё не подтверждена"
                                    : item.status === "rejected"
                                      ? "Отказано, резерв возвращён"
                                      : item.status === "expired"
                                        ? "Срок резерва истёк, баллы и место возвращены"
                                        : "Отменена, резерв возвращён"}{" "}
                              · {number(item.price)} баллов
                            </p>
                            <p>{item.conditions}</p>
                            <p>
                              {item.scope.name} · условия {item.rewardVersion} ·
                              квота до {date(item.periodEnd)}
                            </p>
                            <p>
                              {item.expiresAt
                                ? `Срок резерва: ${deadlineDate(item.expiresAt)} МСК.`
                                : "Срок резерва не задан."}
                              {item.status === "pending" &&
                                item.expiresAt &&
                                " Возврат по истечении срока требует серверной обработки или решения уполномоченного."}
                            </p>
                            {item.cancellationReason && (
                              <p>Причина: {item.cancellationReason}</p>
                            )}
                            {item.decision && (
                              <p>
                                Причина решения: {item.decision.reason}.{" "}
                                {item.decision.actorId === null
                                  ? "Обработчик"
                                  : "Автор (текущее имя)"}
                                : {item.decision.displayName} ·{" "}
                                {date(item.decision.decidedAt)}
                              </p>
                            )}
                            {item.fulfillment && (
                              <p>
                                Основание выдачи: {item.fulfillment.reason}.
                                Автор (текущее имя):{" "}
                                {item.fulfillment.displayName} ·{" "}
                                {date(item.fulfillment.fulfilledAt)}. Косметика
                                в вашей коллекции; служебных привилегий не даёт.
                              </p>
                            )}
                          </div>
                          {item.status === "pending" && (
                            <button
                              className="tasks-action"
                              disabled={
                                mine.isError ||
                                mine.isFetching ||
                                mine.isFetchNextPageError
                              }
                              type="button"
                              onClick={() => choose({ action: "cancel", item })}
                            >
                              Отменить заявку
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {mine.hasNextPage && (
                    <button
                      type="button"
                      className="tasks-action tasks-more"
                      disabled={
                        mine.isFetching ||
                        mine.isError ||
                        mine.isFetchNextPageError
                      }
                      onClick={() => void mine.fetchNextPage()}
                    >
                      Ещё заявки
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
