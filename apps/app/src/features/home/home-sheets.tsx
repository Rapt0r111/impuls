"use client";

import {
  rewardCatalogResponseSchema,
  type ParticipantProfileResponse,
} from "@impuls/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import {
  Arrow,
  Check,
  Close,
  Clock,
  Info,
  Lock,
  Pulse,
  Star,
} from "./home-icons";
import { pointsWord, taskWord } from "./home-notes";

export type Level = Extract<
  ParticipantProfileResponse["progression"],
  { state: "configured" }
>["level"];

const focusable =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Шторка поверх экрана: фокус уходит внутрь и возвращается, Esc и кнопка «Назад» Telegram
// закрывают её, Tab не выходит за её пределы.
function Sheet({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useTelegramBack(true, onClose, 20);
  useEffect(() => {
    const opener = document.activeElement;
    close.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="scrim"
        aria-label="Закрыть"
        tabIndex={-1}
        onClick={onClose}
      />
      <section
        ref={ref}
        className={`sheet${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const nodes = ref.current?.querySelectorAll<HTMLElement>(focusable);
          if (!nodes?.length) return;
          const first = nodes[0]!;
          const last = nodes[nodes.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="grab" aria-hidden="true" />
        <button
          ref={close}
          type="button"
          className="icon-btn sheet-close"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <Close />
        </button>
        {children}
      </section>
    </>
  );
}

// Заголовок уровня: «Уровень 2 · Исполнитель», название — только если правила его дали.
export const levelName = (level: Level) =>
  level.title
    ? `Уровень ${level.level} · ${level.title}`
    : `Уровень ${level.level}`;
export const percent = (level: Level) =>
  level.spanXp ? Math.min(100, (level.progressXp / level.spanXp) * 100) : 100;

export function LevelSheet({
  level,
  lifetimeXp,
  freeTaskXp,
  showRanking,
  onClose,
  onTasks,
}: {
  level: Level;
  lifetimeXp: number;
  // Наибольший фонд XP среди свободных задач; null, если свободных задач нет.
  freeTaskXp: number | null;
  showRanking: boolean;
  onClose: () => void;
  onTasks: () => void;
}) {
  const next = level.level + 1;
  const tasks =
    freeTaskXp && freeTaskXp > 0 && level.remainingXp > 0
      ? Math.ceil(level.remainingXp / freeTaskXp)
      : null;
  return (
    <Sheet label={levelName(level)} onClose={onClose}>
      <div className="sheet-head">
        <span className="lv-badge" aria-hidden="true">
          {level.level}
        </span>
        <div>
          <h2>{levelName(level)}</h2>
          <p>
            {level.nextLevelXp !== null
              ? `${lifetimeXp} из ${level.nextLevelXp} XP до уровня ${next}`
              : `${lifetimeXp} XP · высший уровень`}
          </p>
        </div>
      </div>
      <span
        className="scale"
        role="progressbar"
        aria-label={
          level.nextLevelXp !== null
            ? `Прогресс до уровня ${next}`
            : "Высший уровень"
        }
        aria-valuemin={level.minimumXp}
        aria-valuemax={level.nextLevelXp ?? lifetimeXp}
        aria-valuenow={lifetimeXp}
        style={{ "--p": `${percent(level)}%` } as React.CSSProperties}
      >
        <span className="fill" />
        <span className="knob" aria-hidden="true" />
      </span>
      {level.nextLevelXp !== null ? (
        <div className="road" aria-hidden="true">
          <span className="stop">
            <b>Ур. {level.level}</b>
            {level.minimumXp} XP
          </span>
          <i />
          <span className="stop now">
            <b>Ур. {next}</b>
            {level.nextLevelXp} XP
          </span>
        </div>
      ) : null}
      <div className="facts">
        {level.nextLevelXp !== null ? (
          <div className="fact">
            <span className="fi">
              <Pulse />
            </span>
            <div>
              <b>Осталось {level.remainingXp} XP</b>
              <span>
                {tasks
                  ? `Это примерно ${tasks} ${taskWord(tasks)} по +${freeTaskXp} XP.`
                  : "Столько XP нужно набрать до следующего уровня."}
              </span>
            </div>
          </div>
        ) : null}
        <div className="fact">
          <span className="fi">
            <Lock />
          </span>
          <div>
            <b>Уровень не сгорает</b>
            <span>XP копятся за всё время и никогда не тратятся.</span>
          </div>
        </div>
        {showRanking ? (
          <div className="fact">
            <span className="fi gold">
              <Star />
            </span>
            <div>
              <b>Рейтинг считается за месяц</b>
              <span>
                Место в рейтинге определяет XP за текущий месяц, а уровень — XP
                за всё время.
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <button type="button" className="cta" onClick={onTasks}>
        {freeTaskXp !== null ? "Взять задачу" : "Открыть задачи"}
        <Arrow />
      </button>
    </Sheet>
  );
}

export function PointsSheet({
  available,
  reserved,
  onClose,
  onRewards,
}: {
  available: number;
  reserved: number;
  onClose: () => void;
  onRewards: () => void;
}) {
  // Каталог нужен только этой шторке, поэтому грузится при её открытии.
  const catalog = useQuery({
    queryKey: ["home-reward-catalog"],
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/rewards?limit=20", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Rewards ${response.status}`);
      return rewardCatalogResponseSchema.parse(await response.json());
    },
  });
  const affordable = (catalog.data?.items ?? [])
    .filter(
      (item) =>
        !item.owned &&
        item.price <= available &&
        (item.quota.available === null || item.quota.available > 0),
    )
    .sort((a, b) => b.price - a.price)
    .slice(0, 2);
  return (
    <Sheet label="Баллы" className="gold-s" onClose={onClose}>
      <div className="sheet-head">
        <span className="chip-l" aria-hidden="true">
          <Star />
        </span>
        <div>
          <h2>
            {available} {pointsWord(available)}
          </h2>
          <p>{reserved} в резерве · доступно к трате</p>
        </div>
      </div>
      <div className="facts">
        {affordable.map((item, index) => (
          <div className="reward" key={item.id}>
            <span className="fi">{index === 0 ? <Clock /> : <Star />}</span>
            <div className="rt">
              <b>{item.title}</b>
              <span>
                Хватает на{" "}
                {item.quota.available === null
                  ? Math.floor(available / item.price)
                  : Math.min(
                      Math.floor(available / item.price),
                      item.quota.available,
                    )}
              </span>
            </div>
            <span className="price">{item.price} б.</span>
          </div>
        ))}
      </div>
      <div className="note-box">
        <Info />
        <span>
          XP остаются навсегда и растят уровень. Баллы тратятся на поощрения и
          после обмена уменьшаются.
        </span>
      </div>
      <button type="button" className="cta" onClick={onRewards}>
        Открыть каталог поощрений
        <Arrow />
      </button>
    </Sheet>
  );
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label="Как это работает" onClose={onClose}>
      <div className="sheet-head">
        <span className="chip-l" aria-hidden="true">
          <Check />
        </span>
        <div>
          <h2>Как это работает</h2>
          <p>От задачи до поощрения</p>
        </div>
      </div>
      <div className="facts">
        <div className="fact">
          <span className="fi">
            <Check />
          </span>
          <div>
            <b>Возьмите или получите задачу</b>
            <span>
              Командир назначает задачу, или вы берёте свободную в разделе
              «Задачи».
            </span>
          </div>
        </div>
        <div className="fact">
          <span className="fi">
            <Pulse />
          </span>
          <div>
            <b>Отправьте отчёт</b>
            <span>
              Откройте задачу, нажмите «Начать работу», затем отправьте отчёт.
            </span>
          </div>
        </div>
        <div className="fact">
          <span className="fi gold">
            <Star />
          </span>
          <div>
            <b>Получите XP и баллы Стимула</b>
            <span>
              Проверяющий принимает отчёт. XP поднимает вас в рейтинге, а баллы
              можно обменять в разделе «Поощрения».
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
