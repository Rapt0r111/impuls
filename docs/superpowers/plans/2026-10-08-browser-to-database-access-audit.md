# Срез: браузер → реальная БД для «Доступ» и «Журнал» (план)

> Для исполнителей: superpowers:executing-plans. Шаги — чекбоксы.

**Цель:** закрыть два пробела из `docs/verification/2026-10-08-f02-access-management.md` («Не проверено»): показ записей `access.*` в UI журнала и проход экрана «Доступ» через реальный HTTP и PostgreSQL без `page.route`-моков.

**Архитектура:** новый сценарий `tests/browser/access-real.mjs` наполняет изолированную БД (роль `admin`), ставит cookie `impuls_session` и ведёт настоящий браузер по реальному серверу, который уже поднимает `scripts/verify-task-slice.mjs --access-management-only`. Продуктовый код не меняется.

**Стек:** Playwright 1.62.1, pg 8.23.0, существующий stand `TEST_DATABASE_URL` (loopback PostgreSQL).

**Источник:** IMPLEMENTATION_PLAN.md §§ 11–13 (F02/F07, UI-приёмка, шаг 5 «Полный интерфейс R1»); ADR-0023. Только синтетика, P-01…P-06 не затрагиваются.

## Review Focus

- Отзыв права получателем-администратором при открытой странице: следующий запрос → потеря доступа (401/404), не пустой экран.
- Повтор «Подтвердить» после успеха не создаёт вторую привязку (один ключ идемпотентности).
- Запись `access.revoke` видна в журнале только при `admin.audit` в этой области.

## Task 1: Сценарий access-real

**Files:** Create `tests/browser/access-real.mjs`; Modify `scripts/verify-task-slice.mjs` (в ветке `accessOnly` добавить `await run("tests/browser/access-real.mjs")`).

**Interfaces:** Consumes `TEST_DATABASE_URL`, `TEST_APP_ORIGIN`, `TEST_SCREENSHOT_DIR`; cookie `impuls_session` = base64url токен, в БД хранится sha256.

- [ ] Шаг 1. Тест: сид (админ с `admin.access`,`admin.access.manage`,`admin.audit`; участник; область; членство; сессия админа).
- [ ] Шаг 2. Утверждения: выдача `task.assign` через UI (preview → подтверждение) создаёт ровно одну строку `role_bindings` и одну `access_changes`; журнал показывает «Выдача права»; отзыв через UI ставит `revoked_at`; журнал показывает «Отзыв права»; ширины 320/360/390 без горизонтальной прокрутки.
- [ ] Шаг 3. Запуск: `node scripts/verify-task-slice.mjs --access-management-only` → exit 0.
- [ ] Шаг 4. Записать результат в `docs/verification/2026-10-08-access-audit-browser-db.md`, коммит.

## Task 2: Сквозной поток задачи (выполнен)

`tests/browser/task-flow-real.mjs` — создание, назначение, сдача, приёмка, баланс на реальной БД; отчёт `docs/verification/2026-10-08-task-flow-browser-db.md`. Награды в этот срез не входили.
