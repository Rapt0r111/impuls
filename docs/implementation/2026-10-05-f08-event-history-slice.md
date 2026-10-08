# F08/F07: постраничные события симуляции

Дата: 05.10.2026. Основание: IMPLEMENTATION_PLAN.md §§ 3–4, 10–12, F08 «статус события без секретного текста» и F07 точные права. Локальные синтетические данные; P-01…P-06 не утверждаются.

## Контракт до реализации

Схема 000001–000022 и grants сохраняются. GET `/api/v1/admin/notifications/events` требует активного actor/session, точного `admin.notifications` и прежнего `SYNTHETIC_NOTIFICATION_STATUS_ENABLED=true` (default false). Обязательный scope UUID, limit 1–50 (default 10), optional cursor; неизвестные/повторные параметры запрещены. POST 405, ответы private/no-store.

Один statement snapshot читает доступ, область, доступный anchor и страницу. Источники и фильтры совпадают со сводкой: pending synthetic outbox, область сохранённой задачи/заявки. Ответ: mode simulation, scope id/name, updatedAt, items (только allowlisted kind/createdAt/status/errorCode), nextCursor. Получатели, тексты, source IDs, попытки, lease и секреты отсутствуют. Курсор actor|scope|notification-events|eventId связан с читателем/областью/назначением и проверяемым событием; это служебный anchor, не полномочие. Порядок `(created_at DESC,id DESC)` и сравнение anchor выполняются в PostgreSQL без потери микросекунд. Статусы живые; нет замороженного снимка между страницами. Новый event выше anchor виден после обновления первой страницы.

401 — отсутствующая/истёкшая сессия, 403 — отзыв/неактивный пользователь, 404 — flag/область скрыты, 400 — query/cursor/исчезнувший anchor, 503 — временный сбой. Доступ проверяется до anchor, чтобы скрытая область не раскрывалась через ошибку cursor.

Пользователь выбрал закрытое native disclosure «Все события» с отдельными refresh/next и timestamp. Существующая сводка и последние 20 событий сохраняются. Lazy query по открытию, Back сначала закрывает disclosure. Первая страница при refresh; 503/offline сохраняет датированные строки. 400 скрывает изменившуюся страницу до refresh. 401/403/404 отменяют параллельные queries и очищают обе protected caches; отказ сводки также очищает страницы. Scope key и AbortSignal запрещают позднюю подмену. Время создания явно не означает обработку/доставку; список не является журналом попыток.

## Проверки

Контракты и реальные PostgreSQL fixtures: более 20 событий, tie UUID и микросекунды, полная пагинация без дублей, новые события, живые статусы, исчезнувший/чужой anchor, actor/scope/purpose forgery, соседняя область, отсутствие/истечение/отзыв права и сессии, flag false. Сравнение записей до/после чтения. HTTP strict query/no-store/405 и browser-to-DB. Browser 320/360/390/1280, enlarged text/reduced motion, keyboard/Back, lazy/loading/empty/retained failure/recovery/access cleanup/late response. Format/lint/typecheck/unit/build.

За рамками: журнал каждой попытки, реальный Bot API, supervisor/hosting, catalog writes, automatic expiry, внешний выпуск, устройства, P-решения и полная приёмка F08/F07/R1. Архитектура и зависимости не меняются; новый ADR не требуется.
