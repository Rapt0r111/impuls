# F07: отмена будущих синтетических условий

Основание: IMPLEMENTATION_PLAN.md §§ 5–7, 10–12, F02/F06/F07; ADR-0022.

## Контракт до реализации

- POST `/api/v1/admin/rewards/:id/scheduled-versions/cancel`: strict scope, versionId, expectedVersion, reason; UUID Idempotency-Key, session, Origin/CSRF, общий actor limiter. Exact `admin.catalog` и отдельное `admin.catalog.schedule.cancel`; независимый default-false `SYNTHETIC_CATALOG_CANCELLATION_ENABLED` вместе с read flag.
- Только опубликованная future synthetic cosmetic версия. Отмена — append-only evidence с автором/основанием/request ID; условия и публикация не удаляются. Проверка future выполняется сервером после общего identity/quota barrier и повторно DB trigger при INSERT. Начавшиеся условия отменять нельзя. Сохраняем актуальные полномочия после ожидания и перед commit.
- Одна транзакция сохраняет отмену и replay. Повтор после effectiveFrom возвращает исходное подтверждение с повторной проверкой доступа; другое тело под тем же ключом — 409. Другой ключ для отменённой версии — 409. Квоты, баланс и старые заявки сохраняются.
- Все effective readers исключают отменённые версии, история показывает `cancelled`, scoped audit — `catalog.cancel` и исходные условия. Нумерация новой публикации max(saved version)+1: отменённые номера не переиспользуются, previousVersion — действующая версия. Публикация допускает пропуски после отмены.
- Закрытая inline форма под будущей версией: снимок/дата МСК, причина, preview/подтверждение; retry unknown/429/503 с неизменным intent, 409/422 требуют перечитывания, denial очищает protected queries, dirty/Back сохраняют действующий guard. Никаких новых токенов/зависимостей/motion.

## Проверки и границы

PostgreSQL: точные права/flags, immutable evidence/ACL/replay, конкурирующие отмены, deadline и authority после lock wait, сохранение ресурсов/резерва, исключение версии после даты, повторная публикация без переиспользования номера. HTTP и browser-to-DB, ошибки и мобильные 320/360/390 px, restore с ACL. Только синтетика; P-01…P-06, quota edits, Bot API/hosting, target CI/устройства и приёмка F07/R1 остаются открытыми. Внешний выпуск не входит в срез.
