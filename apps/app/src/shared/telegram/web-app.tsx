"use client";

import { useEffect, useRef } from "react";

export type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
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
    const script = document.getElementById("telegram-web-app-bridge");
    const connect = () => {
      const webApp = window.Telegram?.WebApp ?? null;
      if (!webApp) return;
      webApp.setHeaderColor("#08151c");
      webApp.setBackgroundColor("#08151c");
      webApp.ready();
      webApp.expand();
      callbacks.current.onReady(webApp);
    };
    const fail = () => callbacks.current.onError();
    script?.addEventListener("load", connect);
    script?.addEventListener("error", fail);
    connect();
    return () => {
      script?.removeEventListener("load", connect);
      script?.removeEventListener("error", fail);
    };
  }, []);

  return null;
}
