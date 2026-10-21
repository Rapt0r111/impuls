import { Client } from "pg";

// Пересоздаёт локальную тестовую базу для ci:local, чтобы прогон не зависел от прошлых данных.
// Миграции создают роли кластера, которые DROP DATABASE не удаляет, поэтому они удаляются здесь же.
// Защита: только локальный сервер и база с «test» в имени, чтобы не стереть чужую базу.
const migrationRoles = [
  "impuls_app",
  "impuls_worker",
  "impuls_expiry_worker",
  "impuls_expiry_executor",
];
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
const name = decodeURIComponent(url.pathname.slice(1));
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !name.includes("test")
)
  throw new Error(
    `Сброс только локальной тестовой базы: ${url.hostname}/${name} не подходит`,
  );

url.pathname = "/postgres";
const admin = new Client({ connectionString: url.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  for (const role of migrationRoles)
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}
console.log(`База ${name} пересоздана`);
