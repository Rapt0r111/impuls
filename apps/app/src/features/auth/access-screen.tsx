"use client";

import { meResponseSchema, type MeResponse } from "@impuls/contracts";
import { useEffect, useRef, useState } from "react";
import { TelegramBridge, type TelegramWebApp } from "@/shared/telegram/web-app";

type AccessState =
  | { kind: "checking" }
  | { kind: "outside" }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "revoked" }
  | { kind: "offline" }
  | { kind: "unavailable" }
  | { kind: "authorized"; data: MeResponse };

const stateText = {
  checking: {
    title: "Проверяем доступ",
    description: "Сверяем данные запуска Telegram и список допуска.",
    tone: "data",
  },
  outside: {
    title: "Откройте в Telegram",
    description: "Вход доступен только при запуске Mini App через бота.",
    tone: "gold",
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
    description: "Вход выполнен. Рабочие разделы пока создаются.",
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

export function AccessScreen() {
  const [state, setState] = useState<AccessState>({ kind: "checking" });
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const webApp = useRef<TelegramWebApp | null>(null);
  const pending = useRef<AbortController | null>(null);
  const bridgeResolved = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!bridgeResolved.current) {
        bridgeResolved.current = true;
        void checkAccess(null);
      }
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, []);

  async function checkAccess(app: TelegramWebApp | null) {
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

    try {
      const current = await fetch("/api/v1/me", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (current.ok) {
        const parsed = meResponseSchema.safeParse(await current.json());
        update(
          parsed.success
            ? { kind: "authorized", data: parsed.data }
            : { kind: "unavailable" },
        );
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
        update(
          parsed.success
            ? { kind: "authorized", data: parsed.data }
            : { kind: "unavailable" },
        );
        return;
      }
      const code = await readCode(login);
      if (login.status === 403 && code === "ACCESS_DENIED")
        update({ kind: "denied" });
      else if (login.status === 401 && code === "AUTH_EXPIRED")
        update({ kind: "expired" });
      else if (login.status === 401) update({ kind: "outside" });
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
          setTelegramAvailable(Boolean(app));
          void checkAccess(app);
        }}
        onError={() => {
          if (bridgeResolved.current) return;
          bridgeResolved.current = true;
          void checkAccess(null);
        }}
      />
      <main className="access-screen">
        <div className="access-shell">
          <header className="access-header">
            <span className="access-logo" aria-hidden="true">
              И
            </span>
            <span className="access-brand">Импульс</span>
          </header>
          <section className="access-content" aria-labelledby="access-title">
            <div
              className={`access-signal access-signal--${copy.tone}`}
              aria-hidden="true"
            >
              <span />
            </div>
            <h1 id="access-title">{copy.title}</h1>
            <p className="access-description" aria-live="polite">
              {copy.description}
            </p>
            {state.kind === "authorized" && (
              <div className="access-identity">
                <span>Участник</span>
                <strong>{state.data.user.displayName}</strong>
              </div>
            )}
          </section>
          <div className="access-actions">
            {(state.kind === "offline" || state.kind === "unavailable") && (
              <button
                type="button"
                className="access-button"
                onClick={() => void checkAccess(webApp.current)}
              >
                Проверить снова
              </button>
            )}
            {state.kind === "authorized" && (
              <button
                type="button"
                className="access-button access-button--quiet"
                onClick={() => void logout()}
              >
                Выйти
              </button>
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
            <p className="access-footnote">
              Данные задач и результаты появятся только после подтверждённого
              входа.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
