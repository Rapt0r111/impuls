"use client";

import { apiErrorSchema, leaderboardResponseSchema } from "@impuls/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
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
// Инициалы по первым буквам слов: «И. Крылов» → «ИК», одно слово → две буквы.
const initials = (name: string) => {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
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
          <h2 id="ranking-title">Рейтинг месяца</h2>
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
        <div className="ranking-filters">
          <label className="tasks-filter">
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
          <label className="tasks-filter">
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
        </div>
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
                          <span>{number(item.rank)} место</span>
                          <strong>{item.displayName}</strong>
                          <b>{number(item.xp)}</b>
                          <small>XP</small>
                        </li>
                      ))}
                  </ol>
                )}
                <table className="ranking-table">
                  {/* Ширины колонок заданы явно: место не растягивается, имя переносится. */}
                  <colgroup>
                    <col className="ranking-col-rank" />
                    <col />
                    <col className="ranking-col-xp" />
                  </colgroup>
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
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        className={item.isSelf ? "ranking-own-row" : undefined}
                      >
                        <td>{number(item.rank)}</td>
                        <th scope="row">
                          {item.displayName}
                          {item.isSelf && (
                            <span className="ranking-you">Вы</span>
                          )}
                        </th>
                        <td>{number(item.xp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
