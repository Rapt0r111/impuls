# F07: просмотр всех периодов квоты

Дата: 05.10.2026. Основание: IMPLEMENTATION_PLAN.md § 5–6 (отдельные периоды и исходный резерв), F07 § 11, режим ожидания § 10, критерии § 12.

## Контракт до реализации

Существующая таблица quota_periods из 000017 хранит неизменяемые границы/вместимость и изменяемые счётчики. Миграции, grants, зависимости, экономика и архитектура не меняются; ADR не требуется. Никакие периоды, цены, полномочия или реальные данные не создаются.

GET /api/v1/admin/rewards/:id/quotas требует действующего пользователя/сессии, точного admin.catalog в scope и SYNTHETIC_ADMIN_CATALOG_ENABLED=true (по умолчанию false). rewardId должен иметь synthetic cosmetic условия в этой области, включая disabled/future-only. Строгие path/query: UUID id и обязательный scope, limit 1–50 (default 10), optional cursor. Повторы и неизвестные параметры отвергаются. POST 405. Ответ private, no-store.

Один statement snapshot читает авторизацию, доступную identity, anchor и страницу. Ответ: mode synthetic, scope id/name, rewardId, items, nextCursor, updatedAt. Строка: id, startsAt/endsAt UTC, capacity/reserved/used/available, version счётчиков, state past/current/scheduled. available = capacity − reserved − used; это незанятые места, не разрешение новой заявки. Начало включительно, конец исключительно. Сортировка starts_at DESC, id DESC выполняется в PostgreSQL; cursor actor|scope|admin-catalog-quotas|rewardId|periodId привязан к читателю/области/назначению/позиции/существующему периоду. Нет замороженного снимка на все страницы: счётчики и статус перечитываются. Нет получателей, текстов решений, заявок, секретов и сырых БД-ошибок.

401 — отсутствующая/истёкшая сессия; 403 — отозванная сессия/неактивный пользователь; 404 — выключенный flag, скрытая область/identity; 400 — неверные query/cursor/anchor; 503 — временный сбой. Перед показом каждого результата проверяются текущие права.

UI: закрытое native disclosure «Все периоды квоты» отдельно от истории условий. Загрузка по открытию; flat list, текстовый статус, даты МСК и четыре счётчика. Незанятые места прошлого/будущего периода не обозначаются доступными для новой заявки. Отдельные время чтения, refresh (первая страница), next; сообщение о живых счётчиках и отсутствии автоматического возврата. 503/offline сохраняет датированные подтверждённые строки; 400 скрывает страницу до refresh; 401/403/404 очищают оба protected history cache, в том числе по отказу родителя, отменяют параллельные запросы. Scope/item key и AbortSignal исключают позднюю подмену; Telegram Back сначала закрывает disclosure.

## Проверка

Независимые SQL fixtures: future/current/past, нулевая вместимость, прошлый незавершённый резерв, disabled/future-only identity, отсутствие периодов. Полная пагинация по немонотонным UUID и миллисекундам, actor/scope/reward/purpose/period forgery, соседняя область и иной предмет, отзыв/истечение полномочий и сессии, отсутствие admin.catalog, выключенный flag. До/после чтения сравнить реальные таблицы, показать изменение счётчиков без изменения cursor. Реальный HTTP no-store/strict queries/405 и browser-to-DB. Playwright: lazy/keyboard/Back, 320/360/390/1280, enlarged text/reduced motion, loading/empty/recovery/retained error/denial/late response; inspect captures. Typecheck/lint/format/build и контрактные тесты.

За рамками: публикация/редактирование квот и условий, audit публикации, автоматическое истечение, Bot API, remote rollout, устройства, P-01…P-06, полная приёмка F07/R1.
