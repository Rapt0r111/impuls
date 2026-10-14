"use client";

import {
  leaderboardResponseSchema,
  reviewListResponseSchema,
  taskListResponseSchema,
} from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

type HomeTarget = "tasks" | "ledger" | "reviews";

// «2026-10» → «в октябре»: месяц рейтинга словами, без технического кода.
const seasonLabel = (season: string) => {
  const [year, month] = season.split("-").map(Number);
  if (!year || !month) return season;
  const name = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  return `XP за ${name}`;
};

// Подсказка новичку видна, пока нет ни одного начисления; её можно скрыть.
const GUIDE_KEY = "impuls.home.guide.hidden";
function readGuideHidden() {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function HowItWorks({ onHide }: { onHide: () => void }) {
  return (
    <section className="home-guide" aria-labelledby="home-guide-title">
      <h3 id="home-guide-title">Как это работает</h3>
      <ol>
        <li>
          Командир назначает вам задачу, или вы берёте свободную в разделе
          «Задачи».
        </li>
        <li>
          Откройте задачу, нажмите «Начать работу», затем отправьте отчёт.
        </li>
        <li>Проверяющий принимает отчёт, и вы получаете XP и баллы.</li>
        <li>
          XP поднимает вас в рейтинге, а баллы можно обменять в разделе
          «Поощрения».
        </li>
      </ol>
      <button type="button" className="home-guide-hide" onClick={onHide}>
        Понятно, скрыть
      </button>
    </section>
  );
}

export function Home({ onNavigate }: { onNavigate: (to: HomeTarget) => void }) {
  const { loseAccess, user, canReview } = useAuthorizedSession();
  // Проверяющему очередь видна сразу на главной: сколько отчётов ждёт и кнопка входа.
  const waiting = useQuery({
    queryKey: ["home-review-waiting"],
    enabled: canReview === true,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/reviews?limit=20", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new ProfileError(response.status);
      const page = reviewListResponseSchema.parse(await response.json());
      return { count: page.items.length, more: page.nextCursor !== null };
    },
  });
  const profile = useParticipantProfile();
  // «Главная» появляется только после входа на клиенте, поэтому хранилище читается сразу.
  const [guideHidden, setGuideHidden] = useState(readGuideHidden);
  const hideGuide = () => {
    setGuideHidden(true);
    try {
      window.localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // Без хранилища подсказка просто вернётся при следующем запуске.
    }
  };
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
  const reviewCount = waiting.data?.count ?? 0;
  // Карточка очереди видна, только когда есть что проверять (или число не
  // загрузилось): пустая очередь не занимает экран и не даёт пустой кнопки.
  const showReview =
    canReview === true &&
    ((waiting.data && reviewCount > 0) || (waiting.isError && !waiting.data));
  return (
    <section className="tasks-section home" aria-labelledby="home-title">
      <div className="tasks-heading">
        <div>
          <h2 id="home-title">Главная</h2>
          <p>Ваш прогресс и ближайшая задача.</p>
        </div>
      </div>
      <div className="home-top" aria-hidden="true">
        <span className="home-logo">И</span>
        <span className="home-brand">Импульс</span>
      </div>
      <header className="home-greeting">
        <span className="home-avatar" aria-hidden="true">
          {initials(user.displayName)}
        </span>
        <div>
          <span className="home-hello">{greeting()}</span>
          <strong>{firstName(user.displayName)}</strong>
        </div>
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
              className="home-cta"
              onClick={() => onNavigate("tasks")}
            >
              Открыть задачу
            </button>
          </>
        ) : (
          // Без задач кнопки нет: открывать нечего, раздел «Задачи» — в меню.
          <p className="home-next-empty">
            Открытых задач нет. Новые назначения и свободные задачи появятся в
            разделе «Задачи».
          </p>
        )}
      </section>

      {showReview ? (
        <section className="home-review" aria-labelledby="home-review-title">
          <div>
            <h3 id="home-review-title">Очередь проверки</h3>
            <p>
              {waiting.data
                ? `Ждут решения: ${reviewCount}${waiting.data.more ? " и больше" : ""}.`
                : "Число не загрузилось, очередь можно открыть."}
            </p>
          </div>
          <button
            type="button"
            className="home-cta home-cta--accent"
            onClick={() => onNavigate("reviews")}
          >
            Открыть очередь
          </button>
        </section>
      ) : null}

      {data ? (
        <>
          <div className="home-stats">
            <div className="home-tile home-level">
              <div className="home-tile-head">
                <span className="home-tile-label">XP за всё время</span>
                <span className="home-tile-chip" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                  </svg>
                </span>
              </div>
              <strong className="home-tile-value">
                {number(data.balance.lifetimeXp)}
              </strong>
              {level ? (
                <span className="home-tile-sub">
                  Уровень {level.level}
                  {level.nextLevelXp !== null ? (
                    <>
                      {" "}
                      · ещё {number(level.remainingXp)} XP
                      {/* Полоса для скринридеров; видимый прогресс — подпись. */}
                      <progress
                        aria-label={`Прогресс до уровня ${level.level + 1}`}
                        max={level.spanXp!}
                        value={level.progressXp}
                      />
                    </>
                  ) : (
                    " · последний"
                  )}
                </span>
              ) : (
                <span className="home-tile-sub" aria-hidden="true" />
              )}
            </div>
            <div className="home-tile home-points-card">
              <div className="home-tile-head">
                <span className="home-tile-label">Баллы</span>
                <span className="home-tile-chip" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M14.5 9.2a2.8 2.8 0 0 0-2.5-1.2c-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.5 1.9a2.9 2.9 0 0 1-2.7-1.4M12 6.5v1.3M12 16.2v1.3" />
                  </svg>
                </span>
              </div>
              <strong className="home-tile-value" aria-label="Доступно баллов">
                {number(data.balance.availablePoints)}
              </strong>
              <span className="home-tile-sub">
                {number(data.balance.reservedPoints)} в резерве
              </span>
            </div>
          </div>
          {season.data?.self ? (
            <dl className="home-season">
              <dt>
                <span className="home-season-dot" aria-hidden="true" />
                {seasonLabel(season.data.season)}
              </dt>
              <dd>{number(season.data.self.xp)}</dd>
            </dl>
          ) : null}
        </>
      ) : null}

      {!guideHidden && data && data.balance.lifetimeXp === 0 ? (
        <HowItWorks onHide={hideGuide} />
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
