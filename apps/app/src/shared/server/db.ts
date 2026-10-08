import "server-only";
import { Pool } from "pg";

const globalForPool = globalThis as typeof globalThis & { impulsPool?: Pool };

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!globalForPool.impulsPool) {
    let ssl: { rejectUnauthorized: true; ca: string } | undefined;
    let runtimeConnectionString = connectionString;
    if (process.env.VERCEL) {
      const encodedCa = process.env.SUPABASE_CA_CERT_B64;
      if (!encodedCa) throw new Error("SUPABASE_CA_CERT_B64 is not configured");
      const ca = Buffer.from(encodedCa, "base64").toString("utf8");
      if (!ca.startsWith("-----BEGIN CERTIFICATE-----")) {
        throw new Error("SUPABASE_CA_CERT_B64 is invalid");
      }
      ssl = { rejectUnauthorized: true, ca };

      // pg-connection-string's sslmode options override the explicit `ssl` object.
      // Keep TLS verification controlled by this CA instead of DATABASE_URL.
      const parsedUrl = new URL(connectionString);
      for (const option of [
        "ssl",
        "sslmode",
        "sslrootcert",
        "sslcert",
        "sslkey",
        "sslnegotiation",
        "uselibpqcompat",
      ]) {
        parsedUrl.searchParams.delete(option);
      }
      runtimeConnectionString = parsedUrl.toString();
    }
    globalForPool.impulsPool = new Pool({
      connectionString: runtimeConnectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ssl,
    });
  }
  return globalForPool.impulsPool;
}
