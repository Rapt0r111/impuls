"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  type ReactNode,
} from "react";
import type { TelegramWebApp } from "./web-app";

type Register = (priority: number, back: () => void) => () => void;
const BackContext = createContext<Register | null>(null);

export function TelegramBackProvider({
  app,
  children,
}: {
  app: TelegramWebApp | null;
  children: ReactNode;
}) {
  const handlers = useRef(
    new Map<symbol, { priority: number; back(): void }>(),
  );
  const syncButton = useRef<(() => void) | null>(null);
  const register = useCallback<Register>((priority, back) => {
    const key = Symbol();
    handlers.current.set(key, { priority, back });
    syncButton.current?.();
    return () => {
      handlers.current.delete(key);
      syncButton.current?.();
    };
  }, []);

  useEffect(() => {
    const button = app?.BackButton;
    if (!button?.onClick || !button.offClick) return;
    let active = true;
    const sync = () => {
      try {
        if (handlers.current.size) button.show();
        else button.hide();
      } catch {
        // In-app close/navigation controls remain available on older clients.
      }
    };
    const back = () => {
      if (!active) return;
      let selected: { priority: number; back(): void } | undefined;
      for (const handler of handlers.current.values())
        if (!selected || handler.priority >= selected.priority)
          selected = handler;
      selected?.back();
    };
    try {
      button.onClick(back);
    } catch {
      return;
    }
    syncButton.current = sync;
    sync();
    return () => {
      active = false;
      syncButton.current = null;
      try {
        button.offClick(back);
      } catch {
        // Cleanup failures must not prevent unmounting revoked workspace data.
      }
      try {
        button.hide();
      } catch {
        // The native button may already have disappeared with its WebView.
      }
    };
  }, [app]);

  return (
    <BackContext.Provider value={register}>{children}</BackContext.Provider>
  );
}

// Priority: section 10, expanded panel 20, detail/form 30, future modal 40.
export function useTelegramBack(
  enabled: boolean,
  onBack: () => void,
  priority: number,
) {
  const register = useContext(BackContext);
  const back = useEffectEvent(onBack);
  useEffect(() => {
    if (enabled && register) return register(priority, () => back());
  }, [enabled, priority, register]);
}
