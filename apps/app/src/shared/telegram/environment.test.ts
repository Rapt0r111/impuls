import { afterEach, describe, expect, it, vi } from "vitest";
import { connectTelegramEnvironment } from "./environment";
import type {
  TelegramEvent,
  TelegramEventHandler,
  TelegramWebApp,
} from "./web-app";

function fixture() {
  const css = new Map<string, { value: string; priority: string }>();
  const attrs = new Map<string, string>();
  const root = {
    style: {
      getPropertyValue: (name: string) => css.get(name)?.value ?? "",
      getPropertyPriority: (name: string) => css.get(name)?.priority ?? "",
      setProperty: (name: string, value: string, priority = "") =>
        css.set(name, { value, priority }),
      removeProperty: (name: string) => css.delete(name),
    },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
  };
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: () => "#08151c",
  }));
  const listeners = new Map<TelegramEvent, Set<TelegramEventHandler>>();
  const app: TelegramWebApp = {
    initData: "",
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    colorScheme: "light",
    viewportHeight: 720,
    viewportStableHeight: 720,
    safeAreaInset: { top: 24, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 48, bottom: 0, left: 0, right: 0 },
    onEvent: (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(handler);
    },
    offEvent: (name, handler) => {
      listeners.get(name)?.delete(handler);
    },
  };
  const emit = (name: TelegramEvent, data?: { isStateStable: boolean }) => {
    for (const handler of listeners.get(name) ?? []) handler(data);
  };
  return { app, root, listeners, emit, css, attrs };
}
afterEach(() => vi.unstubAllGlobals());

describe("Telegram presentation lifecycle", () => {
  it("restores existing document state and removes subscriptions across reconnects", () => {
    const f = fixture();
    f.root.style.setProperty(
      "--impuls-viewport-stable-height",
      "333px",
      "important",
    );
    f.root.setAttribute("data-telegram-theme", "previous");
    const before = new Map(f.css);
    for (let cycle = 0; cycle < 3; cycle++) {
      const disconnect = connectTelegramEnvironment(f.app);
      expect(
        [...f.listeners.values()].map((handlers) => handlers.size),
      ).toEqual([1, 1, 1, 1]);
      expect(f.root.getAttribute("data-telegram-theme")).toBe("light");
      disconnect();
      disconnect();
      expect(
        [...f.listeners.values()].map((handlers) => handlers.size),
      ).toEqual([0, 0, 0, 0]);
      expect(f.css).toEqual(before);
      expect(f.root.getAttribute("data-telegram-theme")).toBe("previous");
    }
  });

  it("ignores stale native events even when unregistering throws", () => {
    const f = fixture();
    f.app.offEvent = () => {
      throw new Error("Detached WebView");
    };
    const disconnect = connectTelegramEnvironment(f.app);
    expect(() => disconnect()).not.toThrow();
    f.app.viewportStableHeight = 999;
    f.app.colorScheme = "dark";
    for (const event of f.listeners.keys())
      f.emit(event, { isStateStable: true });
    expect(f.css.size).toBe(0);
    expect(f.attrs.size).toBe(0);
  });

  it("falls back to browser layout for missing, invalid and zero viewport data", () => {
    const f = fixture();
    const disconnect = connectTelegramEnvironment(f.app);
    f.app.viewportHeight = Number.NaN;
    f.app.viewportStableHeight = 0;
    f.app.safeAreaInset = {
      top: -1,
      bottom: Number.POSITIVE_INFINITY,
      left: 0,
      right: 8,
    };
    delete f.app.contentSafeAreaInset;
    f.emit("viewportChanged", { isStateStable: true });
    f.emit("safeAreaChanged");
    expect(f.root.style.getPropertyValue("--impuls-viewport-height")).toBe("");
    expect(
      f.root.style.getPropertyValue("--impuls-viewport-stable-height"),
    ).toBe("");
    expect(f.root.style.getPropertyValue("--impuls-device-safe-top")).toBe("");
    expect(f.root.style.getPropertyValue("--impuls-device-safe-bottom")).toBe(
      "",
    );
    expect(f.root.style.getPropertyValue("--impuls-device-safe-right")).toBe(
      "8px",
    );
    expect(f.root.style.getPropertyValue("--impuls-content-safe-top")).toBe("");
    disconnect();
  });

  it("keeps independent presentation methods working when another throws", () => {
    const f = fixture();
    f.app.setHeaderColor = () => {
      throw new Error("Unsupported header color");
    };
    const disconnect = connectTelegramEnvironment(f.app);
    f.emit("themeChanged");
    expect(f.app.setBackgroundColor).toHaveBeenCalledTimes(2);
    expect(f.app.setBottomBarColor).toHaveBeenCalledTimes(2);
    expect(
      f.root.style.getPropertyValue("--impuls-viewport-stable-height"),
    ).toBe("720px");
    disconnect();
  });
});
