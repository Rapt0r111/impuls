# F07: просмотр конфигурации синтетического каталога

Основание: F07 § 11, admin.catalog и /admin/rewards § 6, режим ожидания § 10 и проверки § 12 IMPLEMENTATION_PLAN.md. Схема 000001–000022 и SELECT grant 000017 сохраняются. Новые бизнес-правила, зависимости, миграции и архитектурные границы не вводятся; ADR не требуется.

## Контракт

GET /api/v1/admin/rewards?scope=UUID&cursor=actor|scope|admin-catalog|rewardId&limit=1..50 (default 20), отдельный SYNTHETIC_ADMIN_CATALOG_ENABLED=false. Точная активная admin.catalog, активный пользователь и сессия; соседние области, reward.decide/fulfill/admin.audit или членство полномочия не дают. Query строгий, duplicate keys запрещены; ответ private no-store. POST отсутствует (405), цены/квоты/права этим срезом не создаются.

Список всех сохранённых synthetic cosmetic reward identity в выбранной области по reward_id ASC, включая выключенные и будущие позиции. Для каждой: текущая версия на server asOf (effective_from DESC/version DESC/id DESC), ближайшая будущая (effective_from ASC/version DESC/id DESC), текущий период quota или null. Версия: title/conditions/price/enabled/effectiveFrom/reservationSeconds/id/version. Квота: startsAt/endsAt/id/capacity/reserved/used/available. Балансы/пользователи/заявки/тексты решений не передаются. Сводка, доступ и конфигурация читаются одним statement snapshot.

Cursor проверяет actor/purpose/scope и существование identity anchor; подделка даёт 400 INVALID_CURSOR, чужая область 404. Следующая страница закрепляет исходную область независимо от сортировки scopes. Это live pagination по identity, не immutable snapshot условий: refresh возвращает первую страницу. Не показывается полная история версий или будущие периоды квоты.

## UI и проверки

Рабочий раздел «Конфигурация» виден только по admin.catalog. Сохраняются navy/Manrope/mint/gold и flat rows; native details открывает будущую версию. Текст различает «включена» и доступность покупки, показывает отсутствие квоты/срока. Строгий парсинг API, ручной refresh/next page; 503 сохраняет датированную подтверждённую страницу, 401/403/404 очищают protected cache, late response при смене scope игнорируется через AbortSignal. 400 требует первой страницы. Новые операции и формы отсутствуют.

Проверки: строгие запрос/ответ и инвариант суммы квоты; runtime PostgreSQL — current/nearest future/disabled/no quota/empty/authority/cursor/revocation/read nonmutation; настоящий HTTP и browser-to-DB; browser 320/360/390/1280, крупный текст, клавиатура/reduced motion, next/refresh, 503/disabled/denied/cache clearing. Physical Telegram, remote PostgreSQL 17.6, полный write admin catalog/quotas, P-01…P-06 и приёмка F07/F06/R1 остаются открытыми.
