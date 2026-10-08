export const databaseTlsUrlOptions = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
] as const;

export function assertWorkerTlsUrl(url: URL): void {
  if (databaseTlsUrlOptions.some((key) => url.searchParams.has(key)))
    throw new Error("Configure database TLS through SUPABASE_CA_CERT_B64");
}
