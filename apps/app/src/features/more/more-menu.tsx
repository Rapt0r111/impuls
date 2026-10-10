"use client";

import type { ReactNode } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useParticipantProfile } from "@/features/profile/participant-profile";
import "./more.css";

export type MoreTarget =
  | "profile"
  | "ledger"
  | "reviews"
  | "management"
  | "catalog-admin"
  | "access"
  | "audit"
  | "notifications";

export type MoreItem = {
  id: MoreTarget;
  /** Видимая подпись совпадает с доступным именем кнопки (WCAG 2.5.3). */
  label: string;
  hint: string;
  icon: ReactNode;
};

// Линейные иконки 24×24 в стиле нижней панели (stroke 1.8, round).
const icons = {
  ledger: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6c0 2.2-5 1.2-5 3.6 0 1 1 1.6 2.5 1.6s2.5-.6 2.5-1.6" />
    </>
  ),
  reviews: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  management: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  catalog: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M8 8a2.5 2.5 0 1 1 4-2M16 8a2.5 2.5 0 1 0-4-2" />
    </>
  ),
  access: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.4 2.9-5.5 6.5-5.5M15 14l2 2 4-4" />
    </>
  ),
  audit: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" />
      <path d="M10 21h4" />
    </>
  ),
};

/** Состав раздела «Ещё»: что видит участник и что добавляют права. */
export function useMoreItems(): {
  personal: MoreItem[];
  operations: MoreItem[];
} {
  const {
    canReview,
    canReadAudit,
    canInspectCatalog,
    accessScopes,
    canReadNotificationStatus,
    canManageTasks,
    canSetTasks,
  } = useAuthorizedSession();
  const personal: MoreItem[] = [
    {
      id: "ledger",
      label: "Баланс и журнал",
      hint: "Начисления, резерв и списания",
      icon: icons.ledger,
    },
  ];
  const operations: MoreItem[] = [];
  if (canReview)
    operations.push({
      id: "reviews",
      label: "Проверка отчётов",
      hint: "Отчёты участников на решении",
      icon: icons.reviews,
    });
  if (canManageTasks)
    operations.push({
      id: "management",
      label: canSetTasks ? "Постановка задач" : "Задачи и история",
      hint: canSetTasks ? "Создать, назначить, изменить" : "Только просмотр",
      icon: icons.management,
    });
  if (canInspectCatalog)
    operations.push({
      id: "catalog-admin",
      label: "Управление каталогом",
      hint: "Условия, цены и квоты поощрений",
      icon: icons.catalog,
    });
  if (accessScopes?.length)
    operations.push({
      id: "access",
      label: "Управление доступом",
      hint: "Участники и права",
      icon: icons.access,
    });
  if (canReadAudit)
    operations.push({
      id: "audit",
      label: "Журнал действий",
      hint: "Кто и что изменил",
      icon: icons.audit,
    });
  if (canReadNotificationStatus)
    operations.push({
      id: "notifications",
      label: "Состояние уведомлений",
      hint: "Очередь и доставка",
      icon: icons.notifications,
    });
  return { personal, operations };
}

const chevron = (
  <svg className="more-chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? parts.slice(0, 2).map((part) => part[0])
      : [parts[0]?.[0]];
  return letters.join("").toUpperCase();
}

export function MoreMenu({ onOpen }: { onOpen: (to: MoreTarget) => void }) {
  const profile = useParticipantProfile();
  const { personal, operations } = useMoreItems();
  const name = profile.data?.user.displayName;
  const level = profile.data?.progression.level?.level;
  const row = (item: MoreItem) => (
    <li key={item.id}>
      <button
        type="button"
        className="more-row"
        aria-label={item.label}
        onClick={() => onOpen(item.id)}
      >
        <span className="more-tile" aria-hidden="true">
          <svg viewBox="0 0 24 24">{item.icon}</svg>
        </span>
        <span className="more-row-text">
          <strong>{item.label}</strong>
          <span>{item.hint}</span>
        </span>
        {chevron}
      </button>
    </li>
  );
  return (
    <section className="tasks-section more" aria-labelledby="more-title">
      <div className="tasks-heading">
        <div>
          <h2 id="more-title">Ещё</h2>
        </div>
      </div>
      <button
        type="button"
        className="more-profile"
        aria-label="Мой профиль"
        onClick={() => onOpen("profile")}
      >
        <span className="more-avatar" aria-hidden="true">
          {name ? initials(name) : "…"}
        </span>
        <span className="more-row-text">
          <strong>{name ?? "Профиль"}</strong>
          <span>
            {level ? `Уровень ${level} · ` : ""}имя, уровень и достижения
          </span>
        </span>
        {chevron}
      </button>
      <ul className="more-group">{personal.map(row)}</ul>
      {operations.length ? (
        <>
          <h3 className="more-group-title">Для командира</h3>
          <ul className="more-group">{operations.map(row)}</ul>
        </>
      ) : null}
    </section>
  );
}
