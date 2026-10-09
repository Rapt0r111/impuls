import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// Изолированный локальный кластер PostgreSQL для проверок БД (README, «Проверки»).
// Только loopback, trust-аутентификация, отдельный каталог данных в .local/pg:
// системная служба PostgreSQL и её данные не затрагиваются.
const root = path.resolve(import.meta.dirname, "..");
const data = path.join(root, ".local", "pg");
const log = path.join(root, ".local", "pg.log");
const port = process.env.LOCAL_DB_PORT ?? "55432";
const database = "impuls_f03";
const user = "impuls_test";
const bin = (name) =>
  path.join(
    process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin",
    process.platform === "win32" ? `${name}.exe` : name,
  );
const url = `postgres://${user}@127.0.0.1:${port}/${database}`;

const run = (name, args, { allowFail = false, detached = false } = {}) => {
  const result = spawnSync(bin(name), args, {
    encoding: "utf8",
    // Сервер наследует каналы вывода и держал бы spawnSync открытым.
    stdio: detached ? "ignore" : "pipe",
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail)
    throw new Error(`${name} failed: ${result.stderr || result.stdout}`);
  return result;
};
const running = () =>
  run("pg_ctl", ["status", "-D", data], { allowFail: true }).status === 0;
const dbExists = () =>
  run(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      port,
      "-U",
      user,
      "-d",
      "postgres",
      "-Atc",
      `SELECT 1 FROM pg_database WHERE datname='${database}'`,
    ],
    { allowFail: true },
  ).stdout.trim() === "1";

function up() {
  if (!existsSync(path.join(data, "PG_VERSION"))) {
    mkdirSync(path.dirname(data), { recursive: true });
    run("initdb", [
      "-D",
      data,
      "-U",
      user,
      "-A",
      "trust",
      "-E",
      "UTF8",
      "--locale=C",
    ]);
  }
  if (!running())
    run(
      "pg_ctl",
      [
        "start",
        "-D",
        data,
        "-l",
        log,
        "-w",
        "-o",
        `-p ${port} -c listen_addresses=127.0.0.1`,
      ],
      { detached: true },
    );
  if (!dbExists())
    run("createdb", ["-h", "127.0.0.1", "-p", port, "-U", user, database]);
  // Роли Supabase: тесты проверяют, что у них нет доступа к схеме impuls.
  const roles = ["anon", "authenticated", "service_role"]
    .map(
      (role) =>
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$;`,
    )
    .join(" ");
  run("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    port,
    "-U",
    user,
    "-d",
    database,
    "-c",
    roles,
  ]);
  console.log(`PostgreSQL ready: ${url}`);
}

function down() {
  if (running()) run("pg_ctl", ["stop", "-D", data, "-m", "fast", "-w"]);
  console.log("PostgreSQL stopped");
}

function migrate() {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "migrate.mjs")],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, MIGRATION_DATABASE_URL: url },
    },
  );
  if (result.status !== 0) throw new Error("migration failed");
}

const commands = {
  up: () => (up(), migrate()),
  down,
  // Полностью пересоздаёт кластер: удаляет только .local/pg.
  reset: () => (
    down(),
    rmSync(data, { recursive: true, force: true }),
    up(),
    migrate()
  ),
  status: () => console.log(running() ? `running: ${url}` : "stopped"),
  env: () => console.log(`$env:TEST_DATABASE_URL='${url}'`),
};
const command = commands[process.argv[2]];
if (!command)
  throw new Error(`Usage: local-db.mjs <${Object.keys(commands).join("|")}>`);
command();
