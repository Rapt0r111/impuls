"use client";

import {
  accountLedgerResponseSchema,
  leaderboardResponseSchema,
  redemptionListResponseSchema,
  reviewListResponseSchema,
  taskListResponseSchema,
} from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import {
  ProfileError,
  useParticipantProfile,
} from "@/features/profile/participant-profile";
import { useOpenTasks } from "@/features/tasks/open-tasks";
import {
  Arrow,
  Chevron,
  Info,
  Pulse,
  PlusCircle,
  ReviewList,
  Star,
} from "./home-icons";
import { LevelUp } from "./home-level-up";
import {
  buildNotes,
  readReadNotes,
  taskWord,
  writeReadNotes,
  type NoteTarget,
} from "./home-notes";
import { HelpSheet, LevelSheet, PointsSheet, percent } from "./home-sheets";
import { HomeTopBar } from "./home-topbar";
import "./home.css";

const asOfLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

type HomeTarget = "tasks" | "ledger" | "reviews" | "profile" | "rewards";

// «2026-10» → «XP за октябрь»: месяц рейтинга словами, без технического кода.
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
    <section className="guide" aria-labelledby="home-guide-title">
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
      <button type="button" className="guide-hide" onClick={onHide}>
        Понятно, скрыть
      </button>
    </section>
  );
}

// Последний показанный уровень хранится на устройстве по участнику: экран нового
// уровня виден один раз после повышения, а при первом запуске ничего не празднуется.
const levelKey = (userId: string) => `impuls.home.level.seen.${userId}`;
function readSeenLevel(userId: string) {
  try {
    const raw = window.localStorage.getItem(levelKey(userId));
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}
function writeSeenLevel(userId: string, level: number) {
  try {
    window.localStorage.setItem(levelKey(userId), String(level));
  } catch {
    // Без хранилища экран может появиться снова при следующем запуске.
  }
}

const getJson = async (url: string, signal: AbortSignal) => {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new ProfileError(response.status);
  return response.json() as Promise<unknown>;
};

export function Home({ onNavigate }: { onNavigate: (to: HomeTarget) => void }) {
  const { loseAccess, user, canReview, canManageRules } =
    useAuthorizedSession();
  // Проверяющему очередь видна сразу на главной: сколько отчётов ждёт и кнопка входа.
  const waiting = useQuery({
    queryKey: ["home-review-waiting"],
    enabled: canReview === true,
    retry: false,
    queryFn: async ({ signal }) => {
      const page = reviewListResponseSchema.parse(
        await getJson("/api/v1/reviews?limit=20", signal),
      );
      return { count: page.items.length, more: page.nextCursor !== null };
    },
  });
  const profile = useParticipantProfile();
  const freeTasks = useOpenTasks();
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
    queryFn: async ({ signal }) =>
      taskListResponseSchema.parse(
        await getJson("/api/v1/tasks?limit=20", signal),
      ),
  });
  // Сезонный XP — собственная строка рейтинга текущего месяца. Рейтинг может
  // быть выключен (404) или недоступен: тогда показатель просто не выводится.
  const season = useQuery({
    queryKey: ["home-season"],
    retry: false,
    queryFn: async ({ signal }) =>
      leaderboardResponseSchema.parse(
        await getJson("/api/v1/leaderboard?limit=1", signal),
      ),
  });
  // Источники колокольчика: свежие начисления и решения по заявкам.
  const ledger = useQuery({
    queryKey: ["home-ledger"],
    retry: false,
    queryFn: async ({ signal }) =>
      accountLedgerResponseSchema.parse(
        await getJson("/api/v1/me/ledger?limit=10", signal),
      ),
  });
  const redemptions = useQuery({
    queryKey: ["home-redemptions"],
    retry: false,
    queryFn: async ({ signal }) =>
      redemptionListResponseSchema.parse(
        await getJson("/api/v1/me/redemptions?limit=10", signal),
      ),
  });
  // Потерю доступа определяют основные запросы; колокольчик — лишь дополнение и
  // при своей ошибке просто остаётся пустым.
  useEffect(() => {
    for (const error of [profile.error, tasks.error, season.error])
      if (error instanceof ProfileError && [401, 403].includes(error.status)) {
        loseAccess(error.status);
        return;
      }
  }, [profile.error, tasks.error, season.error, loseAccess]);

  // Фон, цвета и свечение «Главной» включаются только пока она открыта.
  useEffect(() => {
    document.documentElement.dataset.view = "home";
    return () => {
      delete document.documentElement.dataset.view;
    };
  }, []);

  const [sheet, setSheet] = useState<"level" | "points" | "help" | null>(null);
  const [read, setRead] = useState<string[]>(readReadNotes);
  const notes = useMemo(
    () =>
      buildNotes({
        ledger: ledger.data,
        tasks: tasks.data,
        redemptions: redemptions.data,
      }),
    [ledger.data, tasks.data, redemptions.data],
  );
  const readSet = useMemo(() => new Set(read), [read]);
  const markRead = (ids: string[]) => {
    const next = [...new Set([...read, ...ids])];
    setRead(next);
    writeReadNotes(next);
  };

  const data = profile.data;
  const level = data?.progression.level ?? null;
  const levelNumber = level?.level ?? null;
  // Уровень, с которого начинается отсчёт: сохранённый на устройстве, а при первом
  // запуске — первый загруженный (тогда ничего не празднуется).
  const [baseline, setBaseline] = useState<number | null>(() =>
    readSeenLevel(user.id),
  );
  if (baseline === null && levelNumber !== null) setBaseline(levelNumber);
  const celebrating =
    levelNumber !== null && baseline !== null && levelNumber > baseline;
  useEffect(() => {
    if (levelNumber !== null && !celebrating)
      writeSeenLevel(user.id, levelNumber);
  }, [levelNumber, celebrating, user.id]);
  const closeCelebration = () => setBaseline(levelNumber);

  const open = freeTasks.data ?? [];
  const freeXp = open.length
    ? Math.max(...open.map((task) => task.fundXp))
    : null;
  const reviewCount = waiting.data?.count ?? 0;
  // Карточка очереди видна, только когда есть что проверять (или число не
  // загрузилось): пустая очередь не занимает экран и не даёт пустой кнопки.
  const showReview =
    canReview === true &&
    ((waiting.data && reviewCount > 0) || (waiting.isError && !waiting.data));
  const go = (to: HomeTarget) => {
    setSheet(null);
    onNavigate(to);
  };
  const openNote = (target: NoteTarget) => go(target);
  const pct = level ? Math.round(percent(level)) : 0;

  return (
    <section className="home" aria-labelledby="home-title">
      <div className="tasks-heading">
        <div>
          <h2 id="home-title">Главная</h2>
          <p>Ваш прогресс и уровень.</p>
        </div>
      </div>
      <HomeTopBar
        name={user.displayName}
        notes={notes}
        read={readSet}
        onMark={(id) => markRead([id])}
        onMarkAll={() => markRead(notes.map((note) => note.id))}
        onOpenNote={openNote}
        onProfile={() => go("profile")}
        onHelp={() => setSheet("help")}
      />

      <div className="wrap">
        {profile.isPending ? (
          <p role="status" className="state">
            Загружаем прогресс…
          </p>
        ) : null}
        {profile.isError ? (
          <p className="state" role="alert">
            {!navigator.onLine ? "Нет соединения. " : "Обновление не удалось. "}
            {data
              ? `Показаны данные на ${asOfLabel(data.asOf)}; изменения не проводятся.`
              : "Прогресс недоступен."}{" "}
            <button
              type="button"
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

        {data && level ? (
          <button
            type="button"
            className="level rise"
            style={{ "--d": 0, "--p": `${percent(level)}%` } as CSSProperties}
            aria-label={
              level.nextLevelXp !== null
                ? `Уровень ${level.level}, до уровня ${level.level + 1} осталось ${level.remainingXp} XP. Подробнее`
                : `Уровень ${level.level}, высший уровень. Подробнее`
            }
            onClick={() => setSheet("level")}
          >
            <span className="lv-head">
              <span className="lv-badge" aria-hidden="true">
                {level.level}
              </span>
              <span className="lv-text">
                <span className="lv-title">Уровень {level.level}</span>
                <span className="lv-sub">
                  {level.nextLevelXp !== null
                    ? `До уровня ${level.level + 1} — ${level.remainingXp} XP`
                    : "Высший уровень"}
                </span>
              </span>
              <span className="lv-pct" aria-hidden="true">
                <i
                  className="cnt pct"
                  style={{ "--v": pct, "--d": 1 } as CSSProperties}
                />
              </span>
              <Chevron className="lv-chev" />
            </span>
            <span
              className="scale"
              role="progressbar"
              aria-label={
                level.nextLevelXp !== null
                  ? `Прогресс до уровня ${level.level + 1}`
                  : "Высший уровень"
              }
              aria-valuemin={level.minimumXp}
              aria-valuemax={level.nextLevelXp ?? data.balance.lifetimeXp}
              aria-valuenow={data.balance.lifetimeXp}
            >
              <span className="fill" />
              <span className="knob" aria-hidden="true" />
            </span>
            {level.nextLevelXp !== null ? (
              <span className="ticks" aria-hidden="true">
                <span>{level.minimumXp} XP</span>
                <span>{level.nextLevelXp} XP</span>
              </span>
            ) : null}
          </button>
        ) : data ? (
          // Пороги уровней не заданы в правилах: карточка и шкала остаются на месте,
          // но уровень не выдумывается — экран прямо говорит, чего не хватает.
          <div
            className="level static rise"
            style={{ "--d": 0 } as CSSProperties}
            role="group"
            aria-label="Уровень не определён: пороги уровней не заданы"
          >
            <span className="lv-head">
              <span className="lv-badge" aria-hidden="true">
                –
              </span>
              <span className="lv-text">
                <span className="lv-title">Уровень</span>
                <span className="lv-sub">
                  {canManageRules
                    ? "Пороги не заданы: Ещё → Настройки начислений"
                    : "Пороги уровней ещё не заданы"}
                </span>
              </span>
            </span>
            <span className="scale" role="presentation" aria-hidden="true" />
            <span className="ticks" aria-hidden="true">
              <span>{data.balance.lifetimeXp} XP</span>
            </span>
          </div>
        ) : null}

        {data ? (
          <section className="stats rise" style={{ "--d": 1 } as CSSProperties}>
            {(() => {
              const body = (
                <>
                  <span className="head">
                    <span className="lbl">XP за всё время</span>
                    <span className="chip" aria-hidden="true">
                      <Pulse />
                    </span>
                  </span>
                  <span
                    className="n"
                    style={{ "--d": 1 } as CSSProperties}
                    aria-hidden="true"
                  >
                    <i
                      className="cnt"
                      style={
                        {
                          "--v": data.balance.lifetimeXp,
                          "--d": 1,
                        } as CSSProperties
                      }
                    />
                  </span>
                  <span className="sub">Не сгорают</span>
                </>
              );
              return level ? (
                <button
                  type="button"
                  className="tile xp"
                  aria-label={`XP за всё время: ${data.balance.lifetimeXp}. Подробнее об уровне`}
                  onClick={() => setSheet("level")}
                >
                  {body}
                </button>
              ) : (
                <div
                  className="tile xp static"
                  role="group"
                  aria-label={`XP за всё время: ${data.balance.lifetimeXp}`}
                >
                  {body}
                </div>
              );
            })()}
            <button
              type="button"
              className="tile gold"
              aria-label={`Баллы: ${data.balance.availablePoints}. Что можно получить`}
              onClick={() => setSheet("points")}
            >
              <span className="head">
                <span className="lbl">Баллы</span>
                <span className="chip" aria-hidden="true">
                  <Star />
                </span>
              </span>
              <span
                className="n"
                style={{ "--d": 1 } as CSSProperties}
                aria-hidden="true"
              >
                <i
                  className="cnt"
                  style={
                    {
                      "--v": data.balance.availablePoints,
                      "--d": 1,
                    } as CSSProperties
                  }
                />
              </span>
              <span className="sub">
                {data.balance.reservedPoints} в резерве
              </span>
            </button>
          </section>
        ) : null}

        {data ? (
          <p className="hint rise" style={{ "--d": 2 } as CSSProperties}>
            <Info />
            XP остаются навсегда, баллы тратятся на поощрения
          </p>
        ) : null}

        {!guideHidden && data && data.balance.lifetimeXp === 0 ? (
          <HowItWorks onHide={hideGuide} />
        ) : null}

        {open.length > 0 ? (
          <section
            className="free rise"
            style={{ "--d": 3 } as CSSProperties}
            aria-labelledby="home-free-title"
          >
            <div className="free-head">
              <span className="free-ic" aria-hidden="true">
                <PlusCircle />
              </span>
              <div className="free-t">
                <h3 id="home-free-title">Свободные задачи</h3>
                <span>
                  {open.length} {taskWord(open.length)} · до +{freeXp} XP
                </span>
              </div>
            </div>
            <button type="button" className="cta" onClick={() => go("tasks")}>
              Взять задачу
              <Arrow />
            </button>
          </section>
        ) : null}

        {showReview ? (
          <section
            className="free rise"
            style={{ "--d": 3 } as CSSProperties}
            aria-labelledby="home-review-title"
          >
            <div className="free-head">
              <span className="free-ic" aria-hidden="true">
                <ReviewList />
              </span>
              <div className="free-t">
                <h3 id="home-review-title">Очередь проверки</h3>
                <span>
                  {waiting.data
                    ? `Ждут решения: ${reviewCount}${waiting.data.more ? " и больше" : ""}.`
                    : "Число не загрузилось, очередь можно открыть."}
                </span>
              </div>
            </div>
            <button type="button" className="cta" onClick={() => go("reviews")}>
              Открыть очередь
              <Arrow />
            </button>
          </section>
        ) : null}

        {season.data?.self ? (
          <section
            className="month rise"
            style={{ "--d": 4 } as CSSProperties}
            aria-label={seasonLabel(season.data.season)}
          >
            <span className="k">
              <span className="dot" aria-hidden="true" />
              {seasonLabel(season.data.season)}
            </span>
            <b>
              <span className="sr">{season.data.self.xp}</span>
              <i
                className="cnt"
                style={
                  { "--v": season.data.self.xp, "--d": 4 } as CSSProperties
                }
                aria-hidden="true"
              />
            </b>
          </section>
        ) : null}
      </div>

      {sheet === "level" && data && level ? (
        <LevelSheet
          level={level}
          lifetimeXp={data.balance.lifetimeXp}
          freeTaskXp={freeXp}
          showRanking={Boolean(season.data?.self)}
          onClose={() => setSheet(null)}
          onTasks={() => go("tasks")}
        />
      ) : null}
      {sheet === "points" && data ? (
        <PointsSheet
          available={data.balance.availablePoints}
          reserved={data.balance.reservedPoints}
          onClose={() => setSheet(null)}
          onRewards={() => go("rewards")}
        />
      ) : null}
      {sheet === "help" ? <HelpSheet onClose={() => setSheet(null)} /> : null}
      {celebrating && data && level ? (
        <LevelUp
          level={level}
          lifetimeXp={data.balance.lifetimeXp}
          onClose={closeCelebration}
        />
      ) : null}
    </section>
  );
}
