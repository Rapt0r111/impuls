# F07: история версий условий синтетического каталога

Основание: версии каталога и точное admin.catalog (§ 5–6), F07 (§ 11), режим ожидания (§ 10) и проверки (§ 12 IMPLEMENTATION_PLAN.md). Это продолжение read-only конфигурации, без новой архитектуры, миграции, полномочий или зависимости; ADR не требуется. Схема 000001–000022 и SELECT grants 000017 сохраняются.

## Контракт

GET /api/v1/admin/rewards/:id/versions?scope=UUID&limit=1..50&cursor=actor|scope|admin-catalog-history|rewardId|versionId. Scope обязателен, limit default 10. Path/query строгие; неизвестные и повторяющиеся query keys запрещены. POST возвращает 405. Действующая сессия, активный пользователь, отдельное точное admin.catalog и SYNTHETIC_ADMIN_CATALOG_ENABLED=true обязательны. Флаг по умолчанию false; reward.decide/fulfill/admin.audit и членство не дают доступа.

Один SQL statement snapshot связывает актуальные права, доступную позицию, anchor и все версии synthetic cosmetic в выбранной области. Возвращаются id/version/title/conditions/price/enabled/effectiveFrom/reservationSeconds/state, точная область, rewardId, updatedAt и nextCursor. Нет пользователей, балансов, квот, заявок, сырых diff или текста решений. Чтение не создаёт бизнес-записей.

Порядок: effective_from DESC, version DESC, id DESC. В cursor передаётся ID сохранённой версии, сравнение выполняется по её значениям PostgreSQL, без Date/округления. Даты условий сохраняют шесть дробных знаков. Current — последняя версия с effective_from <= asOf, включая выключенную; scheduled — все ещё будущие версии; superseded — остальные уже наступившие версии. Это статус на момент чтения, не доказательство исторической покупки или вступления условий в силу между чтениями. enabled отражает сохранённое поле, не доступность покупки.

Cursor привязан к читателю, точной области, назначению, позиции и доступному anchor. Подмена/неизвестный anchor дают 400 INVALID_CURSOR; отсутствующая позиция или полномочие — одинаковый 404. Неактивный пользователь/отозванная сессия — 403, отсутствующая/истёкшая сессия — 401. Это live pagination, не immutable snapshot: новая версия выше anchor попадёт при refresh первой страницы. Сам cursor не даёт полномочий.

## Направление UI

1. Purpose: оператор читает сохранённые условия одной позиции; пользователь выбрал «Раскрываемая история под позицией».
2. World: существующий Operate, navy/Manrope/mint/gold, плоские разделённые строки, native details; новые токены, активы, тема и motion не нужны.
3. First viewport: текущая конфигурация/квота сохраняют порядок; история изначально закрыта под позицией и не запрашивается до открытия.
4. Interaction: раскрытие клавиатурой, отдельные refresh/next, timestamp каждой страницы и словесные current/future/superseded. Refresh возвращает первую страницу; Back приоритет 20 закрывает историю перед выходом из раздела. Новые операции записи отсутствуют.
5. States: загрузка, страница, пустая страница, unavailable/offline, invalid cursor, denied/disabled/session loss, крупный текст и late scope response. 503 оставляет датированную подтверждённую страницу, next блокируется при ошибке; 400 скрывает текущую страницу до refresh. 401/403/404 очищают все history caches; потеря доступа к родительскому каталогу отменяет history запросы и очищает их cache. Смена scope/позиции перемонтирует disclosure и отменяет запрос через AbortSignal. Квота остаётся отдельной текущей сводкой и не выдаётся за историю квот.

## Проверки и границы

Контракт: scope, purpose, path UUID, limits, strict projection, microsecond dates. Runtime PostgreSQL под impuls_app: все версии, disabled current, future-only, точные микросекунды, равные даты и немонотонные version/effective_from; actor/scope/reward/anchor forgery, соседняя область, недостаточное действие, expired/revoked binding/session, inactive actor, flag и отсутствие мутаций. Настоящий HTTP/no-store/405 и browser-to-database; browser 320/360/390/1280, крупный текст, клавиатура/reduced motion, lazy loading, refresh/next, retained 503, protected-cache clearing/reopening, session loss, empty, late scope response и Back.

API/UI выпускаются совместно. Внешний выпуск, PostgreSQL 17.6 на целевом контуре, EXPLAIN/load на больших данных, physical Telegram Android/iOS, screen reader, backup restore, создание версий/квот и audit их публикации, P-01…P-06 и полная приёмка F07/F06/R1 остаются открытыми. Новая история касается условий, не будущих/прошлых периодов квоты.
