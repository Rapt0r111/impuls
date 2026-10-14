"use client";

import { useEffect, useRef } from "react";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { levelName, percent, type Level } from "./home-sheets";

// Конфетти макета: смещение, поворот и задержка заданы заранее, чтобы кадры не менялись.
const bits: [number, number, number, number, string, number, number, string][] =
  [
    [122, -6, 246, 0.56, "accent", 6, 10, "50%"],
    [155, 17, 99, 0.37, "gold", 6, 10, "2px"],
    [116, 52, 144, 0.56, "#FFFFFF", 8, 10, "2px"],
    [105, 66, 222, 0.49, "#7FD6FF", 10, 10, "2px"],
    [112, 136, -373, 0.42, "#FF9FB5", 10, 10, "50%"],
    [54, 96, -105, 0.4, "accent", 10, 6, "2px"],
    [15, 144, -39, 0.53, "gold", 6, 6, "2px"],
    [-22, 142, 88, 0.46, "#FFFFFF", 10, 6, "2px"],
    [-47, 135, 44, 0.41, "#7FD6FF", 8, 14, "50%"],
    [-84, 136, -337, 0.48, "#FF9FB5", 10, 14, "2px"],
    [-138, 87, -126, 0.38, "accent", 10, 10, "2px"],
    [-149, 75, -265, 0.36, "gold", 8, 14, "2px"],
    [-168, 29, 166, 0.52, "#FFFFFF", 8, 14, "50%"],
    [-156, -4, 47, 0.59, "#7FD6FF", 6, 10, "2px"],
    [-159, -34, -358, 0.43, "#FF9FB5", 10, 6, "2px"],
    [-144, -72, 36, 0.45, "accent", 8, 6, "2px"],
    [-80, -70, 52, 0.5, "gold", 8, 10, "50%"],
    [-73, -94, -126, 0.41, "#FFFFFF", 6, 6, "2px"],
    [-69, -149, -338, 0.45, "#7FD6FF", 6, 14, "2px"],
    [-23, -107, 20, 0.53, "#FF9FB5", 10, 14, "2px"],
    [43, -143, -31, 0.37, "accent", 6, 10, "50%"],
    [41, -142, -408, 0.4, "gold", 8, 6, "2px"],
    [62, -94, 127, 0.49, "#FFFFFF", 8, 6, "2px"],
    [137, -83, 107, 0.52, "#7FD6FF", 10, 6, "2px"],
    [148, -95, 378, 0.45, "#FF9FB5", 10, 6, "50%"],
    [114, -29, 229, 0.4, "accent", 8, 10, "2px"],
  ];
const color = (c: string) =>
  c === "accent" ? "var(--accent)" : c === "gold" ? "var(--gold)" : c;

// Награда за новый уровень: кольца от значка, конфетти, счёт XP, шкала до следующего уровня.
export function LevelUp({
  level,
  lifetimeXp,
  onClose,
}: {
  level: Level;
  lifetimeXp: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useTelegramBack(true, onClose, 30);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <section
      ref={dialog}
      tabIndex={-1}
      className="levelup"
      role="dialog"
      aria-modal="true"
      aria-label={`Новый уровень: ${level.level}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="lu-stage" aria-hidden="true">
        <div className="lu-origin">
          <span className="lu-halo" />
          <span className="lu-ring" />
          <span className="lu-ring r2" />
          <span className="lu-ring r3" />
          <div className="lu-bits">
            {bits.map(([x, y, r, dl, c, w, h, radius], index) => (
              <i
                key={index}
                style={
                  {
                    "--x": `${x}px`,
                    "--y": `${y}px`,
                    "--r": `${r}deg`,
                    "--dl": `${dl}s`,
                    width: w,
                    height: h,
                    background: color(c),
                    borderRadius: radius,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="lu-badge">{level.level}</div>
        </div>
      </div>

      <div className="lu-copy">
        <p className="lu-eyebrow">Новый уровень</p>
        <h2>{levelName(level)}</h2>
        <p className="lu-lead">
          Отличная работа! Вы набрали нужный опыт и открыли следующую ступень.
        </p>
        <div className="lu-xp">
          <b>
            <span className="sr">{lifetimeXp}</span>
            <i
              className="cnt"
              style={{ "--v": lifetimeXp } as React.CSSProperties}
              aria-hidden="true"
            />
          </b>
          <span>XP за всё время</span>
        </div>
      </div>

      {level.nextLevelXp !== null ? (
        <section className="lu-next" aria-label="До следующего уровня">
          <div className="lu-next-top">
            <span>До уровня {level.level + 1}</span>
            <b>{level.remainingXp} XP</b>
          </div>
          <span
            className="scale"
            role="progressbar"
            aria-label={`Прогресс до уровня ${level.level + 1}`}
            aria-valuemin={level.minimumXp}
            aria-valuemax={level.nextLevelXp}
            aria-valuenow={lifetimeXp}
            style={{ "--p": `${percent(level)}%` } as React.CSSProperties}
          >
            <span className="fill" />
          </span>
          <div className="ticks" aria-hidden="true">
            <span>{level.minimumXp} XP</span>
            <span>{level.nextLevelXp} XP</span>
          </div>
        </section>
      ) : null}

      <button type="button" className="cta lu-cta" onClick={onClose}>
        Продолжить
      </button>
    </section>
  );
}
