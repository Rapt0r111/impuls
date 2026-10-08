# F01/F08: сохранение явной TLS-конфигурации PostgreSQL

Дата: 04.10.2026. Основание: инженерные границы и проверки § 3, § 8 и § 12 IMPLEMENTATION_PLAN.md; существующая verified TLS конфигурация приложения и worker. Архитектура, схема, зависимости, права и экономика не меняются; отдельный ADR не требуется.

## Подтверждено кодом

Установленные node_modules/pg/lib/connection-parameters.js и node_modules/pg-connection-string/index.js показывают, что параметры connectionString переопределяют переданный объект ssl. Прежняя защита учитывала sslmode/sslcert/sslkey/sslrootcert, но пропускала ssl и sslnegotiation. ssl=no-verify отключал rejectUnauthorized; ssl=0 отключал TLS.

apps/app/src/shared/server/db.ts в Vercel удаляет также ssl, sslnegotiation и uselibpqcompat перед передачей URL драйверу. Явные rejectUnauthorized=true и CA сохраняются. Локальный режим приложения сохраняет прежнее поведение.

apps/worker/src/database-tls.ts запрещает все семь TLS-параметров URL, включая пустые значения; index.ts вызывает проверку до создания пула. Worker продолжает использовать отдельный CA для внешнего адреса. Не связанные с TLS application_name/options сохраняются. Нейтральный CLI error и disabled режим не меняются.

## Проверено командами

- `bunx vitest run apps/worker/src/database-tls.test.ts apps/app/src/shared/server/db.test.ts` — exit 0, 17 тестов. Проверяется фактический Client установленного pg без подключения: сохранение CA и проверки сертификата при опасных URL-параметрах; worker отклоняет параметры до пула.
- `bun run typecheck` — exit 0, четыре workspace.
- `bunx eslint apps/worker/src/database-tls.ts apps/worker/src/database-tls.test.ts apps/worker/src/index.ts apps/app/src/shared/server/db.ts apps/app/src/shared/server/db.test.ts` — exit 0.
- `bun run build:worker` — exit 0.
- `bunx vitest run apps/worker/src/loop.test.ts packages/domain/src/notifications/simulation.test.ts` — exit 0, 9 тестов.
- `bun run build:app` — exit 0, production build Next.js.
- `bun audit` — exit 1: ConnectionRefused при POST к registry.npmjs.org. Аудит зависимостей не выполнен.

## Не проверено

Реальное TLS-рукопожатие с Supabase, интеграционный PostgreSQL прогон и внешний выпуск этим изменением не выполнялись. Следующая проверка подключения должна использовать целевой CA и отдельный синтетический контур, включая отказ при неверном сертификате. Нового UI нет. P-01…P-06, устройства, Bot API и полная приёмка F01/F08/R1 остаются открытыми.
