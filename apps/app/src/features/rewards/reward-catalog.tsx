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
import { Select } from "@/shared/ui/select";
import "./rewards.css";
import { RewardDecisions } from "./reward-decisions";
import { RewardBadge } from "./reward-visual";

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
      ? "Каталог выключен или недоступен. Обновите поощрения."
      : "Не удалось загрузить поощрения. Проверьте соединение и повторите загрузку.";

// «за 1 ч», «за 3 дн.»: срок резерва словами вместо секунд.
function durationText(seconds: number) {
  const hours = Math.round(seconds / 3600);
  if (seconds < 3600) return `за ${Math.max(1, Math.round(seconds / 60))} мин`;
  if (hours < 48) return `за ${hours} ч`;
  return `за ${Math.round(hours / 24)} дн.`;
}

// Состояние заявки одним словом и цветом метки.
const requestStatus: Record<
  Redemption["status"],
  { text: string; tone: string }
> = {
  pending: { text: "Ждёт решения", tone: "in_review" },
  approved: { text: "Одобрено, ждёт выдачи", tone: "in_progress" },
  fulfilled: { text: "Получено", tone: "accepted" },
  rejected: { text: "Отказано, баллы вернулись", tone: "cancelled" },
  expired: { text: "Срок истёк, баллы вернулись", tone: "cancelled" },
  cancelled: { text: "Отменено, баллы вернулись", tone: "cancelled" },
};

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
    setIntent(null);
    setOutcome("idle");
    setMessage("");
  }
  useTelegramBack(selection !== null, close, 30);
  function choose(next: Selection) {
    if (!confirmLeave()) return;
    setSelection(next);
    setReason("");
    setIntent(null);
    setOutcome("idle");
    setMessage("");
  }
  async function submit() {
    if (
      !selection ||
      sending ||
      (!intent && selection.action === "cancel" && !reason.trim())
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
          ? `Заявка сохранена: ${number(data.redemption.price)} баллов ждут решения командира.`
          : `Заявка отменена. ${number(data.redemption.price)} баллов вернулись.`,
      );
      setSelection(null);
      setIntent(null);
      setReason("");
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
          <p>Обменивайте баллы на поощрения. XP при этом не уменьшается.</p>
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
              Выдача поощрений
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
          <RewardBadge title={selection.item.title} size="lg" />
          <h3 id="reward-confirm-title" ref={formHeading} tabIndex={-1}>
            {selection.action === "reserve"
              ? "Получить поощрение?"
              : "Отменить заявку?"}
          </h3>
          <strong className="reward-confirm-name">
            {selection.item.title}
          </strong>
          <p>{selection.item.conditions}</p>
          <p className="reward-confirm-sum">
            {selection.action === "reserve" ? "−" : "+"}
            {number(selection.item.price)} баллов
          </p>
          {first && (
            <p className="reward-balance-preview">
              {insufficientPreview
                ? "Баллов не хватает. Обновите поощрения."
                : `После ${selection.action === "reserve" ? "заявки" : "отмены"} останется ${number(projectedAvailable!)} баллов.`}
            </p>
          )}
          {selection.action === "reserve" ? (
            <p className="notification-note">
              {outcome === "conflict"
                ? "Данные устарели, обновите поощрения."
                : `Командир подтвердит заявку и выдаст поощрение. Если откажет${
                    selection.item.reservationSeconds !== null
                      ? ` или не ответит ${durationText(selection.item.reservationSeconds)}`
                      : ""
                  }, баллы вернутся.`}
            </p>
          ) : (
            <label className="reward-reason">
              Причина отмены
              <textarea
                value={reason}
                maxLength={2000}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
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
                Обновить поощрения
              </button>
            ) : (
              <button
                type="button"
                className="tasks-action task-report-primary"
                disabled={
                  sending ||
                  (!intent &&
                    (insufficientPreview ||
                      (selection.action === "cancel" && !reason.trim())))
                }
                onClick={() => void submit()}
              >
                {sending
                  ? "Отправляем…"
                  : intent
                    ? "Повторить тот же запрос"
                    : selection.action === "reserve"
                      ? `Получить за ${number(selection.item.price)} баллов`
                      : "Отменить и вернуть баллы"}
              </button>
            )}
            <button
              type="button"
              className="tasks-action"
              disabled={sending}
              onClick={close}
            >
              Назад
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
                    " Показаны последние подтверждённые данные; заявки отключены до обновления."}
                </p>
              )}
              {first && (
                <>
                  <div className="reward-wallet">
                    <span>У вас</span>
                    <strong>{number(first.balance.availablePoints)}</strong>
                    <span>баллов</span>
                    {first.balance.reservedPoints > 0 ? (
                      <small>
                        Ещё {number(first.balance.reservedPoints)} в заявках
                      </small>
                    ) : null}
                  </div>
                  {first.scopes.length > 1 && (
                    <div className="tasks-filter reward-scope">
                      <span id="reward-catalog-scope-label">Область</span>
                      <Select
                        labelledBy="reward-catalog-scope-label"
                        value={scope || first.scope?.id || ""}
                        onValueChange={setScope}
                        options={first.scopes.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                      />
                    </div>
                  )}
                  {items.length === 0 ? (
                    <p className="tasks-empty">
                      {first.scope
                        ? "Поощрений пока нет. Их добавляет командир."
                        : "Поощрения видны участникам. Вас пока не добавили в участники."}
                    </p>
                  ) : (
                    <ul className="reward-list">
                      {items.map((item) => {
                        const short =
                          item.price - first.balance.availablePoints;
                        const soldOut = item.quota.available === 0;
                        const left =
                          item.quota.available === null
                            ? "Без лимита"
                            : `Осталось ${item.quota.available}`;
                        return (
                          <li key={item.id} className="reward-card">
                            <RewardBadge title={item.title} />
                            <h3>{item.title}</h3>
                            <p className="reward-card-text">
                              {item.conditions}
                            </p>
                            <p className="reward-card-meta">
                              <strong className="reward-price">
                                {number(item.price)} баллов
                              </strong>
                              <span>
                                {soldOut
                                  ? "Закончились"
                                  : `${left} · до ${date(item.quota.endsAt)}`}
                              </span>
                            </p>
                            {!item.owned &&
                            !item.hasPendingRequest &&
                            !soldOut &&
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
                                <span>Не хватает {number(short)} баллов</span>
                              </div>
                            ) : null}
                            {item.owned || item.hasPendingRequest || soldOut ? (
                              // Недоступное действие — короткая метка, а не
                              // выключенная кнопка: отмена заявки — в «Мои заявки».
                              <p className="reward-card-state">
                                {item.owned
                                  ? "Уже получено"
                                  : item.hasPendingRequest
                                    ? "Ждёт решения"
                                    : "Закончились"}
                              </p>
                            ) : short > 0 ? null : (
                              <div className="reward-card-actions">
                                <button
                                  className="tasks-action task-report-primary"
                                  type="button"
                                  disabled={unavailable || catalog.isFetching}
                                  onClick={() =>
                                    choose({ action: "reserve", item })
                                  }
                                >
                                  Получить
                                </button>
                              </div>
                            )}
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
                    <p className="notification-note">
                      Заявок пока нет. Выберите поощрение выше.
                    </p>
                  )}
                  <ul className="reward-request-list">
                    {requests.map((item) => {
                      const state = requestStatus[item.status];
                      const why =
                        item.cancellationReason ??
                        (item.status === "rejected" || item.status === "expired"
                          ? item.decision?.reason
                          : null);
                      return (
                        <li key={item.id}>
                          <RewardBadge title={item.title} size="sm" />
                          <div className="reward-request-body">
                            <h4>{item.title}</h4>
                            <p>
                              <span
                                className={`task-chip task-chip--status task-chip--${state.tone}`}
                              >
                                {state.text}
                              </span>{" "}
                              <span className="reward-price">
                                {number(item.price)} баллов
                              </span>
                            </p>
                            {item.status === "pending" && item.expiresAt ? (
                              <p className="notification-note">
                                Ответ до {deadlineDate(item.expiresAt)}
                              </p>
                            ) : null}
                            {why ? (
                              <p className="notification-note">
                                Причина: {why}
                              </p>
                            ) : null}
                            {item.decision?.actorId === null ? (
                              <p className="notification-note">
                                Закрыто автоматически
                              </p>
                            ) : null}
                            {(first?.scopes.length ?? 0) > 1 ? (
                              <p className="notification-note">
                                {item.scope.name}
                              </p>
                            ) : null}
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
                        </li>
                      );
                    })}
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
