# Выпуск миграций 000036–000038 в Production — 10.10.2026

Основание: запрос владельца «Закоммить и примени миграции» (10.10.2026). Проект `enicnfevahcuiqvwmhgp`, PostgreSQL 17.6, только синтетические данные. Содержание миграций и причины — `2026-10-10-pg17-ci-fixes.md`, `2026-10-10-acceptance-bonus.md`, ADR-0030.

## Что сделано (подтверждено ответами Production)

- До применения: `impuls_meta.pgmigrations` — 35 записей, последняя `000035_profile_self_name`; `check_fulfillment` — `SECURITY DEFINER = false`; коллация `pg_unicode_fast` отсутствует, `pg_c_utf8` есть (то есть `rename_self` из 000035 на Production не работал); `reviews` — 0 строк.
- Применено тремя отдельными транзакциями через Supabase MCP `apply_migration` (имена `impuls_fulfillment_check_definer`, `impuls_rename_self_collation`, `impuls_acceptance_bonus`); к каждой добавлена запись в `impuls_meta.pgmigrations`. SQL — тело `up` из файлов миграций без изменений.

## Проверено после применения

- `impuls_meta.pgmigrations`: 38 записей; 000036, 000037, 000038 присутствуют.
- `check_fulfillment`: владелец `postgres`, `SECURITY DEFINER = true`, `search_path=pg_catalog`; ACL только у владельца.
- `rename_self`: определение содержит `pg_c_utf8` и не содержит `pg_unicode_fast`; вызов с несуществующим пользователем вернул `inactive` без записи.
- `reviews`: 6 новых колонок, ограничение `reviews_award_breakdown_check` валидно; триггеры `reviews_default_award` и `ledger_acceptance_amount` включены; ACL новых функций — только владелец.

## Не проверено / открыто

- Сравнение хешей определений функций с локальной БД не выполнялось (локальный контейнер на момент применения не запущен); проверена структура, а не побайтовое совпадение.
- Функциональный прогон на Production (реальная приёмка с бонусом, переименование активного пользователя) не выполнялся: приложение на Vercel собрано на коде до коммитов `0dcdf3d`/`0cbde59` и не отправляет бонус; `rename_self` активного пользователя не вызывался (проверен только ранний возврат).
- Версии правил с `acceptance.adjustment/bonuses` на Production нет — возможность бонуса неактивна (нужен интерфейс/решение P-04).
- Код не отправлен в `origin`, деплой не выполнялся. Совместимость старого приложения с 000038 обеспечена триггером `reviews_default_award` (проверено локально на 17.6, на Production не прогонялось).
- Security advisors после миграций не запускались. P-01…P-06, Android/iOS, удалённый CI — открыты.
- Откат схемы не предусмотрен (`down` запрещён); исправление — только новой миграцией.

## Состояние после выкладки кода (10.10.2026, повторная сверка)

- Git: `main` = `origin/main` = `89c67a1`; рабочее дерево чистое (вне репозитория только `tmp/`).
- GitHub Actions `check`, прогон `38046199582` на `89c67a1`: успешно, включая `test:restore` и `test:worker-ops` на PostgreSQL 17.6; предыдущие 22 из 37 прогонов были красными. Причины — в `2026-10-10-pg17-ci-fixes.md`; последняя (предупреждение Node в строгом сравнении stderr) исправлена в `89c67a1`.
- Vercel: Production `impuls-pul5v2v6c` — Ready (23 с), алиас `https://impuls-eta.vercel.app` указывает на него; `vercel logs --level error --since 1h` — записей нет; в Production заданы 16 флагов приложения, `APP_ORIGIN`, `CSRF_SECRET`, `DATABASE_URL`, `SUPABASE_CA_CERT_B64`, `TELEGRAM_BOT_TOKEN` (по именам из `vercel env ls`).
- Supabase `enicnfevahcuiqvwmhgp`: `pgmigrations` — 38 записей, как файлов в `db/migrations`; список миграций Supabase заканчивается `impuls_acceptance_bonus`. Advisors: прежние замечания (`impuls_meta.pgmigrations` и `impuls.profile_name_changes` с RLS без политик — INFO, намеренно; `public.rls_auto_enable()` доступна `anon`/`authenticated` — WARN, не изменялась).
- Не проверено: работа формы приёмки с бонусом на Production (нет версии правил с опциями), вход с устройства Telegram, worker (не размещён).
