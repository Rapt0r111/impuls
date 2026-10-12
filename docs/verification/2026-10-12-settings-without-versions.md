# Проверка: настройки начислений без «версий» (12 октября 2026)

Основание: [ADR-0036](../adr/0036-settings-without-versions-in-ui.md). Миграций и изменений контрактов API нет; хранение неизменяемых записей `rule_sets` и `rule_publications` прежнее.

## Что изменено

- `apps/app/src/features/rules-admin/rules-admin.tsx` — экран «Настройки начислений»: группы «Проверка отчёта», «Бонусы проверяющего», «Уровни», «Месяц»; «Проверить изменения» показывает только изменённое («было → станет»); без изменений запрос не уходит; «Сохранить»; журнал «Кто и когда менял» без номеров.
- `apps/app/src/features/task-management/task-management.tsx` — выбор версии убран, задача берёт `ruleSets[0]` (действующую); устаревшая заметка «Значения версии 1 тестовые» заменена; номера версий убраны из подтверждений и карточек.
- Номера версий убраны из `tasks/task-list.tsx`, `tasks/task-timeline.tsx`, `reviews/review-queue.tsx`, `ledger/account-ledger.tsx`, `ledger/ledger-corrections.tsx`, `profile/participant-profile.tsx`; пункт «Ещё» и название права `admin.rules` теперь «Настройки начислений».
- Сообщения об ошибках начисления в `api/v1/submissions/[id]/review/route.ts` говорят «настройки начислений».
- Тесты: `tests/browser/{rules-admin,task-management,task-flow-real,task-acceptance,profile}.mjs`.

- Поле «Код категории» → необязательная «Категория» (`task-management.tsx`, `audit-log.tsx`); `task-flow-real.mjs` создаёт задачу без категории и проверяет в базе значение «Без категории».

## Что проверено

- `bun run format:check`, `bun run lint`, `bun run typecheck`: без замечаний (см. отчёт в треде).
- `tests/browser/rules-admin.mjs` (5 сценариев, 320/360/390 px, без горизонтальной прокрутки): на экране нет слова «верси», «Вы ничего не изменили» не шлёт запрос, предпросмотр показывает только изменённое поле, одна отправка с `Idempotency-Key` и CSRF, отказ сервера блокирует повтор.
- Браузерные сценарии с PostgreSQL 16 и сборкой `next start`: `tasks-smoke`, `task-flow-real`, `task-negative-real`, `task-return-real`, `task-submissions`, `task-reviews`, `task-acceptance`, `task-management` (30 сценариев), `task-history`, `task-edit-cancel`, `profile`, `ledger-corrections`, `audit`, `home` — пройдены.
- `scripts/verify-workspace-reflow.mjs`: `{"scenarios":150,"failures":0}`.
- `vitest run tests/integration` (PostgreSQL 16): 461 прошёл, 7 не прошли — все в `tests/integration/profile-name.test.ts`; те же 6 тестов файла падают на `main` (`1c01e6d`) без моих правок, причина в этой среде не выяснена (CI использует PostgreSQL 17).

## Что не проверено

- Telegram WebView на Android и iOS, Production (после слияния нужен деплой; флаг `RULES_MANAGEMENT_ENABLED` уже `true`).
- `tests/browser/` сценарии, не перечисленные выше (каталог, поощрения и др.), не запускались: они не затронуты, но полный `verify-task-slice` прервался на падении `profile-name`.
