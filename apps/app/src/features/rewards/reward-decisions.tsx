"use client";

import {
  apiErrorSchema,
  redemptionReviewResponseSchema,
  redemptionDecisionResponseSchema,
  type RedemptionReviewResponse,
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

class ReviewError extends Error {
  constructor(readonly status: number) {
    super("Reward review unavailable");
  }
}
type Item = RedemptionReviewResponse["items"][number];
type Intent = { url: string; body: string; key: string };
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));

export function RewardDecisions({
  onClose,
  purpose = "decide",
}: {
  onClose(): void;
  purpose?: "decide" | "fulfill";
}) {
  const fulfilling = purpose === "fulfill";
  const { csrfToken, loseAccess, reportDirty, confirmLeave } =
    useAuthorizedSession();
  const client = useQueryClient();
  const [scope, setScope] = useState("");
  const [selection, setSelection] = useState<Item | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | "expire">(
    "approve",
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<
    "idle" | "unknown" | "conflict" | "success"
  >("idle");
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const queue = useInfiniteQuery({
    queryKey: [
      fulfilling ? "redemption-fulfillment" : "redemption-review",
      scope,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (scope) params.set("scope", scope);
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(
        `/api/v1/redemptions/${fulfilling ? "fulfillment" : "review"}?${params}`,
        {
          signal,
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw new ReviewError(response.status);
      return redemptionReviewResponseSchema.parse(await response.json());
    },
    getNextPageParam: (p) => p.nextCursor,
    retry: false,
  });
  useEffect(() => {
    if (
      queue.error instanceof ReviewError &&
      [401, 403].includes(queue.error.status)
    )
      loseAccess(queue.error.status);
  }, [queue.error, loseAccess]);
  useEffect(() => {
    reportDirty(selection !== null);
    if (selection) heading.current?.focus();
    return () => reportDirty(false);
  }, [selection, reportDirty]);
  useEffect(() => () => pending.current?.abort(), []);
  const locked = sending || outcome === "unknown";
  function closeSelection() {
    if (locked || !confirmLeave()) return;
    setSelection(null);
    setIntent(null);
    setConfirmed(false);
    setOutcome("idle");
    setMessage("");
    setReason("");
    void queue.refetch();
  }
  function close() {
    if (!locked && confirmLeave()) onClose();
  }
  useTelegramBack(true, selection ? closeSelection : close, 35);
  async function submit() {
    if (
      !selection ||
      sending ||
      (!intent &&
        (!confirmed ||
          !reason.trim() ||
          outcome === "conflict" ||
          queue.isError))
    )
      return;
    const request = intent ?? {
      url: `/api/v1/redemptions/${selection.redemption.id}/${purpose}`,
      body: JSON.stringify({
        ...(fulfilling ? {} : { decision }),
        reason: reason.trim(),
        expectedVersion: selection.redemption.version,
      }),
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
        loseAccess(response.status);
        return;
      }
      if (response.ok) {
        const result = redemptionDecisionResponseSchema.parse(
          await response.json(),
        );
        setSelection(null);
        setIntent(null);
        setReason("");
        setConfirmed(false);
        setOutcome("success");
        setMessage(
          result.redemption.status === "fulfilled"
            ? "Косметика выдана. Право владения сохранено; баллы и квота не изменились."
            : result.redemption.status === "approved"
              ? "Заявка одобрена. Резерв списан; выдача ещё не подтверждена."
              : result.redemption.status === "expired"
                ? "Резерв завершён по истечению срока. Баллы и место в квоте возвращены."
                : "В заявке отказано. Баллы и место в квоте возвращены.",
        );
        await Promise.all(
          [
            "redemption-review",
            "redemption-fulfillment",
            "my-redemptions",
            "reward-catalog",
            "account-ledger",
          ].map((key) => client.invalidateQueries({ queryKey: [key] })),
        );
      } else if (response.status === 409) {
        const error = apiErrorSchema.safeParse(
          await response.json().catch(() => null),
        );
        setOutcome("conflict");
        setIntent(null);
        setConfirmed(false);
        setMessage(
          error.success && error.data.code === "RESERVATION_NOT_DUE"
            ? "Срок резерва не задан или ещё не достигнут. Вернитесь к очереди и обновите данные перед новым решением."
            : error.success && error.data.code === "RESERVATION_EXPIRED"
              ? "Срок резерва достигнут. Одобрение недоступно. Вернитесь к очереди и завершите резерв по истечению срока или откажите."
              : fulfilling
                ? "Выдача не подтверждена: заявку уже изменил другой уполномоченный либо изменились состояние или доступ получателя. Вернитесь к очереди, обновите заявку и подтвердите выдачу заново."
                : "Решение не принято: заявку уже решил другой уполномоченный либо изменились состояние или доступ получателя. Вернитесь к очереди, обновите заявку и подтвердите решение заново.",
        );
      } else if ([400, 404].includes(response.status)) {
        setOutcome("conflict");
        setIntent(null);
        setConfirmed(false);
        setMessage(
          "Заявка или полномочие недоступны. Вернитесь к очереди и обновите данные.",
        );
      } else {
        setOutcome("unknown");
        setMessage(
          response.status === 429
            ? `Лимит запросов. Повторите ${fulfilling ? "ту же выдачу" : "то же решение"} через ${response.headers.get("retry-after") ?? "несколько"} секунд.`
            : `Результат не подтверждён. Повторите ${fulfilling ? "ту же выдачу" : "то же решение"} для проверки результата.`,
        );
      }
    } catch {
      setOutcome("unknown");
      setMessage(
        `Нет подтверждения сервера. Повторите ${fulfilling ? "ту же выдачу" : "то же решение"}; данные запроса сохранены.`,
      );
    } finally {
      window.clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        setSending(false);
      }
    }
  }
  const hidden =
    queue.error instanceof ReviewError && queue.error.status === 404;
  const first = hidden ? undefined : queue.data?.pages[0],
    items = hidden ? [] : (queue.data?.pages.flatMap((p) => p.items) ?? []);
  const unavailable = queue.isError || queue.isFetchNextPageError;
  return (
    <section
      className="tasks-section reward-catalog"
      aria-labelledby="reward-review-title"
    >
      <div className="tasks-heading">
        <div>
          <h2 id="reward-review-title">
            {fulfilling ? "Выдача поощрений" : "Решения по заявкам"}
          </h2>
          <p>
            {fulfilling
              ? "Одобренные заявки: выдайте поощрение и отметьте выдачу. Баллы уже списаны."
              : "Одобрите или отклоните заявку. При отказе баллы вернутся участнику."}
          </p>
        </div>
        <button
          type="button"
          className="tasks-action"
          disabled={locked || selection !== null || queue.isFetching}
          onClick={() => {
            client.setQueryData<
              InfiniteData<RedemptionReviewResponse, string | null>
            >(
              [
                fulfilling ? "redemption-fulfillment" : "redemption-review",
                scope,
              ],
              (data) =>
                data
                  ? {
                      ...data,
                      pages: data.pages.slice(0, 1),
                      pageParams: [null],
                    }
                  : data,
            );
            void queue.refetch();
          }}
        >
          Обновить очередь
        </button>
      </div>
      {message && (
        <p
          className="tasks-state"
          role={outcome === "success" ? "status" : "alert"}
        >
          {message}
        </p>
      )}
      {selection ? (
        <div className="tasks-detail" aria-labelledby="reward-decision-title">
          <h3 id="reward-decision-title" tabIndex={-1} ref={heading}>
            {fulfilling ? "Подтвердите выдачу" : "Подтвердите решение"}
          </h3>
          <p>
            Получатель: <strong>{selection.recipient.displayName}</strong>
          </p>
          <h4>{selection.redemption.title}</h4>
          <p>{selection.redemption.conditions}</p>
          {!fulfilling && (
            <p>
              {selection.redemption.expiresAt
                ? `Срок резерва: ${date(selection.redemption.expiresAt)} МСК. После срока одобрение недоступно; завершите резерв по истечению срока или откажите.`
                : "Срок резерва не задан; завершение по истечению срока недоступно."}{" "}
              Достижение срока проверяет сервер при сохранении.
            </p>
          )}
          <p className="reward-price">
            {fulfilling ? "Уже списано" : "В резерве"}:{" "}
            {selection.redemption.price} баллов. XP не меняется.
          </p>
          <p>
            Условия версии {selection.redemption.rewardVersion} · заявка версии{" "}
            {selection.redemption.version}. Квота:{" "}
            {date(selection.redemption.periodStart)} –{" "}
            {date(selection.redemption.periodEnd)}.
          </p>
          {fulfilling && selection.redemption.decision && (
            <p>
              Согласовал (текущее имя):{" "}
              {selection.redemption.decision.displayName} ·{" "}
              {date(selection.redemption.decision.decidedAt)}. Основание:{" "}
              {selection.redemption.decision.reason}
            </p>
          )}
          {!fulfilling && (
            <label className="ranking-field reward-scope">
              <span id="reward-decision-label">Решение</span>
              <select
                aria-labelledby="reward-decision-label"
                value={decision}
                disabled={locked || outcome === "conflict"}
                onChange={(e) => {
                  setDecision(
                    e.target.value as "approve" | "reject" | "expire",
                  );
                  setConfirmed(false);
                }}
              >
                <option value="approve">Одобрить</option>
                <option value="reject">Отказать</option>
                {selection.redemption.expiresAt && (
                  <option value="expire">Истечение срока</option>
                )}
              </select>
            </label>
          )}
          <p>
            {fulfilling
              ? "Будет сохранено уникальное право владения косметикой. Повторного списания баллов или места в квоте нет; служебных привилегий предмет не даёт."
              : decision === "approve"
                ? `Будет списано ${selection.redemption.price} баллов из резерва. Доступный баланс не изменится; место в квоте будет использовано.`
                : `Будет возвращено ${selection.redemption.price} баллов из резерва в доступный баланс. Место в квоте освободится.`}
          </p>
          <label className="reward-reason">
            <span id="reward-reason-label">
              {fulfilling ? "Основание выдачи" : "Причина решения"}
            </span>
            <textarea
              aria-labelledby="reward-reason-label"
              value={reason}
              maxLength={2000}
              disabled={locked || outcome === "conflict"}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="reward-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked || outcome === "conflict"}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              {fulfilling
                ? "Проверены получатель, условия и согласование выдачи"
                : "Проверены получатель, условия и действие с резервом"}
            </span>
          </label>
          <div className="tasks-report-actions">
            <button
              type="button"
              className="access-button"
              disabled={
                sending ||
                outcome === "conflict" ||
                (!intent && (!confirmed || !reason.trim() || unavailable))
              }
              onClick={() => void submit()}
            >
              {sending
                ? fulfilling
                  ? "Сохраняем выдачу…"
                  : "Сохраняем решение…"
                : intent
                  ? fulfilling
                    ? "Повторить ту же выдачу"
                    : "Повторить то же решение"
                  : fulfilling
                    ? "Выдать косметику"
                    : decision === "approve"
                      ? "Одобрить заявку"
                      : decision === "expire"
                        ? "Завершить резерв"
                        : "Отказать в заявке"}
            </button>
            <button
              type="button"
              className="tasks-action"
              disabled={locked}
              onClick={closeSelection}
            >
              Вернуться к очереди
            </button>
          </div>
        </div>
      ) : (
        <>
          {queue.isPending && (
            <p className="tasks-state" role="status">
              Загружаем заявки…
            </p>
          )}
          {unavailable && (
            <p className="tasks-state" role="alert">
              {queue.error instanceof ReviewError &&
              [400, 409].includes(queue.error.status)
                ? "Очередь изменилась или страница устарела. Нажмите «Обновить очередь», чтобы начать с первой страницы."
                : queue.error instanceof ReviewError &&
                    queue.error.status === 404
                  ? "Очередь выключена или полномочие недоступно."
                  : "Не удалось обновить очередь. Повторите загрузку."}{" "}
              {first
                ? `Показаны прежние данные от ${date(first.updatedAt)}. Новые ${fulfilling ? "выдачи" : "решения"} недоступны.`
                : ""}
            </p>
          )}
          {first && (
            <>
              {first.scopes.length > 1 && (
                <label className="ranking-field reward-scope">
                  <span>
                    {fulfilling ? "Область выдачи" : "Область решения"}
                  </span>
                  <select
                    value={scope || first.scope?.id || ""}
                    disabled={queue.isFetching}
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
                {first.scope?.name ??
                  (fulfilling
                    ? "Нет области для выдачи косметики"
                    : "Нет области для решений по заявкам")}{" "}
                · подтверждено {date(first.updatedAt)}
              </p>
              {items.length === 0 ? (
                <p className="tasks-state">
                  {first.scope
                    ? fulfilling
                      ? "Согласованных чужих заявок на выдачу нет. Собственную косметику выдаёт другой уполномоченный."
                      : "Ожидающих чужих заявок нет. Собственную заявку решает другой уполномоченный."
                    : `Для ${fulfilling ? "выдачи" : "решений"} требуется отдельное полномочие в точной области.`}
                </p>
              ) : (
                <ul className="tasks-list">
                  {items.map((item) => (
                    <li
                      key={item.redemption.id}
                      data-redemption-id={item.redemption.id}
                    >
                      <div className="reward-row">
                        <div>
                          <h3>{item.redemption.title}</h3>
                          <p>Получатель: {item.recipient.displayName}</p>
                          <p>{item.redemption.conditions}</p>
                          {!fulfilling && (
                            <p>
                              {item.redemption.expiresAt
                                ? `Срок резерва: ${date(item.redemption.expiresAt)} МСК`
                                : "Срок резерва не задан"}
                            </p>
                          )}
                          <p className="reward-price">
                            {fulfilling ? "Уже списано" : "Резерв"}:{" "}
                            {item.redemption.price} баллов
                          </p>
                        </div>
                        <button
                          type="button"
                          className="tasks-action"
                          disabled={unavailable || queue.isFetching}
                          onClick={() => {
                            setSelection(item);
                            setConfirmed(false);
                            setDecision("approve");
                            setOutcome("idle");
                            setMessage("");
                          }}
                        >
                          {fulfilling
                            ? "Подготовить выдачу"
                            : "Рассмотреть заявку"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {queue.hasNextPage && (
                <button
                  type="button"
                  className="tasks-action"
                  disabled={unavailable || queue.isFetching}
                  onClick={() => void queue.fetchNextPage()}
                >
                  {fulfilling
                    ? "Ещё заявки на выдачу"
                    : "Ещё заявки на решение"}
                </button>
              )}
            </>
          )}
          <button type="button" className="tasks-action" onClick={close}>
            Вернуться к поощрениям
          </button>
        </>
      )}
    </section>
  );
}
