import { describe, expect, it } from "vitest";
import {
  NotificationTransportError,
  NotificationTransportFatal,
} from "@impuls/domain/notification-simulation";
import {
  assertBotToken,
  createTelegramTransport,
  telegramApiBase,
} from "./telegram";

const token = `123456789:${"A".repeat(35)}`;
const message = (chatId: string | null = "88888888881") => ({
  eventId: "e",
  recipientId: "r",
  chatId,
  text: "Нейтральный текст.",
  signal: new AbortController().signal,
});
const answer = (status: number, body: unknown) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
const send = (fetchImpl: typeof fetch) =>
  createTelegramTransport({ token, fetchImpl });

describe("Telegram Bot API transport", () => {
  it("posts only chat_id and the fixed text to the token path, without redirects", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = send((async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as typeof fetch);
    await expect(transport(message())).resolves.toBe("delivered");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://api.telegram.org/bot${token}/sendMessage`,
    );
    expect(calls[0]!.init).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      chat_id: 88888888881,
      text: "Нейтральный текст.",
    });
  });

  it.each([
    [
      403,
      { ok: false, description: "Forbidden: bot was blocked" },
      "recipient_unreachable",
    ],
    [
      400,
      { ok: false, description: "Bad Request: chat not found" },
      "recipient_unreachable",
    ],
    [
      400,
      { ok: false, description: "Bad Request: message is too long" },
      "transport_unavailable",
    ],
    [500, { ok: false }, "transport_unavailable"],
    [502, "<html>Bad gateway</html>", "transport_unavailable"],
    [200, { ok: false }, "transport_unavailable"],
    [200, "not json", "transport_unavailable"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    await expect(
      send(answer(status, body) as never)(message()),
    ).rejects.toMatchObject({
      constructor: NotificationTransportError,
      code,
    });
  });

  it("reads retry_after from 429 and ignores nonsense hints", async () => {
    for (const [hint, expected] of [
      [42, 42],
      [1.2, 2],
      [-5, undefined],
      ["soon", undefined],
      [undefined, undefined],
    ] as const)
      await expect(
        send(
          answer(429, {
            ok: false,
            parameters: { retry_after: hint },
          }) as never,
        )(message()),
      ).rejects.toMatchObject({
        code: "rate_limited",
        retryAfterSeconds: expected,
      });
  });

  it("treats rejected credentials and unknown methods as fatal for the whole worker", async () => {
    for (const status of [401, 404])
      await expect(
        send(answer(status, { ok: false }) as never)(message()),
      ).rejects.toBeInstanceOf(NotificationTransportFatal);
  });

  it("never lets a network error, its cause or the token escape", async () => {
    const transport = send((async () => {
      throw new TypeError(`fetch failed for /bot${token}/sendMessage`);
    }) as never);
    const error = await transport(message()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationTransportError);
    expect((error as Error).message).toBe("transport_unavailable");
    expect(String((error as Error).stack)).not.toContain(token);
  });

  it("refuses unusable chat IDs before any request", async () => {
    let calls = 0;
    const transport = send((async () => {
      calls++;
      return new Response("{}");
    }) as never);
    for (const chatId of [null, "", "0", "-5", "abc", "9007199254740993"])
      await expect(transport(message(chatId))).rejects.toBeInstanceOf(
        NotificationTransportFatal,
      );
    expect(calls).toBe(0);
  });

  it("accepts the official host or a loopback http double only", () => {
    expect(telegramApiBase(undefined)).toBe("https://api.telegram.org");
    expect(telegramApiBase("")).toBe("https://api.telegram.org");
    expect(telegramApiBase("http://127.0.0.1:8081/ignored")).toBe(
      "http://127.0.0.1:8081",
    );
    for (const bad of [
      "https://api.telegram.org",
      "http://example.com",
      "https://127.0.0.1",
      "http://user:pw@127.0.0.1",
      "not a url",
    ])
      expect(() => telegramApiBase(bad)).toThrow();
  });

  it("validates the token shape without echoing it", () => {
    expect(assertBotToken(token)).toBe(token);
    for (const bad of [
      undefined,
      "",
      "abc",
      "123:short",
      `x:${"A".repeat(35)}`,
    ])
      expect(() => assertBotToken(bad)).toThrow("Telegram bot token required");
  });
});
