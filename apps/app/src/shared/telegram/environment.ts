import type {
  TelegramEvent,
  TelegramEventHandler,
  TelegramWebApp,
} from "./web-app";

// Presentation APIs may be absent or throw on older clients. They never gate login.
function attempt(action: () => void) {
  try {
    action();
  } catch {
    // Retain browser CSS and the in-app controls when a native API is unsupported.
  }
}

export function connectTelegramEnvironment(app: TelegramWebApp) {
  let connected = true;
  const root = document.documentElement;
  const previous = new Map<string, { value: string; priority: string }>();
  const previousTheme = root.getAttribute("data-telegram-theme");
  const write = (name: string, value: string | null) => {
    if (!previous.has(name))
      previous.set(name, {
        value: root.style.getPropertyValue(name),
        priority: root.style.getPropertyPriority(name),
      });
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  };
  const pixels = (value: number | undefined, positive = false) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    (positive ? value > 0 : value >= 0)
      ? `${value}px`
      : null;

  const syncTheme = () => {
    if (!connected) return;
    if (app.colorScheme === "light" || app.colorScheme === "dark")
      root.setAttribute("data-telegram-theme", app.colorScheme);
    else root.removeAttribute("data-telegram-theme");
    const background = getComputedStyle(root)
      .getPropertyValue("--color-bg")
      .trim();
    if (!/^#[0-9a-f]{6}$/i.test(background)) return;
    attempt(() => app.setHeaderColor(background));
    attempt(() => app.setBackgroundColor(background));
    attempt(() => app.setBottomBarColor?.(background));
  };
  const syncViewport: TelegramEventHandler = (event) => {
    if (!connected) return;
    write("--impuls-viewport-height", pixels(app.viewportHeight, true));
    // A drag/animation must not move the shell's lower edge on every frame.
    if (event?.isStateStable !== false)
      write(
        "--impuls-viewport-stable-height",
        pixels(app.viewportStableHeight, true),
      );
  };
  const syncInsets = () => {
    if (!connected) return;
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      write(`--impuls-device-safe-${edge}`, pixels(app.safeAreaInset?.[edge]));
      write(
        `--impuls-content-safe-${edge}`,
        pixels(app.contentSafeAreaInset?.[edge]),
      );
    }
  };
  const handlers: [TelegramEvent, TelegramEventHandler][] = [
    ["themeChanged", syncTheme],
    ["viewportChanged", syncViewport],
    ["safeAreaChanged", syncInsets],
    ["contentSafeAreaChanged", syncInsets],
  ];
  syncTheme();
  syncViewport();
  syncInsets();
  const subscribed: typeof handlers = [];
  if (app.onEvent && app.offEvent) {
    for (const [event, handler] of handlers)
      attempt(() => {
        subscribed.push([event, handler]);
        app.onEvent!(event, handler);
      });
  }
  return () => {
    if (!connected) return;
    connected = false;
    for (const [event, handler] of subscribed)
      attempt(() => app.offEvent?.(event, handler));
    for (const [name, { value, priority }] of previous) {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    }
    if (previousTheme === null) root.removeAttribute("data-telegram-theme");
    else root.setAttribute("data-telegram-theme", previousTheme);
  };
}
