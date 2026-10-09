# Исправление: «Доступ отозван» после изменения прав — 09.10.2026

## Дефект (подтверждён)

Любое изменение `role_bindings` закрывает все сессии пользователя (триггер миграции 000004). Выдача прав владельцу на Production закрыла его сессии: запрос Production показал пользователя `active = true`, 21 право и 0 открытых сессий. Приложение в Telegram слало старый cookie; `/api/v1/me` отвечал 403, а `AccessScreen` сразу показывал «Доступ отозван», не пробуя войти заново по `initData`.

## Исправление

`apps/app/src/features/auth/access-screen.tsx`: при 403 на `/api/v1/me` с данными запуска Telegram выполняется вход (`POST /api/v1/auth/telegram`); без данных остаётся «Доступ отозван». Если аккаунт действительно выведен из допуска, вход вернёт `ACCESS_DENIED` и экран покажет «Доступ не открыт». На экране «Доступ отозван» при наличии Telegram появилась кнопка «Проверить снова».

## Проверено

- Тест-первым: новый сценарий в `tests/browser/access-smoke.mjs` («Stale revoked session») падал по таймауту до правки (приложение оставалось на «Доступ отозван») и прошёл после неё; вариант без `initData` по-прежнему показывает «Доступ отозван».
- `node tests/browser/access-smoke.mjs` — все сценарии прошли (в том числе после обновления моков «Главной»: тест не мокал `/api/v1/leaderboard` и `/api/v1/me/profile`, из-за чего сценарий с отказом разрешений падал на 401; дефект теста, не приложения). `bun run test:telegram` — 14 сценариев (добавлена проверка кнопки «Проверить снова»), `tests/browser/embedded-access.mjs` прошёл.
- `eslint`, `tsc --noEmit`, unit (164 прошли, 438 пропущены); `prettier --check` чисто, кроме `hook.cache.json`.
- `scripts/verify-task-slice.mjs`: общий набор, `--audit-only`, `--notification-status-only`, `--corrections-only`, `--ranking-only`, `--profile-only`, `--access-management-only` — выход 0 у каждого.

## Не проверено

- Поведение на Production под сессией владельца и на физических Android/iOS.
- `access-smoke.mjs` не входит в `verify-task-slice.mjs` и запускается вручную против `localhost:3000`.
