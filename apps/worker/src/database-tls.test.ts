import { describe, expect, it } from "vitest";
import { assertWorkerTlsUrl, databaseTlsUrlOptions } from "./database-tls";

describe("worker TLS configuration boundary", () => {
  it.each(databaseTlsUrlOptions)(
    "rejects URL override %s before creating a pool",
    (key) => {
      const url = new URL("postgres://worker:private@db.example/synthetic");
      url.searchParams.set(key, "no-verify");
      expect(() => assertWorkerTlsUrl(url)).toThrow(
        "Configure database TLS through SUPABASE_CA_CERT_B64",
      );
      url.searchParams.set(key, "");
      expect(() => assertWorkerTlsUrl(url)).toThrow();
    },
  );
  it("retains unrelated PostgreSQL connection settings", () => {
    expect(() =>
      assertWorkerTlsUrl(
        new URL(
          "postgres://worker@localhost/synthetic?application_name=simulation&options=-c%20role%3Dimpuls_worker",
        ),
      ),
    ).not.toThrow();
  });
});
