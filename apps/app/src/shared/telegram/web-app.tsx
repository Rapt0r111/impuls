"use client";

import { useEffect, useRef } from "react";
import { connectTelegramEnvironment } from "./environment";

export type TelegramEvent =
  | "themeChanged"
  | "viewportChanged"
  | "safeAreaChanged"
  | "contentSafeAreaChanged";
export type TelegramEventHandler = (data?: { isStateStable?: boolean }) => void;
export type TelegramInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  colorScheme?: "light" | "dark";
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: TelegramInsets;
  contentSafeAreaInset?: TelegramInsets;
  onEvent?(event: TelegramEvent, handler: TelegramEventHandler): void;
  offEvent?(event: TelegramEvent, handler: TelegramEventHandler): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
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
    let disconnect: (() => void) | undefined;
    const connect = () => {
      const webApp = window.Telegram?.WebApp ?? null;
      if (!webApp) return false;
      if (interval !== undefined) window.clearInterval(interval);
      disconnect = connectTelegramEnvironment(webApp);
      callbacks.current.onReady(webApp);
      for (const configure of [() => webApp.ready(), () => webApp.expand()]) {
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
      disconnect?.();
    };
  }, []);

  return null;
}
