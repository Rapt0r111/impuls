"use client";

import {
  meResponseSchema,
  permissionsResponseSchema,
  type MeResponse,
  type PermissionsResponse,
} from "@impuls/contracts";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TelegramBridge, type TelegramWebApp } from "@/shared/telegram/web-app";
import { TelegramBackProvider } from "@/shared/telegram/back-navigation";
import { SessionContext } from "./session-context";

type AccessState =
  | { kind: "checking" }
  | { kind: "outside" }
  | { kind: "session" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "revoked" }
  | { kind: "offline" }
  | { kind: "unavailable" }
  | {
      kind: "authorized";
      data: MeResponse;
      permissions: PermissionsResponse["permissions"] | null;
    };

const actionNames: Record<
  PermissionsResponse["permissions"][number]["action"],
  string
> = {
  "task.view": "Просмотр задач и истории",
  "task.create": "Создание задач",
  "task.assign": "Назначение задач",
  "task.edit": "Редактирование черновиков",
  "task.cancel": "Отмена задач",
  "task.review": "Проверка результатов",
  "reward.decide": "Решение по заявкам",
  "reward.fulfill": "Подтверждение выдачи",
  "admin.access": "Управление доступом",
  "admin.access.manage": "Выдача и отзыв прав",
  "admin.rules": "Управление правилами",
  "admin.catalog": "Управление каталогом",
  "admin.catalog.create": "Создание позиции каталога",
  "admin.catalog.publish": "Публикация условий каталога",
  "admin.catalog.schedule": "Отложенная публикация условий каталога",
  "admin.catalog.schedule.cancel": "Отмена будущих условий каталога",
  "admin.catalog.quota.publish": "Публикация периодов квоты",
  "admin.audit": "Просмотр журнала действий",
  "admin.notifications": "Просмотр симуляции уведомлений",
  "ledger.correct": "Исправление журнала",
};

const scopeNames = {
  rota: "Рота",
  group: "Группа",
  project: "Проект",
} as const;

const stateText = {
  checking: {
    title: "Проверяем доступ",
    description: "Сверяем данные запуска Telegram и список допуска.",
    tone: "data",
  },
  outside: {
    title: "Нет данных запуска Telegram",
    description:
      "Закройте окно и снова нажмите «Открыть приложение» в профиле бота.",
    tone: "gold",
  },
  session: {
    title: "Не удалось подтвердить сессию",
    description:
      "Telegram подтвердил вход, но сервер не подтвердил сессионный доступ. Повторите вход или закройте и заново откройте приложение в Telegram.",
    tone: "error",
  },
  invalid: {
    title: "Не удалось подтвердить запуск",
    description:
      "Данные запуска не прошли проверку. Закройте приложение и откройте его снова через профиль бота. Если ошибка повторится, сообщите администратору.",
    tone: "error",
  },
  expired: {
    title: "Запуск устарел",
    description: "Закройте приложение и откройте его снова в Telegram.",
    tone: "gold",
  },
  denied: {
    title: "Доступ не открыт",
    description: "Этот Telegram-аккаунт пока не включён в список участников.",
    tone: "error",
  },
  revoked: {
    title: "Доступ отозван",
    description: "Рабочие данные больше недоступны для этого аккаунта.",
    tone: "error",
  },
  offline: {
    title: "Нет соединения",
    description: "Проверьте сеть и повторите проверку доступа.",
    tone: "gold",
  },
  unavailable: {
    title: "Сервис недоступен",
    description: "Не удалось проверить доступ. Повторите попытку позже.",
    tone: "error",
  },
  authorized: {
    title: "Доступ подтверждён",
    description: "Вход выполнен. Ниже показаны ваши назначения.",
    tone: "mint",
  },
} as const;

async function readCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
    ) {
      return body.code;
    }
  } catch {
    // A malformed response is handled as unavailable below.
  }
  return null;
}

export function AccessScreen({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<AccessState>({ kind: "checking" });
  const [telegramApp, setTelegramApp] = useState<TelegramWebApp | null>(null);
  const telegramAvailable = Boolean(telegramApp);
  const webApp = useRef<TelegramWebApp | null>(null);
  const pending = useRef<AbortController | null>(null);
  const bridgeResolved = useRef(false);
  const unsaved = useRef(false);
  const reportDirty = useCallback((dirty: boolean) => {
    unsaved.current = dirty;
    try {
      if (dirty) webApp.current?.enableClosingConfirmation?.();
      else webApp.current?.disableClosingConfirmation?.();
    } catch {
      // Older Telegram clients still get the in-app and browser guards.
    }
  }, []);
  const confirmLeave = useCallback(
    () =>
      !unsaved.current ||
      window.confirm(
        "Текст ещё не отправлен. Покинуть форму и потерять введённые данные?",
      ),
    [],
  );
  const loseAccess = useCallback(
    (status: number) => {
      reportDirty(false);
      setState({ kind: status === 401 ? "session" : "revoked" });
    },
    [reportDirty],
  );
  const checkInitialAccess = useEffectEvent(() => void checkAccess(null));

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (unsaved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!bridgeResolved.current) {
        bridgeResolved.current = true;
        checkInitialAccess();
      }
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, []);

  async function checkAccess(app: TelegramWebApp | null) {
    if (!confirmLeave()) return;
    reportDirty(false);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: "checking" });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);

    const update = (next: AccessState) => {
      if (pending.current === controller && !controller.signal.aborted) {
        setState(next);
      }
    };

    const showAuthorized = async (data: MeResponse) => {
      const response = await fetch("/api/v1/me/permissions", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (response.status === 403) {
        update({ kind: "revoked" });
        return;
      }
      if (response.status === 401) {
        update({ kind: "session" });
        return;
      }
      if (!response.ok) {
        update({ kind: "authorized", data, permissions: null });
        return;
      }
      const parsed = permissionsResponseSchema.safeParse(await response.json());
      update(
        parsed.success
          ? { kind: "authorized", data, permissions: parsed.data.permissions }
          : { kind: "authorized", data, permissions: null },
      );
    };

    try {
      const current = await fetch("/api/v1/me", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (current.ok) {
        const parsed = meResponseSchema.safeParse(await current.json());
        if (parsed.success) await showAuthorized(parsed.data);
        else update({ kind: "unavailable" });
        return;
      }
      if (current.status === 403) {
        update({ kind: "revoked" });
        return;
      }
      if (current.status !== 401) {
        update({ kind: "unavailable" });
        return;
      }
      if (!app?.initData) {
        update({ kind: "outside" });
        return;
      }

      const login = await fetch("/api/v1/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: app.initData }),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (login.ok) {
        const parsed = meResponseSchema.safeParse(await login.json());
        if (parsed.success) await showAuthorized(parsed.data);
        else update({ kind: "unavailable" });
        return;
      }
      const code = await readCode(login);
      if (login.status === 403 && code === "ACCESS_DENIED")
        update({ kind: "denied" });
      else if (login.status === 401 && code === "AUTH_EXPIRED")
        update({ kind: "expired" });
      else if (login.status === 401 && code === "AUTH_INVALID")
        update({ kind: "invalid" });
      else update({ kind: "unavailable" });
    } catch {
      if (
        pending.current !== controller ||
        (controller.signal.aborted && !timedOut)
      )
        return;
      setState({ kind: navigator.onLine ? "unavailable" : "offline" });
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function logout() {
    if (state.kind !== "authorized") return;
    if (!confirmLeave()) return;
    reportDirty(false);
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": state.data.csrfToken },
        credentials: "same-origin",
      });
      if (response.ok) setState({ kind: "outside" });
      else setState({ kind: "unavailable" });
    } catch {
      setState({ kind: navigator.onLine ? "unavailable" : "offline" });
    }
  }

  const copy = stateText[state.kind];
  return (
    <>
      <TelegramBridge
        onReady={(app) => {
          bridgeResolved.current = true;
          webApp.current = app;
          setTelegramApp(app);
          if (state.kind === "authorized") {
            reportDirty(unsaved.current);
            return;
          }
          void checkAccess(app);
        }}
        onError={() => {
          if (bridgeResolved.current) return;
          bridgeResolved.current = true;
          void checkAccess(null);
        }}
      />
      <main
        className={`access-screen${state.kind === "authorized" ? " access-screen--authorized" : ""}`}
      >
        <div className="access-shell">
          <header className="access-header">
            <span className="access-logo" aria-hidden="true">
              И
            </span>
            <span className="access-brand">Импульс</span>
            {state.kind === "authorized" ? (
              <button
                type="button"
                className="access-logout"
                onClick={() => void logout()}
              >
                Выйти
              </button>
            ) : null}
          </header>
          <section
            className={`access-content${state.kind === "authorized" ? " access-content--authorized" : ""}`}
            aria-labelledby="access-title"
          >
            {state.kind !== "authorized" ? (
              <div
                className={`access-signal access-signal--${copy.tone}`}
                aria-hidden="true"
              >
                <span />
              </div>
            ) : null}
            <h1 id="access-title">{copy.title}</h1>
            {state.kind !== "authorized" ? (
              <p className="access-description" aria-live="polite">
                {copy.description}
              </p>
            ) : null}
            {state.kind === "authorized" && (
              <>
                <div className="access-identity">
                  <strong>{state.data.user.displayName}</strong>
                </div>
                <details className="access-permissions">
                  <summary>Полномочия</summary>
                  {state.permissions === null ? (
                    <p>
                      Не удалось загрузить полномочия. Обновите проверку позже.
                    </p>
                  ) : state.permissions.length === 0 ? (
                    <p>Назначенных полномочий нет.</p>
                  ) : (
                    <ul>
                      {state.permissions.map((permission, index) => (
                        <li
                          key={`${permission.action}:${permission.scope.id}:${index}`}
                        >
                          <strong>{actionNames[permission.action]}</strong>
                          <span>
                            {scopeNames[permission.scope.kind]} ·{" "}
                            {permission.scope.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
                <SessionContext.Provider
                  value={{
                    csrfToken: state.data.csrfToken,
                    canDecideRewards:
                      state.permissions?.some(
                        (permission) => permission.action === "reward.decide",
                      ) ?? false,
                    canFulfillRewards:
                      state.permissions?.some(
                        (permission) => permission.action === "reward.fulfill",
                      ) ?? false,
                    canInspectCatalog:
                      state.permissions?.some(
                        (permission) => permission.action === "admin.catalog",
                      ) ?? false,
                    canReadAudit:
                      state.permissions?.some(
                        (permission) => permission.action === "admin.audit",
                      ) ?? false,
                    canReadNotificationStatus:
                      state.permissions?.some(
                        (permission) =>
                          permission.action === "admin.notifications",
                      ) ?? false,
                    canCorrectLedger:
                      state.permissions?.some(
                        (permission) => permission.action === "ledger.correct",
                      ) ?? false,
                    canReview:
                      state.permissions?.some(
                        (permission) => permission.action === "task.review",
                      ) ?? false,
                    canManageTasks:
                      state.permissions?.some(
                        (permission) =>
                          permission.action === "task.create" ||
                          permission.action === "task.assign" ||
                          permission.action === "task.edit" ||
                          permission.action === "task.cancel" ||
                          permission.action === "task.view",
                      ) ?? false,
                    historyScopeIds:
                      state.permissions
                        ?.filter(
                          (permission) => permission.action === "task.view",
                        )
                        .map((permission) => permission.scope.id) ?? [],
                    canSetTasks:
                      state.permissions?.some(
                        (permission) =>
                          permission.action === "task.create" ||
                          permission.action === "task.assign" ||
                          permission.action === "task.edit" ||
                          permission.action === "task.cancel",
                      ) ?? false,
                    reportDirty,
                    confirmLeave,
                    loseAccess,
                  }}
                >
                  <TelegramBackProvider app={telegramApp}>
                    {children}
                  </TelegramBackProvider>
                </SessionContext.Provider>
              </>
            )}
          </section>
          {state.kind !== "authorized" || state.permissions === null ? (
            <div className="access-actions">
              {(state.kind === "offline" ||
                state.kind === "unavailable" ||
                state.kind === "session") && (
                <button
                  type="button"
                  className="access-button"
                  onClick={() => void checkAccess(webApp.current)}
                >
                  {state.kind === "session"
                    ? "Повторить вход"
                    : "Проверить снова"}
                </button>
              )}
              {state.kind === "authorized" && (
                <>
                  {state.permissions === null && (
                    <button
                      type="button"
                      className="access-button"
                      onClick={() => void checkAccess(webApp.current)}
                    >
                      Обновить полномочия
                    </button>
                  )}
                </>
              )}
              {state.kind === "expired" && telegramAvailable && (
                <button
                  type="button"
                  className="access-button"
                  onClick={() => webApp.current?.close()}
                >
                  Закрыть приложение
                </button>
              )}
              {state.kind !== "authorized" ? (
                <p className="access-footnote">
                  Данные задач появятся после подтверждённого входа.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
