"use client";

import {
  leaderboardResponseSchema,
  taskListResponseSchema,
} from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { initials } from "@/shared/ui/initials";
import {
  ProfileError,
  useParticipantProfile,
} from "@/features/profile/participant-profile";
import "./home.css";

const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const dayLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
// «Сегодня до 18:00» или «до 10 окт., 18:00»: срок читается без расчёта в уме.
const dueText = (value: string) =>
  sameDay(new Date(value), new Date())
    ? `Сегодня до ${timeLabel(value)}`
    : `до ${dayLabel(value)}, ${timeLabel(value)}`;
// «· осталось 3 ч 20 мин» — только для срока сегодня, который ещё не наступил.
const remainingText = (value: string) => {
  const now = new Date();
  const due = new Date(value);
  const minutes = Math.floor((due.getTime() - now.getTime()) / 60000);
  if (minutes <= 0 || !sameDay(due, now)) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return ` · осталось ${hours > 0 ? `${hours} ч ${rest} мин` : `${rest} мин`}`;
};
// В приветствии — имя, как на концепте; полное имя остаётся в профиле.
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const asOfLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
// Приветствие считается на клиенте после входа, поэтому серверная разметка с ним не расходится.
const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  return hour < 18 ? "Добрый день" : "Добрый вечер";
};
const statusNames = {
  assigned: "Назначена",
  in_progress: "В работе",
  needs_work: "На доработке",
} as const;
type OpenStatus = keyof typeof statusNames;
const isOpen = (status: string): status is OpenStatus => status in statusNames;

type HomeTarget = "tasks" | "ledger";

export function Home({ onNavigate }: { onNavigate: (to: HomeTarget) => void }) {
  const { loseAccess, user } = useAuthorizedSession();
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
  const open =
    tasks.data?.items
      .filter((task) => isOpen(task.status))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)) ?? [];
  const next = open[0];
  const others = open.slice(1, 4);
  return (
    <section className="tasks-section home" aria-labelledby="home-title">
      <div className="tasks-heading">
        <div>
          <h2 id="home-title">Главная</h2>
          <p>Ваш прогресс и ближайшая задача.</p>
        </div>
      </div>
      <header className="home-greeting">
        <span className="access-avatar" aria-hidden="true">
          {initials(user.displayName)}
        </span>
        <div>
          <span className="access-greeting">{greeting()}</span>
          <strong>{firstName(user.displayName)}</strong>
        </div>
        {level ? (
          <span className="task-chip home-level-chip">
            Уровень {level.level}
          </span>
        ) : null}
      </header>
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

      <section className="home-next" aria-labelledby="home-next-title">
        <div className="home-next-top">
          <h3 id="home-next-title">Ближайший срок</h3>
          {next && isOpen(next.status) ? (
            <span
              className={`task-chip task-chip--status task-chip--${next.status}`}
            >
              {statusNames[next.status]}
            </span>
          ) : null}
        </div>
        {tasks.isPending ? (
          <p role="status">Загружаем задачи…</p>
        ) : tasks.isError && !tasks.data ? (
          <p role="alert">
            Задачи недоступны. Откройте раздел «Задачи» и повторите.
          </p>
        ) : next && isOpen(next.status) ? (
          <>
            <strong className="home-next-name">{next.title}</strong>
            <p className="home-next-due">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
              {dueText(next.dueAt)}
              {remainingText(next.dueAt)}
            </p>
            <button
              type="button"
              className="access-button home-next-cta"
              onClick={() => onNavigate("tasks")}
            >
              Открыть задачу
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <p className="home-next-empty">
              Открытых задач нет. Новые назначения появятся в разделе «Задачи».
            </p>
            <button
              type="button"
              className="access-button access-button--quiet home-next-cta"
              onClick={() => onNavigate("tasks")}
            >
              Все задачи
            </button>
          </>
        )}
      </section>

      {data ? (
        <>
          <div className="home-stats">
            <div className="home-level">
              {level ? (
                <>
                  {/* Кольцо дублирует полосу прогресса ниже и скрыто от
                      скринридеров; 214 — длина окружности радиуса 34. */}
                  <div className="home-ring" aria-hidden="true">
                    <svg viewBox="0 0 80 80">
                      <defs>
                        <linearGradient
                          id="home-ring-gradient"
                          x1="0"
                          y1="0"
                          x2="1"
                          y2="1"
                        >
                          <stop offset="0" stopColor="#9af7de" />
                          <stop offset="1" stopColor="#2fc9a2" />
                        </linearGradient>
                      </defs>
                      <circle
                        className="home-ring-track"
                        cx="40"
                        cy="40"
                        r="34"
                      />
                      <circle
                        className="home-ring-value"
                        cx="40"
                        cy="40"
                        r="34"
                        transform="rotate(-90 40 40)"
                        style={{
                          strokeDashoffset:
                            level.nextLevelXp !== null && level.spanXp
                              ? 214 * (1 - level.progressXp / level.spanXp)
                              : 0,
                        }}
                      />
                    </svg>
                    <strong>{level.level}</strong>
                  </div>
                  <p className="home-level-top">
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
                        {number(level.remainingXp)} XP до уровня{" "}
                        {level.level + 1}
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
            <div className="home-points-card">
              <span className="home-points-label">Баллы</span>
              <strong aria-label="Доступно баллов">
                {number(data.balance.availablePoints)}
              </strong>
              <span className="home-caption">
                {number(data.balance.reservedPoints)} в резерве
              </span>
            </div>
          </div>
          {season.data?.self ? (
            <dl className="home-season">
              <dt>XP за {season.data.season}</dt>
              <dd>{number(season.data.self.xp)}</dd>
            </dl>
          ) : null}
          <p className="home-caption">Данные на {asOfLabel(data.asOf)}</p>
        </>
      ) : null}

      {others.length > 0 ? (
        <div className="home-more">
          <div className="home-more-head">
            <h3>Ещё в работе</h3>
            <button
              type="button"
              className="home-more-all"
              onClick={() => onNavigate("tasks")}
            >
              Все задачи
            </button>
          </div>
          <ul className="home-more-list">
            {others.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="home-more-row"
                  onClick={() => onNavigate("tasks")}
                >
                  <span>
                    <strong>{task.title}</strong>
                    <span>{dueText(task.dueAt)}</span>
                  </span>
                  <span
                    className={`task-chip task-chip--status task-chip--${task.status}`}
                  >
                    {statusNames[task.status as OpenStatus]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
