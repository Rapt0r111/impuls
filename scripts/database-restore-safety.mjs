// This rehearsal never accepts an external server or a caller-supplied restore target.
export function localRestoreConnection(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Restore rehearsal requires a local TEST_DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.username ||
    !/^\/[a-zA-Z0-9_]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Restore rehearsal requires a local TEST_DATABASE_URL without options",
    );
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

export function restoreDatabaseName(runId, purpose) {
  if (!/^[0-9a-f]{32}$/.test(runId) || !["source", "target"].includes(purpose))
    throw new Error("Invalid disposable restore database identity");
  return `impuls_restore_${runId}_${purpose}`;
}

export function restoreToolEnvironment(connection, database) {
  if (!/^impuls_restore_[0-9a-f]{32}_(source|target)$/.test(database))
    throw new Error("Invalid disposable restore database identity");
  // Do not inherit PGOPTIONS, a service file or application secrets into libpq.
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: database,
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "impuls_restore_rehearsal",
  };
}
