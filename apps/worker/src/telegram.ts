import {
  NotificationTransportError,
  NotificationTransportFatal,
  type SimulationTransport,
} from "@impuls/domain/notification-simulation";

const OFFICIAL_API = "https://api.telegram.org";

// Bot API base for the worker. Only the official host or a loopback http double (tests).
export function telegramApiBase(override: string | undefined): string {
  if (override === undefined || override === "") return OFFICIAL_API;
  const url = new URL(override);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "http:" || !loopback || url.username || url.password)
    throw new Error("Invalid Telegram API base");
  return url.origin;
}

export function assertBotToken(token: string | undefined): string {
  if (!token || !/^\d{5,}:[\w-]{20,}$/.test(token))
    throw new Error("Telegram bot token required");
  return token;
}

type BotResponse = {
  ok?: unknown;
  error_code?: unknown;
  description?: unknown;
  parameters?: { retry_after?: unknown };
};

// sendMessage with fixed neutral text. No exception, status text or URL leaves this function:
// the token is part of the request path and responses may name the recipient.
export function createTelegramTransport(options: {
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): SimulationTransport {
  const base = telegramApiBase(options.apiBase);
  const token = assertBotToken(options.token);
  const send = options.fetchImpl ?? fetch;
  return async ({ chatId, text, signal }) => {
    const chat = Number(chatId);
    if (!chatId || !Number.isSafeInteger(chat) || chat <= 0)
      throw new NotificationTransportFatal("Invalid chat ID");
    let response: Response;
    try {
      response = await send(`${base}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
        redirect: "error",
        signal,
      });
    } catch {
      throw new NotificationTransportError("transport_unavailable");
    }
    let body: BotResponse = {};
    try {
      body = (await response.json()) as BotResponse;
    } catch {
      // Gateway errors may not be JSON; the status code still classifies them.
    }
    if (response.status === 200 && body.ok === true) return "delivered";
    const description =
      typeof body.description === "string" ? body.description : "";
    if (response.status === 429) {
      const wait = Number(body.parameters?.retry_after);
      throw new NotificationTransportError(
        "rate_limited",
        Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : undefined,
      );
    }
    // Blocked bot, deactivated user or a chat the bot cannot open: permanent for this recipient.
    if (
      response.status === 403 ||
      (response.status === 400 && /chat not found/i.test(description))
    )
      throw new NotificationTransportError("recipient_unreachable");
    // Bad token or unknown method: every event would fail the same way.
    if (response.status === 401 || response.status === 404)
      throw new NotificationTransportFatal("Bot API rejected the credentials");
    throw new NotificationTransportError("transport_unavailable");
  };
}
