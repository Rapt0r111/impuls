# F06: локальная выдача синтетической косметики

Источник: IMPLEMENTATION_PLAN.md §§ 5–7, F06/F02/F07 в § 11 и проверки § 12; продолжение ADR-0008/0009. P-01…P-06 не утверждаются.

- Миграция 000019: approved → fulfilled с отдельными actor/reason/time, неизменяемым решением и условиями. Уникальное immutable entitlement на user/reward/scope и заявку. Отложенная проверка связывает переход и entitlement в одной транзакции; миграция не выдаёт существующие approved автоматически.
- Точное `reward.fulfill`, активная сессия и получатель, запрет собственной выдачи. `reward.decide`, `admin.catalog` и родительская область не дают этого права. Членство/текущая цена/окончание квоты не отменяют уже одобренный снимок. Отзыв получателя блокирует выдачу; возврат approved потребует отдельного контракта.
- POST `/api/v1/redemptions/:id/fulfill`: только `{expectedVersion,reason}`, UUID Idempotency-Key, Origin/CSRF, bounded JSON, общий mutation limiter, private no-store. GET `/api/v1/redemptions/fulfillment` — только чужие approved в точной области с пагинацией. Ответы используют типизированный redemption с fulfillment evidence.
- Переход, entitlement, audit, нейтральный outbox и сохранённый ответ атомарны. Права/сессия проверяются до replay и после ожидания locks. Порядок quota → balance → redemption совпадает с предыдущими операциями. Выдача не меняет XP, available/reserved, баланс version, used/reserved квоты и не добавляет финансовых строк.
- Существующая очередь и встроенная форма показывают сохранённые условия, исходную цену, получателя и согласование. Обязательны основание и новое подтверждение; unknown/429/503 сохраняют исходный запрос для ручного replay. Личная история показывает право владения и выдачу. Купленный предмет недоступен для повторной покупки в той же области.
- Проверки: PostgreSQL runtime роль, двойная выдача, replay/body conflict, соседняя область/себя/нет права/отзыв/истечение за lock wait, rollback outbox, DB invariants и upgrade с approved; HTTP и реальный browser-to-DB путь, состояния UI и 320/360/390/1280 px.

Служебные позиции, экипировка/активация косметики, истечение, отмена approved, администрирование каталога, reward audit reader, worker delivery, устройства и внешний выпуск остаются отдельными срезами. Флаг SYNTHETIC_REWARDS_ENABLED выключен по умолчанию.
