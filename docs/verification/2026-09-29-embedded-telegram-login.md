# Вход во встроенном Telegram Web — 29.09.2026

## Изменение

- Вход выдаёт cookie `impuls_session` с `HttpOnly; Secure; SameSite=None; Partitioned; Path=/`, чтобы браузер отправлял её при API-запросах из iframe Telegram Web.
- Выход удаляет cookie с теми же атрибутами.
- Причина и последствия для CSRF зафиксированы в [ADR-0002](../adr/0002-embedded-telegram-session-cookie.md); § 4 плана и `PRODUCT.md` обновлены.

## Проверено командами

| Команда / действие                                                                                                                                                            | Результат                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                                                                                                               | Код 0. Prettier, ESLint, четыре TypeScript-проверки, 8 unit-тестов и сборки app/worker прошли. 5 интеграционных тестов PostgreSQL пропущены без `TEST_DATABASE_URL`.                                                                                                                                                             |
| `TEST_APP_ORIGIN=http://localhost:3002 bun tests/browser/access-smoke.mjs` (PowerShell: `$env:TEST_APP_ORIGIN = 'http://localhost:3002'; bun tests/browser/access-smoke.mjs`) | Код 0. Синтетический Chromium-тест прошёл: `SameSite=Lax` блокируется в стороннем iframe; после повторного входа `SameSite=None; Partitioned` передаётся; остальные сценарии доступа тоже прошли. Для локального loopback тест отключает Chromium `LocalNetworkAccessChecks`; настройка применяется только к тестовому браузеру. |
| `bunx vercel deploy --target preview --yes --scope antons-projects-fd079868`                                                                                                  | Preview `https://impuls-aqrf0iqoc-antons-projects-fd079868.vercel.app`, состояние `READY`, сборка прошла. Его `/api/v1/me` вернул `503`, потому что Preview не имеет полного набора Production-переменных.                                                                                                                       |
| `bunx vercel deploy --prod --yes --scope antons-projects-fd079868`                                                                                                            | Production deployment `dpl_BrrhJspxRPjH4kPuNb5VXAWqEwSL`, состояние `READY`; alias `https://impuls-eta.vercel.app` обновлён.                                                                                                                                                                                                     |
| `GET https://impuls-eta.vercel.app/api/v1/me` и `GET .../api/v1/me/permissions` без cookie                                                                                    | Оба вернули ожидаемый `401 UNAUTHORIZED`; это проверяет защищённость API без действующей сессии, не сам вход пользователя.                                                                                                                                                                                                       |

## Проверено по скриншоту пользователя

После выпуска пользователь прислал скриншот Mini App в Telegram Web: экран «Доступ подтверждён», имя «Тестовый участник», список полномочий пуст. Это подтверждает фактический вход в используемом Telegram Web-клиенте после изменения cookie.

## Не проверено

- Telegram WebView на Android и iOS и повторное открытие приложения на этих устройствах.
- Интеграционные тесты с PostgreSQL в текущем локальном запуске; для них требуется `TEST_DATABASE_URL`.
- Реальный пилот и использование реальных данных: решения P-01/P-02 остаются открытыми.
