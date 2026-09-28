# Проверка каркаса R1 и начатого F01 — 28.09.2026

Это историческая проверка первоначального контура Caddy/PostgreSQL 18.6. Позднее в тот же день пользователь выбрал Vercel/Supabase; изменение зафиксировано в `docs/adr/0001-vercel-supabase.md`, новая проверка — в `docs/verification/2026-09-28-vercel-supabase.md`. Указанные ниже Caddy/standalone-команды больше не являются текущей конфигурацией.

## Подтверждено кодом

- Корневой `package.json` задаёт Bun workspaces и отдельную команду `demo:test`; автономные `work/*` не импортируются в `apps/app`.
- `db/migrations/000001_auth.js` создаёт пустой allowlist и таблицу сессий. В БД хранится SHA-256 токена, а отключение пользователя отзывает сессии триггером.
- `packages/domain/src/auth/telegram.ts` проверяет HMAC, срок `auth_date` и ID до обращения к БД. Алгоритм сверялся с [документацией Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
- `apps/app/src/app/api/v1/auth/telegram/route.ts`, `me/route.ts` и `auth/logout/route.ts` дают начальный JSON API; `apps/app/src/features/auth/access-screen.tsx` показывает состояния доступа без данных R0.
- `infra/Caddyfile` — шаблон выбранной схемы `handle_path`, `file_server { precompressed br gzip }`, `reverse_proxy`; соответствующий синтаксис сверен с [handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path), [file_server](https://caddyserver.com/docs/caddyfile/directives/file_server), [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Локально Caddy не запускался.

## Проверено командой и браузером

| Команда / проверка                                                                      | Результат                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun --version`; `node --version`                                                       | 1.4.2; 24.21.0                                                                                                                                                                                                                                                         |
| `bun install --frozen-lockfile`                                                         | 425 установок из 526 пакетов проверены, изменений нет                                                                                                                                                                                                                  |
| `bun run check`                                                                         | формат, lint, строгий TypeScript, 6 unit-тестов и сборка проходят; 1 PostgreSQL-тест пропущен                                                                                                                                                                          |
| `bun run demo:test`                                                                     | автономные тесты R0 проходят; это не приёмка сервиса                                                                                                                                                                                                                   |
| `bun run test:integration`                                                              | 1 тест пропущен: `TEST_DATABASE_URL` отсутствует, PostgreSQL в локальной среде не найден                                                                                                                                                                               |
| Standalone `bun run start`                                                              | главная `200`, файл шрифта из `/_next/static` `200`; `GET /api/v1/me` без секретов `503`                                                                                                                                                                               |
| Отдельный Node-процесс с синтетическими тестовыми секретами, HTTP-запросы к `/api/v1`   | `GET /me` без cookie `401`; неверная Telegram-подпись `401`; POST без `Origin` `403`                                                                                                                                                                                   |
| Playwright, production-сборка, 320/360/390 px                                           | состояние «Откройте в Telegram» без горизонтального обрезания; 320 px с `503` показывает кнопку повтора. Ответы API и Telegram bridge в этом визуальном проходе подменены специально, серверная авторизация ими не доказана. Снимки: `.impeccable/review/final-*.png`  |
| Impeccable `detect --json`                                                              | 5 advisory по размерам 16–18 и 30 px: детектор сравнивает экран с R0 шкалой, а R1 шкала задана § 7 плана и отражена в `DESIGN.md`. Других находок нет.                                                                                                                 |
| Повторная проверка `node tests/browser/access-smoke.mjs` на standalone через Playwright | Задержанный Telegram script: через 8 секунд показано «Откройте в Telegram». Задержанный `GET /me`: через 10 секунд показано «Сервис недоступен». Подменённый успешный вход показывает «Доступ подтверждён». Сценарий не подтверждает работу реального Telegram или БД. |

Проверены установленные версии и метаданные лицензий основных добавленных пакетов: Next 16.3.6, React 19.3.0, Tailwind 4.3.3, `@tailwindcss/postcss` 4.3.3, `pg` 8.23.0, Zod 4.6.5 и `node-pg-migrate` 9.0.0 — MIT; `rate-limiter-flexible` 11.2.1 — ISC. В собранной `.next/static/chunks` 7 JS-файлов суммарно 968 649 байт до сжатия; это размер всех чанков в каталоге, не измерение загрузки конкретного экрана. Сборка подтверждает совместимость используемых версий, но не производительность устройства.

Первый повторный `bun run check` после запуска standalone на Windows завершился `EBUSY` при очистке `.next/standalone`. После остановки сервера повтор этой команды прошёл. Одновременно собирать и запускать один каталог standalone нельзя.

При повторном аудите исправлено бесконечное ожидание Telegram bridge и зависшего API-запроса в `apps/app/src/features/auth/access-screen.tsx`; `*.tsbuildinfo` исключён из Git. Telegram script перенесён в асинхронный тег `<head>`, чтобы интерфейс не зависел от завершения его загрузки. В итоговом HTML Next.js размещает свои скрипты раньше Telegram script, поэтому буквальный порядок из документации Telegram не подтверждён; запуск в реальном WebView обязателен. После правки `bun run check` прошёл: 6 unit-тестов, 1 PostgreSQL-тест пропущен, сборка успешна. Браузерная проверка в `tests/browser/access-smoke.mjs` требует запущенный standalone на `http://127.0.0.1:3000` и остаётся синтетической.

## Предложено и требует проверки

- Выполнить `bun run db:migrate`, затем `TEST_DATABASE_URL=... bun run test:integration` на PostgreSQL 18.6 и проверить SQL-инварианты и HTTP-контракт с реальной БД. В CI это настроено, но результат CI ещё не получен.
- Проверить `initData` из реального Main Mini App, cookie `Secure`, safe areas и все состояния на Telegram Android/iOS. Локальные мок-ответы этого не подтверждают.
- Проверить `infra/Caddyfile` командой `caddy validate`, статическое сжатие, заголовки и доверенный `X-Real-IP` в утверждённом контуре. Сейчас Caddy отсутствует.
- Дополнить F01 контрактными и e2e-тестами, машинным экспортом wire-схем и проверкой 429. Затем перейти к F02 (права по действию и области).
- `bun run check` сам по себе не подтверждает F01: PostgreSQL-тест без `TEST_DATABASE_URL` пропускается, HTTP-контракт с реальной БД, Android/iOS и требуемые § 12 проверки ещё не выполнены.

## Требует решения владельца

P-01…P-06 из § 10 плана не утверждены. Настоящие участники, реальные служебные сведения и публичный пилот не подключаются.
