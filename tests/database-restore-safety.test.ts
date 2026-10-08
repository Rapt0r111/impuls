import { describe, expect, it } from "vitest";
import {
  localRestoreConnection,
  restoreDatabaseName,
  restoreToolEnvironment,
} from "../scripts/database-restore-safety.mjs";

describe("restore rehearsal safety boundary", () => {
  it("rejects external, incomplete and option-bearing connections", () => {
    for (const value of [
      undefined,
      "",
      "https://localhost/test",
      "postgres://test@db.example.com/test",
      "postgres://test@127.0.0.1.evil/test",
      "postgres://test@localhost/",
      "postgres://localhost/test",
      "postgres://test@localhost/test?options=-c%20role=postgres",
      "postgres://test@localhost/test#other",
    ])
      expect(() => localRestoreConnection(value)).toThrow();
  });

  it("accepts loopback and decodes credentials without putting them in a URI", () => {
    expect(
      localRestoreConnection(
        "postgresql://test:p%40ss@127.0.0.1:55432/impuls_test",
      ),
    ).toEqual({
      host: "127.0.0.1",
      port: 55432,
      user: "test",
      password: "p@ss",
      database: "impuls_test",
    });
    expect(
      localRestoreConnection("postgres://test@[::1]/impuls_test").host,
    ).toBe("::1");
  });

  it("cannot form a database identifier from caller-supplied names or SQL", () => {
    expect(restoreDatabaseName("a".repeat(32), "source")).toBe(
      `impuls_restore_${"a".repeat(32)}_source`,
    );
    for (const [id, purpose] of [
      ["production", "source"],
      ["a".repeat(32), "production"],
      ['x"; DROP DATABASE postgres;--', "target"],
    ])
      expect(() => restoreDatabaseName(id, purpose)).toThrow();
    expect(() => restoreToolEnvironment({}, "postgres")).toThrow();
  });

  it("keeps the selected target and credentials in a minimal libpq environment", () => {
    const env = restoreToolEnvironment(
      { host: "127.0.0.1", port: 5432, user: "test", password: "synthetic" },
      restoreDatabaseName("b".repeat(32), "target"),
    );
    expect(env.PGDATABASE).toBe(`impuls_restore_${"b".repeat(32)}_target`);
    expect(env.PGPASSWORD).toBe("synthetic");
    for (const key of [
      "PGOPTIONS",
      "PGSERVICE",
      "DATABASE_URL",
      "TELEGRAM_BOT_TOKEN",
      "CSRF_SECRET",
    ])
      expect(env).not.toHaveProperty(key);
  });
});
