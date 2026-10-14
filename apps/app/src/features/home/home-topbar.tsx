"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Bell,
  Check,
  Chevron,
  ChevronLeft,
  Dots,
  DoubleCheck,
  Help,
  Logo,
  Person,
  Pulse,
  Star,
} from "./home-icons";
import {
  dayLabel,
  relativeTime,
  type HomeNote,
  type NoteTarget,
} from "./home-notes";

// Приветствие считается на клиенте после входа, поэтому серверная разметка с ним не расходится.
const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  return hour < 18 ? "Добрый день" : "Добрый вечер";
};
// В приветствии — имя, как в макете; полное имя остаётся в профиле.
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const noteIcon = { task: Check, assign: Pulse, star: Star } as const;

export function HomeTopBar({
  name,
  notes,
  read,
  onMark,
  onMarkAll,
  onOpenNote,
  onProfile,
  onHelp,
}: {
  name: string;
  notes: HomeNote[];
  read: ReadonlySet<string>;
  onMark: (id: string) => void;
  onMarkAll: () => void;
  onOpenNote: (target: NoteTarget) => void;
  onProfile: () => void;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState<"notes" | "menu" | null>(null);
  const root = useRef<HTMLElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const kebab = useRef<HTMLButtonElement>(null);
  const noteId = useId();
  const menuId = useId();
  const unread = notes.filter((note) => !read.has(note.id)).length;

  // Всплывающее окно закрывается касанием вне шапки и клавишей Esc.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      (open === "notes" ? bell : kebab).current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <header className="top" ref={root}>
      <div className="logo">
        <Logo />
      </div>
      <div className="greet">
        <small>{greeting()}</small>
        <strong>{firstName(name)}</strong>
      </div>

      <div className={`pop-wrap n-wrap${open === "notes" ? " is-open" : ""}`}>
        <button
          ref={bell}
          type="button"
          className="icon-btn"
          aria-label={
            unread > 0 ? `Уведомления, новых: ${unread}` : "Уведомления"
          }
          aria-expanded={open === "notes"}
          aria-controls={noteId}
          onClick={() => setOpen(open === "notes" ? null : "notes")}
        >
          <Bell />
          {unread > 0 ? (
            <span className="badge" aria-hidden="true">
              {unread}
            </span>
          ) : null}
        </button>
        {open === "notes" ? (
          <div
            id={noteId}
            className="pop notif"
            role="region"
            aria-label="Уведомления"
          >
            <div className="notif-clip">
              <div className="pop-head">
                <b>Уведомления</b>
                {unread > 0 ? (
                  <span className="new-pill">
                    {unread} {unread === 1 ? "новое" : "новых"}
                  </span>
                ) : null}
              </div>
              {unread > 0 ? (
                <div className="swipe-hint">
                  <ChevronLeft />
                  Смахните влево, чтобы отметить прочитанным
                </div>
              ) : null}
              {notes.length === 0 ? (
                <p className="pop-empty">
                  Пока ничего нового. Здесь появятся принятые задачи, новые
                  назначения и решения по поощрениям.
                </p>
              ) : (
                <ul className="pop-list">
                  {notes.map((note, index) => {
                    const day = dayLabel(note.at);
                    const showDay =
                      index === 0 || day !== dayLabel(notes[index - 1]!.at);
                    const isUnread = !read.has(note.id);
                    const Icon = noteIcon[note.kind];
                    return (
                      <li
                        key={note.id}
                        style={
                          {
                            display: "contents",
                            "--i": index,
                          } as React.CSSProperties
                        }
                      >
                        {showDay ? <div className="day-lbl">{day}</div> : null}
                        <div
                          className="note row"
                          style={{ "--i": index } as React.CSSProperties}
                        >
                          <div className="swipe">
                            <button
                              type="button"
                              className={`note-main${isUnread ? " unread" : ""}`}
                              onClick={() => {
                                onMark(note.id);
                                setOpen(null);
                                onOpenNote(note.target);
                              }}
                            >
                              <span
                                className={`ic${note.kind === "star" ? " gold" : ""}`}
                              >
                                <Icon />
                              </span>
                              <span className="body">
                                <span className="t">
                                  <span>{note.title}</span>
                                  <time dateTime={note.at}>
                                    {relativeTime(note.at)}
                                  </time>
                                </span>
                                <p>{note.text}</p>
                              </span>
                              <Chevron className="chev" />
                            </button>
                            {isUnread ? (
                              <button
                                type="button"
                                className="mark"
                                onClick={() => onMark(note.id)}
                              >
                                <DoubleCheck />
                                Прочитано
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {unread > 0 ? (
                <button type="button" className="pop-foot" onClick={onMarkAll}>
                  Прочитать все
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="pop-wrap">
        <button
          ref={kebab}
          type="button"
          className="icon-btn"
          aria-label="Меню"
          aria-haspopup="menu"
          aria-expanded={open === "menu"}
          aria-controls={menuId}
          onClick={() => setOpen(open === "menu" ? null : "menu")}
        >
          <Dots />
        </button>
        {open === "menu" ? (
          <div id={menuId} className="pop menu" role="menu">
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              style={{ "--i": 0 } as React.CSSProperties}
              onClick={() => {
                setOpen(null);
                onProfile();
              }}
            >
              <Person />
              Профиль
            </button>
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              style={{ "--i": 1 } as React.CSSProperties}
              onClick={() => {
                setOpen(null);
                onHelp();
              }}
            >
              <Help />
              Помощь
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
