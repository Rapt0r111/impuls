"use client";

import { apiErrorSchema, leaderboardResponseSchema } from "@impuls/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { initials } from "@/shared/ui/initials";
import "./leaderboard.css";

class RankingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Ranking request failed");
  }
}
async function load(
  scope: string,
  season: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "20" });
  if (scope) params.set("scope", scope);
  if (season) params.set("season", season);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/leaderboard?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(await response.json());
    throw new RankingError(
      response.status,
      error.success ? error.data.code : "UNAVAILABLE",
    );
  }
  return leaderboardResponseSchema.parse(await response.json());
}
// «2026-10» → «Октябрь 2026»: заголовок месяца как на концепте.
const monthTitle = (value: string) => {
  const [year = 1970, month = 1] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const text = label.replace(/\s*г\.?$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
// Соседний месяц для кнопок-стрелок: «2026-10» → «2026-09».
const shiftSeason = (value: string, delta: number) => {
  const [year = 1970, month = 1] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
};
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
const date = (s: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(s));

export function Leaderboard() {
  const { loseAccess } = useAuthorizedSession();
  const [scope, setScope] = useState("");
  const [season, setSeason] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["leaderboard", scope, season],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => load(scope, season, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    networkMode: "always",
    // Current month may roll over while the workspace remains mounted.
    staleTime: 0,
  });
  const error = query.error;
  const accessError =
    error instanceof RankingError && [401, 403].includes(error.status);
  const hidden = error instanceof RankingError && error.status === 404;
  useEffect(() => {
    if (accessError && error instanceof RankingError) loseAccess(error.status);
  }, [accessError, error, loseAccess]);
  const first = !accessError && !hidden ? query.data?.pages[0] : undefined;
  const items = first ? query.data!.pages.flatMap((page) => page.items) : [];
  // Самый поздний месяц — текущий по Москве: будущие месяцы выбрать нельзя.
  const latest = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const mine = items.findIndex((item) => item.isSelf);
  const ahead = mine > 0 ? items[mine - 1] : undefined;
  const gap = ahead ? ahead.xp - (items[mine]?.xp ?? ahead.xp) : 0;
  const changed = error instanceof RankingError && error.status === 409;
  const disabled =
    error instanceof RankingError && error.code === "RANKING_DISABLED";
  return (
    <section
      className="tasks-section ranking-section"
      aria-labelledby="ranking-title"
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <div>
          <h2 id="ranking-title">Рейтинг</h2>
          <p>Синтетический режим · подтверждённый XP вашей области.</p>
        </div>
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить рейтинг
        </button>
      </div>
      {first && (
        <>
          <div className="ranking-month">
            <button
              type="button"
              className="ranking-step"
              aria-label="Предыдущий месяц"
              onClick={() => {
                setScope(scope || first.scope?.id || "");
                setSeason(shiftSeason(season || first.season, -1));
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14.5 6-6 6 6 6" />
              </svg>
            </button>
            <label className="ranking-month-field">
              <span className="ranking-month-value" aria-hidden="true">
                {monthTitle(season || first.season)}
              </span>
              <span>Месяц · Москва</span>
              <input
                type="month"
                value={season || first.season}
                min="1000-01"
                max="9999-12"
                onChange={(event) => {
                  if (event.target.validity.valid && event.target.value) {
                    setScope(scope || first.scope?.id || "");
                    setSeason(event.target.value);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="ranking-step"
              aria-label="Следующий месяц"
              disabled={(season || first.season) >= latest}
              onClick={() => {
                setScope(scope || first.scope?.id || "");
                setSeason(shiftSeason(season || first.season, 1));
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9.5 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          {first.scopes.length !== 1 ? (
            <label className="tasks-filter ranking-scope">
              <span id="ranking-scope-label">Область</span>
              <select
                aria-labelledby="ranking-scope-label"
                value={scope || first.scope?.id || ""}
                onChange={(event) => {
                  setScope(event.target.value);
                  setSeason(season || first.season);
                }}
                disabled={first.scopes.length === 0}
              >
                {first.scopes.length === 0 ? (
                  <option value="">Нет доступных областей</option>
                ) : (
                  first.scopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <p className="ranking-scope-name">{first.scopes[0]?.name}</p>
          )}
        </>
      )}
      {query.isPending && (
        <p className="tasks-state" role="status">
          Загружаем рейтинг…
        </p>
      )}
      {query.isError && (
        <p className="tasks-state" role="alert">
          {disabled
            ? "Синтетический рейтинг выключен. Его доступность определяет тестовый контур."
            : accessError
              ? "Доступ изменился. Повторите вход."
              : hidden
                ? "Область больше недоступна. Откройте рейтинг заново."
                : changed
                  ? "Рейтинг изменился между страницами. Обновите список с начала."
                  : !navigator.onLine
                    ? "Нет соединения. Восстановите сеть и обновите рейтинг."
                    : "Рейтинг недоступен. Повторите загрузку."}
          {first && " Показан последний подтверждённый расчёт."}
        </p>
      )}
      {hidden && !disabled && (
        <button
          type="button"
          className="tasks-action"
          onClick={() => {
            if (scope || season) {
              setScope("");
              setSeason("");
            } else void query.refetch();
          }}
        >
          Открыть доступные области
        </button>
      )}
      {first && (
        <>
          {first.self ? (
            <p className="ranking-self">
              Ваш результат: <strong>{number(first.self.xp)} XP</strong>
              <span>
                {first.self.rank
                  ? `Место ${number(first.self.rank)}`
                  : "Место появится после начисления XP"}
              </span>
            </p>
          ) : (
            <p className="tasks-state">
              Синтетических областей пока нет. Тестовый состав задаётся
              отдельно.
            </p>
          )}
          {first.scope &&
            (items.length === 0 ? (
              <p className="tasks-state">
                В этом месяце ещё нет положительного XP. Результаты появятся
                после приёмки задач.
              </p>
            ) : (
              <>
                {items.length >= 3 && (
                  // Декоративный пьедестал; данные доступны в таблице ниже.
                  <ol className="ranking-podium" aria-hidden="true">
                    {[1, 0, 2]
                      .flatMap((index) => items[index] ?? [])
                      .map((item) => (
                        <li
                          key={item.id}
                          className={
                            item.rank === 1 ? "ranking-podium-first" : ""
                          }
                        >
                          <span className="ranking-podium-badge">
                            {initials(item.displayName)}
                          </span>
                          <strong>{item.displayName}</strong>
                          <b>{number(item.xp)}</b>
                          <span className="ranking-podium-bar">
                            {number(item.rank)}
                          </span>
                        </li>
                      ))}
                  </ol>
                )}
                <table className="ranking-table">
                  <caption className="ranking-note">
                    Места при равном XP совпадают. Нулевые результаты видны
                    только вам.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Место</th>
                      <th scope="col">Участник</th>
                      <th scope="col">XP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr
                        key={item.id}
                        className={
                          [
                            item.isSelf ? "ranking-own-row" : "",
                            items.length >= 3 && index < 3 ? "ranking-top" : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      >
                        <td>{number(item.rank)}</td>
                        <th scope="row">
                          <span className="ranking-person">
                            <span className="ranking-avatar" aria-hidden="true">
                              {initials(item.displayName)}
                            </span>
                            <span className="ranking-name">
                              {item.displayName}
                              {item.isSelf && (
                                <span className="ranking-you">Вы</span>
                              )}
                            </span>
                          </span>
                        </th>
                        <td>{number(item.xp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ahead && gap > 0 ? (
                  <p className="ranking-hint">
                    До {number(ahead.rank)} места — {number(gap)} XP.
                  </p>
                ) : null}
              </>
            ))}
          {first.scope && (
            <p className="ledger-asof">
              Расчёт: {date(first.updatedAt)} (Москва). Возвраты XP учтены в
              исходном месяце. Это текущий расчёт журнала, в том числе для
              прошлых месяцев.
            </p>
          )}
          {query.hasNextPage && !changed && (
            <button
              type="button"
              className="tasks-action tasks-more"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              Показать ещё участников
            </button>
          )}
        </>
      )}
    </section>
  );
}
