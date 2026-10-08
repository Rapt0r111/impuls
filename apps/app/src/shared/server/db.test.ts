import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
vi.mock("server-only", () => ({}));
import { getPool } from "./db";

const globals = globalThis as typeof globalThis & {
  impulsPool?: ReturnType<typeof getPool>;
};
afterEach(async () => {
  await globals.impulsPool?.end();
  delete globals.impulsPool;
  vi.unstubAllEnvs();
});

describe("Vercel database TLS configuration boundary", () => {
  it.each([
    "ssl=no-verify",
    "ssl=0",
    "ssl=1",
    "sslmode=disable",
    "sslcert=missing",
    "sslkey=missing",
    "sslrootcert=missing",
    "sslnegotiation=direct",
    "uselibpqcompat=true&sslmode=require",
  ])("preserves explicit CA with %s in DATABASE_URL", (query) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv(
      "DATABASE_URL",
      `postgres://runtime@db.example/synthetic?application_name=app&${query}`,
    );
    vi.stubEnv(
      "SUPABASE_CA_CERT_B64",
      Buffer.from(
        "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
      ).toString("base64"),
    );
    const pool = getPool();
    // Construct the installed driver's client without opening a network connection.
    const client = new Client(pool.options);
    expect(client.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
    });
    expect(
      new URL(pool.options.connectionString!).searchParams.get(
        "application_name",
      ),
    ).toBe("app");
    expect(
      new URL(pool.options.connectionString!).searchParams.has(
        "sslnegotiation",
      ),
    ).toBe(false);
  });
});
