"use client";

import {
  apiErrorSchema,
  ledgerCorrectionResponseSchema,
  ledgerCorrectionsResponseSchema,
  type LedgerCorrectionItem,
} from "@impuls/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";

const path = "/api/v1/admin/ledger-corrections";
class CorrectionError extends Error {
  constructor(readonly status: number) {
    super("Correction unavailable");
  }
}
async function load(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`${path}?${params}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new CorrectionError(response.status);
  return ledgerCorrectionsResponseSchema.parse(await response.json());
}
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

function CorrectionForm({
  item,
  onClose,
}: {
  item: LedgerCorrectionItem;
  onClose(): void;
}) {
  const { csrfToken, loseAccess, reportDirty } = useAuthorizedSession();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(item);
  const insufficient =
    current.balance.lifetimeXp < current.xp ||
    current.balance.availablePoints < current.points;
  const [candidate, setCandidate] = useState<LedgerCorrectionItem | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const running = useRef(false);
  const intent = useRef<{ key: string; body: string } | null>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  useEffect(() => {
    reportDirty(!!reason || confirmed || pending || uncertain);
    return () => reportDirty(false);
  }, [reason, confirmed, pending, uncertain, reportDirty]);
  async function refresh() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setCandidate(null);
    try {
      const result = await load(
        new URLSearchParams({ reviewId: item.reviewId }),
      );
      const next = result.items[0];
      if (!next) {
        setMessage("Начисление больше недоступно. Основание сохранено.");
        setConflict(false);
      } else if (next.correction) {
        setMessage(`Начисление уже возвращено: ${next.correction.reason}`);
        setConflict(false);
      } else if (!next.enabled) {
        setMessage("Корректировка больше недоступна. Основание сохранено.");
        setConflict(false);
      } else {
        setCandidate(next);
        setMessage(
          "Проверьте новый баланс и явно примите его версию. Основание сохранено.",
        );
      }
    } catch (error) {
      if (
        error instanceof CorrectionError &&
        (error.status === 401 || error.status === 403)
      )
        loseAccess(error.status);
      else
        setMessage(
          "Не удалось обновить баланс. Основание сохранено; повторите загрузку.",
        );
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  async function send() {
    if (
      running.current ||
      blocked ||
      (!intent.current && (insufficient || !confirmed || !reason.trim()))
    )
      return;
    running.current = true;
    setPending(true);
    setMessage(null);
    const attempt = intent.current ?? {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        reviewId: item.reviewId,
        expectedVersion: current.balance.version,
        reason: reason.trim(),
      }),
    };
    intent.current = attempt;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": attempt.key,
        },
        body: attempt.body,
      });
      if (!response.ok) {
        if (response.status === 429) {
          setUncertain(true);
          setMessage(mutationLimitMessage(response));
          return;
        }
        const parsed = apiErrorSchema.safeParse(await response.json());
        const code = parsed.success ? parsed.data.code : undefined;
        if (response.status === 401 || code === "ACCESS_REVOKED") {
          loseAccess(response.status);
          return;
        }
        if ([400, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setUncertain(false);
          setBlocked(true);
          setConflict(response.status === 409);
          setMessage(
            response.status === 409
              ? "Баланс или начисление изменились. Обновите данные; основание сохранено."
              : code === "INSUFFICIENT_BALANCE"
                ? "Недостаточно доступных XP или баллов. Возврат не выполнен; нужен отдельный порядок исправления."
                : parsed.success
                  ? `${parsed.data.message}. Основание сохранено.`
                  : "Запрос отклонён. Основание сохранено.",
          );
          return;
        }
        throw new Error("Unknown correction outcome");
      }
      const result = ledgerCorrectionResponseSchema.parse(
        await response.json(),
      );
      intent.current = null;
      setUncertain(false);
      setBlocked(true);
      setSuccess(true);
      setReason("");
      setConfirmed(false);
      setMessage(
        `Возврат записан: ${number(result.correction.xpDelta)} XP и ${number(result.correction.pointsDelta)} баллов. Баланс получателя: ${number(result.balance.lifetimeXp)} XP, ${number(result.balance.availablePoints)} баллов. Основание: ${result.correction.reason}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["account-ledger"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger-corrections"] });
    } catch {
      setUncertain(true);
      setMessage(
        navigator.onLine
          ? "Результат не подтверждён. Повторите тот же запрос; данные сохранены."
          : "Нет соединения. Восстановите сеть и повторите тот же запрос; данные сохранены.",
      );
    } finally {
      window.clearTimeout(timeout);
      running.current = false;
      setPending(false);
    }
  }
  const frozen = pending || uncertain || blocked;
  return (
    <section className="tasks-detail" aria-labelledby="correction-detail-title">
      <div className="tasks-detail-top">
        <h3 id="correction-detail-title" ref={heading} tabIndex={-1}>
          Возврат начисления
        </h3>
        <button
          type="button"
          className="tasks-action"
          disabled={pending}
          onClick={onClose}
        >
          К начислениям
        </button>
      </div>
      <h4>{current.task.title}</h4>
      <form
        className="task-report"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="review-preview">
          <p>
            Получатель: <strong>{current.recipient.displayName}</strong> ·{" "}
            {current.scope.name}
          </p>
          <p>
            Возврат: <strong>−{number(current.xp)} XP</strong> и −
            {number(current.points)} баллов.
          </p>
          {insufficient ? (
            <p>
              Доступный баланс меньше исходного начисления. Полный возврат
              невозможен без отдельного решения.
            </p>
          ) : (
            <p>
              После возврата: {number(current.balance.lifetimeXp - current.xp)}{" "}
              XP, {number(current.balance.availablePoints - current.points)}{" "}
              доступных баллов. Резерв: {number(current.balance.reservedPoints)}
              .
            </p>
          )}
          <p>
            Исходный сезон {current.seasonKey} · правила {current.ruleVersion} ·
            версия баланса {current.balance.version}. Приёмка и исходные записи
            сохраняются. Синтетический режим.
          </p>
        </div>
        {!success && (
          <>
            <label id="correction-reason-label" htmlFor="correction-reason">
              Основание возврата
            </label>
            <textarea
              id="correction-reason"
              aria-labelledby="correction-reason-label"
              value={reason}
              maxLength={2000}
              required
              disabled={frozen}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="task-report-length">{reason.length} / 2000</p>
            <div className="review-preview">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={frozen}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Подтверждаю получателя, обе суммы и новый баланс
              </label>
            </div>
          </>
        )}
        {message && (
          <p
            role={success ? "status" : "alert"}
            className={success ? "task-report-success" : "task-report-error"}
          >
            {message}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="tasks-action"
            disabled={pending}
            onClick={() => void refresh()}
          >
            Обновить баланс
          </button>
        )}
        {candidate && (
          <div className="review-preview">
            <p>
              Новая версия {candidate.balance.version}:{" "}
              {number(candidate.balance.lifetimeXp)} XP,{" "}
              {number(candidate.balance.availablePoints)} доступных баллов.
              {candidate.balance.lifetimeXp < candidate.xp ||
              candidate.balance.availablePoints < candidate.points
                ? " Полный возврат невозможен: доступный баланс меньше исходного начисления."
                : ` После возврата: ${number(candidate.balance.lifetimeXp - candidate.xp)} XP, ${number(candidate.balance.availablePoints - candidate.points)} баллов.`}
            </p>
            <button
              type="button"
              className="tasks-action"
              disabled={pending}
              onClick={() => {
                setCurrent(candidate);
                setCandidate(null);
                setConflict(false);
                setBlocked(false);
                setConfirmed(false);
                setMessage(null);
              }}
            >
              Принять новую версию баланса
            </button>
          </div>
        )}
        {!blocked && (
          <button
            type="submit"
            className="tasks-action task-report-primary"
            disabled={
              pending ||
              (!uncertain && (insufficient || !confirmed || !reason.trim()))
            }
          >
            {pending
              ? "Записываем возврат…"
              : uncertain
                ? "Повторить тот же запрос"
                : "Записать возврат начисления"}
          </button>
        )}
      </form>
    </section>
  );
}

function CorrectionList() {
  const { loseAccess, confirmLeave } = useAuthorizedSession();
  const [selected, setSelected] = useState<LedgerCorrectionItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["ledger-corrections"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam) params.set("cursor", pageParam);
      return load(params, signal);
    },
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const closeSelected = () => {
    if (confirmLeave()) {
      setSelected(null);
      void query.refetch();
    }
  };
  useTelegramBack(selected !== null, closeSelected, 30);
  useEffect(() => {
    if (
      query.error instanceof CorrectionError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (selected)
    return (
      <CorrectionForm
        key={selected.reviewId}
        item={selected}
        onClose={closeSelected}
      />
    );
  return (
    <div>
      <div className="tasks-heading">
        <h3>Исправление начислений</h3>
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить начисления
        </button>
      </div>
      <p>
        Полный однократный возврат за приёмку · синтетический режим. Доступ
        только в области отдельного права.
      </p>
      {query.isPending ? (
        <p role="status">Загружаем начисления…</p>
      ) : query.isError ? (
        <p role="alert">Начисления недоступны. Повторите загрузку.</p>
      ) : items.length === 0 ? (
        <p className="tasks-state">В доступных областях пока нет начислений.</p>
      ) : (
        <ul className="tasks-list ledger-list">
          {items.map((item) => (
            <li key={item.reviewId}>
              <div className="ledger-entry">
                <strong>{item.task.title}</strong>
                <p>
                  {item.recipient.displayName} · {item.scope.name}
                </p>
                <p>
                  {number(item.xp)} XP · {number(item.points)} баллов · сезон{" "}
                  {item.seasonKey}
                </p>
                {item.correction ? (
                  <p>Возврат записан: {item.correction.reason}</p>
                ) : item.enabled ? (
                  <button
                    type="button"
                    className="tasks-action"
                    onClick={() => {
                      if (confirmLeave()) setSelected(item);
                    }}
                  >
                    Вернуть начисление
                  </button>
                ) : (
                  <p>Возврат недоступен.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          Показать ещё начисления
        </button>
      )}
    </div>
  );
}

export function LedgerCorrections() {
  const [open, setOpen] = useState(false);
  const { confirmLeave } = useAuthorizedSession();
  useTelegramBack(
    open,
    () => {
      if (confirmLeave()) setOpen(false);
    },
    20,
  );
  return (
    <section className="task-history" aria-label="Корректировки">
      <button
        type="button"
        className="tasks-action task-history-toggle"
        aria-expanded={open}
        onClick={() => {
          if (confirmLeave()) setOpen(!open);
        }}
      >
        Исправление начислений
      </button>
      {open && <CorrectionList />}
    </section>
  );
}
