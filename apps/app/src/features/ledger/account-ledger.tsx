"use client";

import { accountLedgerResponseSchema } from "@impuls/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { LedgerCorrections } from "./ledger-corrections";

class LedgerError extends Error {
  constructor(readonly status: number) {
    super("Ledger request failed");
  }
}
async function load(cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/me/ledger?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new LedgerError(response.status);
  return accountLedgerResponseSchema.parse(await response.json());
}
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);

export function AccountLedger() {
  const { loseAccess, canCorrectLedger } = useAuthorizedSession();
  const query = useInfiniteQuery({
    queryKey: ["account-ledger"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => load(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  useEffect(() => {
    if (
      query.error instanceof LedgerError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const first = query.data?.pages[0];
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <section className="tasks-section" aria-labelledby="ledger-title">
      <div className="tasks-heading">
        <div>
          <h2 id="ledger-title">Баланс и журнал</h2>
          <p>XP растёт за принятые задачи, баллы тратятся на поощрения.</p>
        </div>
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить журнал
        </button>
      </div>
      {query.isPending ? (
        <p role="status">Загружаем журнал…</p>
      ) : (
        <>
          {query.isError && (
            <p className="tasks-state" role="alert">
              {!navigator.onLine
                ? "Нет соединения. Восстановите сеть и обновите журнал."
                : "Журнал недоступен. Повторите загрузку."}
              {first && " Показаны последние подтверждённые значения."}
            </p>
          )}
          {first && (
            <>
              <dl className="ledger-balances">
                <div>
                  <dt>XP всего</dt>
                  <dd>{number(first.balance.lifetimeXp)} XP</dd>
                </div>
                <div>
                  <dt>Баллы</dt>
                  <dd>{number(first.balance.availablePoints)}</dd>
                </div>
                <div>
                  <dt>В резерве</dt>
                  <dd>{number(first.balance.reservedPoints)}</dd>
                </div>
              </dl>
              {entries.length === 0 ? (
                <p className="tasks-state">
                  Начислений пока нет. Они появятся после приёмки результата.
                </p>
              ) : (
                <ul className="tasks-list ledger-list">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <div className="ledger-entry">
                        <div className="ledger-entry-text">
                          <strong>
                            {entry.task?.title ?? entry.reward?.title}
                          </strong>
                          <p>
                            {entry.reward
                              ? entry.kind === "reward_reservation"
                                ? "Отложено под заявку"
                                : entry.kind === "reward_approval"
                                  ? "Списано после одобрения"
                                  : "Возвращено"
                              : entry.reason}
                          </p>
                          {entry.reward &&
                            entry.kind !== "reward_reservation" && (
                              <p>{entry.reason}</p>
                            )}
                          {entry.correction && (
                            <p>
                              Начисление отменено ·{" "}
                              {entry.correction.actor.displayName}
                            </p>
                          )}
                          <p>
                            <time dateTime={entry.createdAt}>
                              {date(entry.createdAt)}
                            </time>
                          </p>
                        </div>
                        <span
                          className={`ledger-amount${
                            entry.currency === "xp"
                              ? " ledger-xp"
                              : entry.amount < 0
                                ? " ledger-spent"
                                : entry.amount === 0
                                  ? " ledger-zero"
                                  : ""
                          }`}
                        >
                          {entry.reward && entry.amount === 0
                            ? `−${number(Math.abs(entry.reservedDelta))} из резерва`
                            : `${entry.amount >= 0 ? "+" : ""}${number(entry.amount)} ${
                                entry.currency === "xp" ? "XP" : "баллов"
                              }`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              className="tasks-action tasks-more"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              Показать ещё записи
            </button>
          )}
        </>
      )}
      {canCorrectLedger && <LedgerCorrections />}
    </section>
  );
}
