import { describe, expect, it } from "vitest";
import { realtimeResponseSchema } from "./realtime";

const topic = `impuls-${"a".repeat(64)}`;

describe("контракт мгновенных сигналов", () => {
  it("принимает выключенное состояние и полную подписку", () => {
    expect(realtimeResponseSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(
      realtimeResponseSchema.safeParse({
        enabled: true,
        url: "https://example.supabase.co",
        key: "sb_publishable_example",
        topic,
      }).success,
    ).toBe(true);
  });

  it("отвергает не-https адрес, чужую тему и пустой ключ", () => {
    const base = {
      enabled: true,
      url: "https://example.supabase.co",
      key: "k",
      topic,
    };
    expect(
      realtimeResponseSchema.safeParse({ ...base, url: "http://x.co" }).success,
    ).toBe(false);
    expect(
      realtimeResponseSchema.safeParse({ ...base, topic: "other" }).success,
    ).toBe(false);
    expect(realtimeResponseSchema.safeParse({ ...base, key: "" }).success).toBe(
      false,
    );
    expect(realtimeResponseSchema.safeParse({ enabled: true }).success).toBe(
      false,
    );
  });
});
