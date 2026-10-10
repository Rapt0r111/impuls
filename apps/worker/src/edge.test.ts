import { describe, expect, it } from "vitest";
import { createTickHandler } from "./edge";

const secret = "s".repeat(40);
const post = (authorization?: string, method = "POST") =>
  new Request("http://edge.test/tick", {
    method,
    headers: authorization ? { authorization } : {},
  });
const handler = (vars: Record<string, string>, lines: string[] = []) =>
  createTickHandler(
    "simulation",
    (name) => vars[name],
    (line) => lines.push(line),
  );

describe("scheduled worker tick", () => {
  it("rejects other methods and missing, short or wrong secrets before any work", async () => {
    const vars = {
      WORKER_TRIGGER_SECRET: secret,
      SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
    };
    expect((await handler(vars)(post(`Bearer ${secret}`, "GET"))).status).toBe(
      405,
    );
    expect((await handler(vars)(post())).status).toBe(401);
    expect((await handler(vars)(post("Bearer wrong"))).status).toBe(401);
    expect((await handler(vars)(post(secret))).status).toBe(401);
    const short = { ...vars, WORKER_TRIGGER_SECRET: "short" };
    expect((await handler(short)(post("Bearer short"))).status).toBe(401);
    expect((await handler({})(post("Bearer "))).status).toBe(401);
  });

  it("reports disabled without a database URL when the flag is off", async () => {
    const lines: string[] = [];
    const response = await handler(
      { WORKER_TRIGGER_SECRET: secret },
      lines,
    )(post(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "simulation",
      status: "disabled",
    });
    expect(lines).toEqual(['{"mode":"simulation","status":"disabled"}']);
  });

  it("answers a neutral 503 for missing URL, missing CA, TLS URL options or bad token", async () => {
    const base = {
      WORKER_TRIGGER_SECRET: secret,
      SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
    };
    const url =
      "postgresql://impuls_worker.ref:pw-secret@db.example.test:5432/postgres";
    const cases: Record<string, string>[] = [
      base,
      { ...base, NOTIFICATION_WORKER_DATABASE_URL: url },
      {
        ...base,
        NOTIFICATION_WORKER_DATABASE_URL: `${url}?sslmode=require`,
        WORKER_CA_CERT_B64: "Y2E=",
      },
      {
        ...base,
        NOTIFICATION_WORKER_DATABASE_URL: url,
        WORKER_CA_CERT_B64: "Y2E=",
        TELEGRAM_DELIVERY_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "bad",
      },
    ];
    for (const vars of cases) {
      const lines: string[] = [];
      const response = await handler(vars, lines)(post(`Bearer ${secret}`));
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toMatch(/WORKER_UNAVAILABLE/);
      expect(text + lines.join("")).not.toMatch(/pw-secret|example\.test|bad/);
    }
  });
});
