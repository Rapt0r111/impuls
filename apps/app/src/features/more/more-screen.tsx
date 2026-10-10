"use client";

import type { ReactNode } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { actionNames, scopeNames } from "@/features/auth/permission-labels";
import { useParticipantProfile } from "@/features/profile/participant-profile";
import "./more.css";

export type MoreDestination = {
  id: string;
  label: string;
  group: "personal" | "commander";
};

const chevron = (
  <svg className="more-chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

// Значки разделов: одна обводка и один вес, как у нижней панели.
const icons: Record<string, ReactNode> = {
  ledger: <path d="M5 6h14M5 12h14M5 18h9" />,
  reviews: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="3" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  management: <path d="M12 5v14M5 12h14" />,
  "catalog-admin": (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M4 13h16M12 9v11" />
    </>
  ),
  access: (
    <>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3.5 19c.5-3 2.8-5 5.5-5s5 2 5.5 5M16 6.5a3 3 0 0 1 0 5.5M18 14.5c1.5.6 2.5 2.2 2.8 4.5" />
    </>
  ),
  audit: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z" />,
  notifications: <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4" />,
};

export function MoreScreen({
  destinations,
  onOpen,
}: {
  destinations: MoreDestination[];
  onOpen: (id: string) => void;
}) {
  const { user, permissions } = useAuthorizedSession();
  const profile = useParticipantProfile();
  const level = profile.data?.progression.level?.level;
  const row = (item: MoreDestination) => (
    <button
      key={item.id}
      type="button"
      className="more-row"
      onClick={() => onOpen(item.id)}
    >
      <span className="more-tile" aria-hidden="true">
        <svg viewBox="0 0 24 24">{icons[item.id]}</svg>
      </span>
      <span className="more-label">{item.label}</span>
      {chevron}
    </button>
  );
  const personal = destinations.filter((item) => item.group === "personal");
  const commander = destinations.filter((item) => item.group === "commander");
  return (
    <section className="tasks-section more" aria-labelledby="more-title">
      <div className="tasks-heading">
        <h2 id="more-title">Ещё</h2>
      </div>
      <button
        type="button"
        className="more-profile"
        aria-label="Мой профиль"
        onClick={() => onOpen("profile")}
      >
        <span className="access-avatar" aria-hidden="true">
          {user.displayName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="more-profile-text">
          <strong>{user.displayName}</strong>
          <span>{level ? `Уровень ${level} · ` : ""}профиль и достижения</span>
        </span>
        {chevron}
      </button>
      <div className="more-group">{personal.map(row)}</div>
      {commander.length ? (
        <>
          <h3 className="more-heading">Для командира</h3>
          <div className="more-group">{commander.map(row)}</div>
        </>
      ) : null}
      <details className="more-permissions">
        <summary>Полномочия</summary>
        {permissions === null ? (
          <p>Не удалось загрузить полномочия. Обновите проверку позже.</p>
        ) : permissions.length === 0 ? (
          <p>Назначенных полномочий нет.</p>
        ) : (
          <ul>
            {permissions.map((permission, index) => (
              <li key={`${permission.action}:${permission.scope.id}:${index}`}>
                <strong>{actionNames[permission.action]}</strong>
                <span>
                  {scopeNames[permission.scope.kind]} · {permission.scope.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
