# Публикация версий правил из приложения (11 октября 2026)

Срез закрывает пробел из `/mnt/project-files/r1/r1-functional-audit-2026-10-11.md`: пороги уровней, доли фонда, бонусы и часовой пояс менялись только миграцией. Основание: просьба владельца 11.10.2026 («не приходилось хардкодить или менять миграциями»); решение — [ADR-0035](../adr/0035-rules-publication-from-app.md).

## Что изменено

- `db/migrations/000042_rule_publications.js` — право вставки в `rule_sets` для `impuls_app` и неизменяемая `rule_publications`.
- `packages/domain/src/admin/rules.ts`, `packages/contracts/src/rules.ts`, `apps/app/src/app/api/v1/admin/rules/route.ts` — чтение и публикация, идемпотентность, право `admin.rules`, флаг `RULES_MANAGEMENT_ENABLED`.
- `apps/app/src/features/rules-admin/rules-admin.tsx` — экран «Правила начислений» в «Ещё» (предпросмотр, основание, история).
- `packages/domain/src/profile/read.ts` — явно пустая `progression` читается как «уровни не настроены», а не «неверная настройка».
- `.github/workflows/check.yml`, `scripts/scan-secrets.mjs` — шаги `bun audit --prod` и поиска секретов (§ 12 плана, «на каждом PR»).
- ADR-0032 переведён в «принято»: worker работает на Production, доставка подтверждена владельцем 10.10.2026.

## Что проверено (локально, PostgreSQL 17.6 в Docker, роль `impuls_app`)

- `bun run format:check`, `bun run lint`, `bun run typecheck` — без замечаний.
- `npx vitest run tests/integration/rules-management.test.ts` — 8 сценариев: публикация и независимо посчитанные суммы (15 % от фонда 200/100 → бонус 30/15, нижний предел 60 % → 120/60), идемпотентный повтор и конфликт тела, гонка четырёх публикаций даёт подряд идущие номера, отказ без права / при отозванной сессии / неактивном пользователе / выключенном флаге, отклонение неверных порогов, пояса и повторных кодов, неизменяемость истории для `impuls_app`, смена и снятие уровней в профиле.
- `packages/contracts/src/rules.test.ts` — границы запроса.
- `tests/browser/rules-admin.mjs` на сборке `next start` (Playwright, моки API) — 5 сценариев: 320/360/390 px без горизонтальной прокрутки, форма заполнена действующей версией, неверные пороги не отправляются, одна публикация с `Idempotency-Key` и CSRF, экран при выключенном управлении, отказ сервера блокирует повтор. `scripts/verify-workspace-reflow.mjs` — `{"scenarios":150,"failures":0}`.
- `bun run test:integration` целиком: 407 прошли, 59 пропущены, 2 теста и 1 набор не прошли так же, как на `main` до среза: `database-restore` (нет `pg_dump` 17), UI-части `automatic-expiry` и `ledger-corrections` (нужен запущенный `test:task-slice`). CI выполняет их отдельно.

## Не проверено

- Экран в Telegram WebView на Android и iOS, экранным диктором и увеличенным текстом.
- Production: миграция 000042 не применялась, флаг не включался.
- Скилл `impeccable:impeccable` в этой сессии недоступен; визуал экрана не сверялся с макетом (макета для него нет), оформление берёт общий слой `service.css`.
