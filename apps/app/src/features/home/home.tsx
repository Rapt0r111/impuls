"use client";

import {
  leaderboardResponseSchema,
  taskListResponseSchema,
} from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import {
  ProfileError,
  useParticipantProfile,
} from "@/features/profile/participant-profile";
import "./home.css";

const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const dueLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
const asOfLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const priorityNames = {
  critical: "Критический",
  high: "Высокий",
  normal: "Штатный",
} as const;
const statusNames = {
  assigned: "Назначена",
  in_progress: "В работе",
  needs_work: "На доработке",
} as const;
type OpenStatus = keyof typeof statusNames;
const isOpen = (status: string): status is OpenStatus => status in statusNames;

type HomeTarget = "tasks" | "ledger";

export function Home({ onNavigate }: { onNavigate: (to: HomeTarget) => void }) {
  const { loseAccess } = useAuthorizedSession();
  const profile = useParticipantProfile();
  const tasks = useQuery({
    queryKey: ["home-tasks"],
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/tasks?limit=20", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new ProfileError(response.status);
      return taskListResponseSchema.parse(await response.json());
    },
  });
  // Сезонный XP — собственная строка рейтинга текущего месяца. Рейтинг может
  // быть выключен (404) или недоступен: тогда показатель просто не выводится.
  const season = useQuery({
    queryKey: ["home-season"],
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/leaderboard?limit=1", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new ProfileError(response.status);
      return leaderboardResponseSchema.parse(await response.json());
    },
  });
  useEffect(() => {
    for (const error of [profile.error, tasks.error, season.error])
      if (error instanceof ProfileError && [401, 403].includes(error.status)) {
        loseAccess(error.status);
        return;
      }
  }, [profile.error, tasks.error, season.error, loseAccess]);
  const data = profile.data;
  const level = data?.progression.level;
  // Ближайший срок среди задач, которые ещё ждут результата участника.
  const next = tasks.data?.items
    .filter((task) => isOpen(task.status))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return (
    <section className="tasks-section home" aria-labelledby="home-title">
      <div className="tasks-heading">
        <div>
          <h2 id="home-title">Главная</h2>
          <p>Ваш прогресс и ближайшая задача.</p>
        </div>
      </div>
      {profile.isPending ? <p role="status">Загружаем прогресс…</p> : null}
      {profile.isError ? (
        <p className="tasks-state" role="alert">
          {!navigator.onLine ? "Нет соединения. " : "Обновление не удалось. "}
          {data
            ? `Показаны данные на ${asOfLabel(data.asOf)}; изменения не проводятся.`
            : "Прогресс недоступен."}{" "}
          <button
            type="button"
            className="tasks-action"
            onClick={() => {
              void profile.refetch();
              void tasks.refetch();
              void season.refetch();
            }}
          >
            Повторить
          </button>
        </p>
      ) : null}
      {data ? (
        <>
          <div className="home-level">
            {level ? (
              <>
                <p className="home-level-top">
                  <strong>{level.level}</strong>
                  <span>уровень</span>
                  <b>{number(data.balance.lifetimeXp)} XP</b>
                </p>
                {level.nextLevelXp !== null ? (
                  <>
                    <progress
                      aria-label={`Прогресс до уровня ${level.level + 1}`}
                      max={level.spanXp!}
                      value={level.progressXp}
                    />
                    <p className="home-caption">
                      {number(level.progressXp)} / {number(level.spanXp!)} XP ·
                      до уровня {level.level + 1} ещё{" "}
                      {number(level.remainingXp)}
                    </p>
                  </>
                ) : (
                  <p className="home-caption">Достигнут последний уровень.</p>
                )}
              </>
            ) : (
              <p className="home-level-top">
                <strong>{number(data.balance.lifetimeXp)}</strong>
                <span>XP за всё время</span>
              </p>
            )}
          </div>
          <dl className="ledger-balances home-balances">
            {season.data?.self ? (
              <div>
                <dt>XP за {season.data.season}</dt>
                <dd>{number(season.data.self.xp)}</dd>
              </div>
            ) : null}
            <div>
              <dt>доступно баллов</dt>
              <dd>{number(data.balance.availablePoints)}</dd>
            </div>
            <div>
              <dt>в резерве по заявкам</dt>
              <dd>{number(data.balance.reservedPoints)}</dd>
            </div>
          </dl>
          <p className="home-caption">Данные на {asOfLabel(data.asOf)}</p>
        </>
      ) : null}
      <h3 className="home-next-title">Ваш следующий результат</h3>
      {tasks.isPending ? (
        <p role="status">Загружаем задачи…</p>
      ) : tasks.isError && !tasks.data ? (
        <p className="tasks-state" role="alert">
          Задачи недоступны. Откройте раздел «Задачи» и повторите.
        </p>
      ) : next && isOpen(next.status) ? (
        <button
          type="button"
          className="tasks-row home-next"
          onClick={() => onNavigate("tasks")}
        >
          <span className="tasks-row-main">
            <span className="tasks-row-tags">
              <span className={`task-chip task-chip--${next.priority}`}>
                {priorityNames[next.priority]}
              </span>
              <span className="task-chip task-chip--status">
                {statusNames[next.status]}
              </span>
            </span>
            <strong>{next.title}</strong>
            <span>до {dueLabel(next.dueAt)}</span>
          </span>
          <span className="tasks-row-fund">
            <strong>{number(next.fundXp)} XP</strong>
            <span>{number(next.fundPoints)} баллов</span>
          </span>
        </button>
      ) : (
        <p className="tasks-state">
          Открытых задач нет. Новые назначения появятся в разделе «Задачи».
        </p>
      )}
      <div className="home-links">
        <button
          type="button"
          className="tasks-action"
          onClick={() => onNavigate("tasks")}
        >
          Все задачи
        </button>
        <button
          type="button"
          className="tasks-action"
          onClick={() => onNavigate("ledger")}
        >
          Журнал начислений
        </button>
      </div>
    </section>
  );
}
