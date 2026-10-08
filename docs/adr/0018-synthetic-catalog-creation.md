# ADR-0018: выключенная synthetic cosmetic identity

Дата: 05.10.2026. Статус: принято как локальное инженерное продолжение F07 в режиме ожидания § 10; продуктовые P-решения не утверждены.

После публикации условий/будущих квот (ADR-0016/0017) каталог всё ещё требует owner SQL fixture для первой identity. Продолжаем существующий Node/Next/pg/private PostgreSQL контур: POST /api/v1/admin/rewards создаёт серверный UUID и disabled version 1 без квоты. Это уменьшает риск случайного открытия заявок при первоначальном вводе. Включение через отдельную публикацию условий и квота остаются отдельными операциями и правами.

Отдельные exact admin.catalog.create + admin.catalog и default-false flag защищают создание. Append-only private catalog_creations фиксирует первоначальные условия/автора/основание через ссылку на immutable version; atomically сохраняется idempotency response. Audit union получает самостоятельный catalog.create object. Названия не уникальны; одно намерение определяется actor/operation/key/body, разные намерения создают разные identity.

Миграция 000026 additive, без backfill и назначения прав. Выпуск совместный migration/API/UI, отключение flag — откат приложения без удаления истории. Новых зависимостей нет. Проверки и ограничения: docs/implementation/2026-10-05-f07-creation-slice.md и docs/verification/2026-10-05-f07-creation.md. Runtime/transport/модульные границы сохраняются; реальные данные, P-01…P-06 и R1 не разрешаются.
