"use client";

import { participantProfileResponseSchema } from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import "./participant-profile.css";

export class ProfileError extends Error {
  constructor(readonly status: number) {
    super("Profile unavailable");
  }
}
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));

export function useParticipantProfile() {
  return useQuery({
    queryKey: ["participant-profile"],
    retry: false,
    networkMode: "always",
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/me/profile", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new ProfileError(response.status);
      return participantProfileResponseSchema.parse(await response.json());
    },
  });
}

export function ParticipantProfile() {
  const { loseAccess } = useAuthorizedSession();
  const query = useParticipantProfile();
  useEffect(() => {
    if (
      query.error instanceof ProfileError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const hidden =
    query.error instanceof ProfileError &&
    [401, 403, 404].includes(query.error.status);
  const data = hidden ? undefined : query.data;
  const level = data?.progression.level;
  return (
    <section
      className="tasks-section participant-profile"
      aria-labelledby="profile-title"
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <div>
          <h2 id="profile-title">Мой профиль</h2>
          <p>Синтетический режим · подтверждённые результаты.</p>
        </div>
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить профиль
        </button>
      </div>
      {query.isPending ? <p role="status">Загружаем профиль…</p> : null}
      {query.isError ? (
        <p className="tasks-state" role="alert">
          {query.error instanceof ProfileError && query.error.status === 404
            ? "Синтетический профиль выключен."
            : !navigator.onLine
              ? "Нет соединения. Восстановите сеть и обновите профиль."
              : "Профиль недоступен. Повторите загрузку."}
          {data ? " Показаны последние подтверждённые значения." : ""}
        </p>
      ) : null}
      {data ? (
        <>
          <dl className="ledger-balances">
            <div>
              <dt>XP за всё время</dt>
              <dd>{number(data.balance.lifetimeXp)} XP</dd>
            </div>
          </dl>
          <p className="ledger-asof">
            Подтверждено сервером: {date(data.asOf)} МСК
          </p>
          <section
            className="profile-block"
            aria-labelledby="profile-level-title"
          >
            <h3 id="profile-level-title">Уровень</h3>
            {level ? (
              <>
                <p className="profile-level">
                  <strong className="sr-only">Уровень {level.level}</strong>
                  <span className="profile-level-number" aria-hidden="true">
                    {level.level}
                  </span>
                  <span>уровень · правила {data.progression.ruleVersion}</span>
                </p>
                {level.nextLevelXp === null ? (
                  <p>Достигнут последний настроенный уровень.</p>
                ) : (
                  <>
                    <label htmlFor="profile-progress">
                      До уровня {level.level + 1}: {number(level.remainingXp)}{" "}
                      XP
                    </label>
                    <progress
                      id="profile-progress"
                      max={level.spanXp!}
                      value={level.progressXp}
                    />
                    <p className="profile-level-caption">
                      {number(level.progressXp)} / {number(level.spanXp!)} XP ·
                      порог следующего уровня {number(level.nextLevelXp)} XP за
                      всё время.
                    </p>
                  </>
                )}
                <p>
                  Расчёт учитывает исправления начислений. Смена месяца не
                  сбрасывает XP.
                </p>
              </>
            ) : (
              <p>
                {data.progression.state === "invalid"
                  ? "Пороги уровней в текущей версии правил некорректны. Сообщите администратору."
                  : "Уровни ещё не настроены в синтетических правилах."}
              </p>
            )}
          </section>
          <section
            className="profile-block"
            aria-labelledby="profile-achievement-title"
          >
            <h3 id="profile-achievement-title">Первый результат</h3>
            {data.firstResult ? (
              <>
                <p className="profile-result-status">
                  <strong>
                    {data.firstResult.sourceCorrected
                      ? "Исходное начисление возвращено"
                      : "Получено"}
                  </strong>
                </p>
                <p>{data.firstResult.task.title}</p>
                <p>
                  {date(data.firstResult.grantedAt)} МСК · условие{" "}
                  {data.firstResult.conditionVersion}
                </p>
                {data.firstResult.sourceCorrected ? (
                  <p>
                    Сохранено основание первого результата. Начисление по нему
                    исправлено; активность достижения требует решения правил.
                  </p>
                ) : null}
                {data.firstResult.provenance === "migration" ? (
                  <p>
                    Восстановлено по первой сохранённой приёмке при миграции.
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                Пока не получено. Появится после первой приёмки результата
                командиром.
              </p>
            )}
            <p>
              Косметическое достижение выдаётся один раз и не добавляет XP или
              баллы.
            </p>
          </section>
        </>
      ) : null}
    </section>
  );
}
