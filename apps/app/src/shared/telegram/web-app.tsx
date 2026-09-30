"use client";

import { useEffect, useRef } from "react";

export type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function TelegramBridge({
  onReady,
  onError,
}: {
  onReady(webApp: TelegramWebApp | null): void;
  onError(): void;
}) {
  const callbacks = useRef({ onReady, onError });
  useEffect(() => {
    callbacks.current = { onReady, onError };
  }, [onReady, onError]);

  useEffect(() => {
    let attempts = 0;
    const errorAfterAttempts = 80;
    const stopAfterAttempts = 600;
    let interval: number | undefined;
    const connect = () => {
      const webApp = window.Telegram?.WebApp ?? null;
      if (!webApp) return false;
      if (interval !== undefined) window.clearInterval(interval);
      callbacks.current.onReady(webApp);
      for (const configure of [
        () => webApp.setHeaderColor("#08151c"),
        () => webApp.setBackgroundColor("#08151c"),
        () => webApp.ready(),
        () => webApp.expand(),
      ]) {
        try {
          configure();
        } catch {
          // Unsupported presentation methods must not block signed login.
        }
      }
      return true;
    };
    const poll = () => {
      attempts += 1;
      if (connect()) return;
      if (attempts === errorAfterAttempts) callbacks.current.onError();
      if (attempts >= stopAfterAttempts) {
        if (interval !== undefined) window.clearInterval(interval);
      }
    };
    if (!connect()) interval = window.setInterval(poll, 100);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return null;
}
