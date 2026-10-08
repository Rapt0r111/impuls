# ADR-0019: автоматическое истечение синтетических резервов

Дата: 05.10.2026. Статус: локальное техническое решение режима ожидания, F06/F04/F07. Основание: IMPLEMENTATION_PLAN.md §§ 5, 8, 10–12 и следующий срез после ADR-0018. ADR-0011 сохраняет явный nullable срок, но оставляет автоматическую обработку отдельным срезом.

## Решение

Существующий Node worker получает отдельные режимы `--expire-once` / `--expire-watch` и независимый default-false `SYNTHETIC_RESERVATION_EXPIRY_ENABLED`. Только synthetic pending с сохранённым достигнутым `expires_at`; NULL/будущие сроки и терминальные заявки не меняются. Миграция не создаёт сроков, людей, LOGIN, реальных условий или экономики. Отзыв доступа не мешает вернуть резерв в баланс; доступ участника и запрет новой доставки сохраняются.

Отдельная NOLOGIN роль `impuls_expiry_worker` имеет USAGE схемы и EXECUTE функции без параметров. Функцией владеет другая NOLOGIN роль `impuls_expiry_executor`, без членства app/worker, bypass RLS или постоянного CREATE. У executor только необходимые SELECT/INSERT и column UPDATE; RLS записи ограничены synthetic expiration. PUBLIC, app и notification worker не получают EXECUTE или service credentials.

SECURITY DEFINER с фиксированным `search_path=pg_catalog` выбирает кандидата и выполняет возврат в одной PostgreSQL-транзакции. Locks: исходная quota (SKIP LOCKED) → баланс → заявка. После ожидания перечитываются состояние, сохранённый срок и серверное время. Исходная цена/квота и season/time zone сохраняются; available += price, reserved -= price, quota.reserved -= 1, XP/used неизменны. Статус, обратная ledger entry, audit и нейтральный outbox атомарны.

Отдельный lease не нужен: незавершённая транзакция откатывается, потерянный ответ после commit безопасно повторяется. Внутренняя идемпотентность основана на terminal state и существующих UNIQUE resolution/audit/outbox индексах по redemption; это отдельный внутренний контракт, не отмена пользовательских Idempotency-Key/expectedVersion/session.

`automatic_expiry` и null actor допустимы только для automatic expired с фиксированным основанием. Trigger требует executor; app не может выдать действие за служебное. API показывает null ID и фиксированное имя обработчика, не создаёт вымышленного пользователя или Telegram ID. Ручные решения сохраняют человеческого автора. Клиентские часы не доказывают возврат.

Два прежних trigger guards разделены на явные ветки: expiration не планирует SELECT к несвязанным ledger_corrections/entitlements. Иначе PostgreSQL generic plan требовал бы лишних privileges даже при ложном левом условии. Проверки настоящих корректировок и выдачи сохраняются.

## Эксплуатация и последствия

До 20 последовательных операций на проход; watch ждёт 1000–60000 мс (default 5000), включая полную пачку. Locked quota откладывается; false не доказывает отсутствие всей просроченной работы. Общие stop/drain/20 s deadline и нейтральный exit 1 сохраняются. Supervisor/hosting/lag monitoring отдельны; Windows hard stop не доказывает POSIX SIGTERM.

Restore обязан сохранять владельцев и ACL: прежний `--no-owner` менял executor на restore owner и нарушал provenance boundary. Rehearsal теперь сравнивает ownership явно и замечает owner drift. Глобальные роли уже существуют в том же кластере; перенос в новый Supabase проект не доказан.

Выпуск: 000027 → совместимый API/UI и worker → проверенные отдельные credentials/контур → явное включение флага. Старые клиенты с обязательным человеческим actor не совместимы с включённым automatic source. Откат: выключить флаг, остановить expiry process, сохранить миграцию и историю. Пакеты, runtime, транспорт и БД сохраняются.

Контракт и проверки: [срез](../implementation/2026-10-05-f06-automatic-expiry-slice.md), [свидетельства](../verification/2026-10-05-f06-automatic-expiry.md). Реальные сроки/поощрения, Bot API, supervisor, P-01…P-06, устройства, целевой CI и приёмка F06/R1 остаются открытыми.
