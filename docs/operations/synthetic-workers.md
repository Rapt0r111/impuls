# Синтетические worker: запуск, наблюдение и остановка

Локальный контракт [ADR-0020](../adr/0020-synthetic-worker-observability.md), F06/F08, 05.10.2026. Этот runbook не утверждает hosting или P-01…P-06. Systemd templates в `ops/systemd/` не установлены; `/opt/impuls`, `/usr/bin/node`, OS users и `/etc/impuls/*.env` — предлагаемые пути, которые оператор должен проверить на разрешённом Linux стенде. Windows прогоны не доказывают systemd/POSIX поведение.

## Предварительные условия

1. Только изолированные synthetic данные. Применены 000001–000028; app и worker соответствуют ADR-0019. Миграция 000028 не создаёт deadline или LOGIN.
2. Собран `bun run build:worker` на закреплённых Bun/Node из package.json. Для supervisor запускать непосредственно Node `apps/worker/dist/index.mjs`, чтобы сигнал достигал основного процесса.
3. Два отдельных процесса и два отдельных environment files: notification process использует current_user `impuls_worker`; expiry process — `impuls_expiry_worker`. NOLOGIN service roles требуют разрешённого provisioning authenticator/member и фактической проверки current_user. Не использовать owner/app credential. Секреты не входят в unit или CLI-аргументы, env files вне репозитория с доступом только оператору/нужному process identity. Приложение не получает worker URL.
4. Для remote БД проверенный CA в SUPABASE_CA_CERT_B64, отсутствие ssl URL parameters; worker отклоняет неоднозначный TLS URL. Локальный loopback допускается только для synthetic rehearsal. Не печатать environment в shell/systemd diagnostics или отчёт.
5. Notification env: SYNTHETIC_NOTIFICATIONS_ENABLED=true, RESERVATION_EXPIRY_ENABLED=false. Expiry env: наоборот. WORKER_DATABASE_URL задаётся отдельно; WORKER_POLL_INTERVAL_MS=5000 — технический default, диапазон 1000–60000. Не задавать Bot token: transport — симуляция.

## Реальная доставка Telegram (ADR-0025)

Включается только в процессе уведомлений и только вручную: помимо `SYNTHETIC_NOTIFICATIONS_ENABLED=true` задать `TELEGRAM_DELIVERY_ENABLED=true` и `TELEGRAM_BOT_TOKEN` в отдельном environment file worker (права 0600, не в репозитории, не в окружении приложения). Должна быть применена миграция 000032. Токен не печатается; журнал содержит только `mode: "telegram"`, счётчики и `WORKER_UNAVAILABLE`.

| Результат в журнале                                | Значение                  | Действие оператора                                                                                          |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `delivered`                                        | Bot API принял сообщение  | Не считать подтверждением прочтения; возможен дубль при потере записи результата                            |
| `suppressed` (причина `recipient_unreachable`)     | 403 или «chat not found»  | Получатель не запускал бота или заблокировал его; повторов нет                                              |
| `retry` (причина `rate_limited`)                   | 429                       | Ждать `retry_after`, не повышать частоту опроса                                                             |
| `WORKER_UNAVAILABLE` + exit 1 после ответа 401/404 | Токен или метод отклонены | Проверить токен у владельца бота, не перезапускать в цикле; событие останется в `processing` до конца lease |

Откат: снять `TELEGRAM_DELIVERY_ENABLED`, перезапустить процесс; очередь продолжит симуляцию. Реальный токен и устройства в этом репозитории не проверялись.

## Напоминания о сроке задач (ADR-0027)

Включаются отдельным флагом `TASK_REMINDERS_ENABLED=true` в окружении процесса уведомлений (поверх `SYNTHETIC_NOTIFICATIONS_ENABLED=true`); нужна миграция 000034. Worker ставит событие `task.due_soon` для назначенных задач, срок которых наступает в течение 24 часов (не более 50 за шаг, по одному на задачу); отдельного процесса и расписания нет. Окно — технический параметр, не согласованное правило. Откат: снять флаг; поставленные события доставляются или подавляются обычным путём.

## Supabase Edge Functions (ADR-0032, бесплатно)

Две функции, `impuls-notifications` и `impuls-expiry`, раз в минуту вызываются pg_cron через pg_net и делают один проход, равный `--once`/`--expire-once`. Код: `apps/worker/src/edge.ts`, входы в `supabase/functions/*/index.ts`, бандл `bun run build:edge` (файлы `worker-edge.mjs` не хранятся в git).

Порядок включения:

1. **Владелец**, SQL Editor Supabase. Три длинных случайных значения из букв и цифр (чтобы не кодировать их в URL); не сохранять в репозитории и чате:
   ```sql
   ALTER ROLE impuls_worker WITH LOGIN PASSWORD '<пароль 1>';
   ALTER ROLE impuls_expiry_worker WITH LOGIN PASSWORD '<пароль 2>';
   SELECT vault.create_secret('<токен вызова, не короче 32 символов>', 'impuls_worker_trigger');
   ```
2. **Владелец**, Edge Functions → Secrets:
   - `NOTIFICATION_WORKER_DATABASE_URL=postgresql://impuls_worker.<project-ref>:<пароль 1>@<host>:5432/postgres`;
   - `EXPIRY_WORKER_DATABASE_URL=postgresql://impuls_expiry_worker.<project-ref>:<пароль 2>@<host>:5432/postgres`;
   - `<host>` — из Supabase → Connect → Session pooler, без `?sslmode`;
   - `SUPABASE_CA_CERT_B64` — то же значение, что у приложения в Vercel;
   - `WORKER_TRIGGER_SECRET` — токен из шага 1;
   - `SYNTHETIC_NOTIFICATIONS_ENABLED=true`, `RESERVATION_EXPIRY_ENABLED=true`.
3. Опубликовать обе функции с `verify_jwt=false` (вызов проверяется токеном): собрать `bun run build:edge` и загрузить `index.ts` и `worker-edge.mjs` каждой функции через Supabase CLI (`--no-verify-jwt`) или Supabase MCP.
4. Выполнить `ops/supabase/worker-schedule.sql`, подставив `<project-ref>`.
5. Через минуту проверить журнал функций (Edge Functions → Logs): `{"mode":"simulation","results":{...}}` и `{"mode":"reservation_expiry","results":{...}}`. Ответы pg_net — в `net._http_response`. 401 — токен в Vault и в секрете различается; 503 `WORKER_UNAVAILABLE` — пароль, логин pooler, CA или роль.

Реальная доставка: добавить секреты `TELEGRAM_BOT_TOKEN` и `TELEGRAM_DELIVERY_ENABLED=true`, затем `TASK_REMINDERS_ENABLED=true` (смысл — разделы выше). Новые значения секретов функция видит со следующего вызова. Если Bot API отвечает 401/404, каждый вызов вернёт 503 и сожжёт попытку одного события: сразу снять `TELEGRAM_DELIVERY_ENABLED`.

Остановка: `select cron.unschedule('impuls-notifications'); select cron.unschedule('impuls-expiry');` или флаг `false` (ответ `disabled`). Полный откат — дополнительно `ALTER ROLE … NOLOGIN`.

Запасной путь без Supabase Edge Functions: образ `apps/worker/Dockerfile` (`docker build -f apps/worker/Dockerfile -t impuls-worker .`, режим передаётся аргументом `--watch` или `--expire-watch`) либо systemd ниже.

## Предлагаемый supervisor

Шаблоны предусматривают `Type=exec`, restart только при failure с паузой 5 s и лимитом 5 starts за 300 s; это технические настройки rehearsal, не SLA. После исчерпания starts оператор устраняет причину и отдельно разрешает restart. При false flag процесс пишет disabled/exit 0 и автоматически не перезапускается. `systemctl stop` не должен превращаться в повторное включение.

Остановка: SIGTERM главному Node process, drain текущей операции без новых claims, pool.end. Internal deadline 20 s → фиксированный WORKER_STOP_TIMEOUT/exit 1. Внешний TimeoutStopSec=25 и KillMode=mixed допускают graceful stop главного процесса, затем hard kill группы при превышении. Завершённые операции сохраняются; crash незавершённого expiry откатывает транзакцию, notification lease восстанавливается следующим запуском.

Эти параметры сверены с первичными [systemd.service](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml), [systemd.kill](https://github.com/systemd/systemd/blob/main/man/systemd.kill.xml) и [systemd.unit](https://github.com/systemd/systemd/blob/main/man/systemd.unit.xml). Исходники документации прочитаны 05.10.2026; latest не устанавливает версию целевого host. До установки оператор проверяет пути, OS users, совместимость directives установленной версии, `systemd-analyze verify` адаптированных units и фактический stop/restart на стенде. В этой задаче units не устанавливаются.

## Наблюдение

| Свидетельство                                                    | Значение                                               | Действие оператора                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `watching`                                                       | Роль проверена, цикл начинается                        | Дождаться успешного шага, не считать startup heartbeat                                       |
| `alive` + observedAt                                             | Шаг БД успешно завершён, в том числе null/empty        | Проверять свежесть по времени приёма логов; observedAt — часы процесса                       |
| results.expired / simulated / retry / failed / suppressed / lost | Число завершённых операций в пачке                     | Retry/lost не означают новое начисление или Telegram delivery                                |
| WORKER_UNAVAILABLE + exit 1                                      | Неверная конфигурация, БД/TLS/роль или ошибка операции | Не раскрывать raw exception; проверить host/БД/роль/миграции/доступность, ограничить restart |
| WORKER_STOP_TIMEOUT + exit 1                                     | Drain/cleanup не завершились за 20 s                   | Подтвердить exit и отсутствие старого процесса, затем проверить locks/lease и состояние БД   |
| stopped + exit 0                                                 | Graceful watch завершился                              | При плановой остановке сохранить flag выключенным                                            |

Alive печатается после первого успешного шага и далее не чаще раза в 60 s по monotonic clock, включая шаги внутри длинной пачки. Poll/operation задержка добавляется к интервалу. Alive не обещает успешную обработку каждого due item: занятая quota может быть пропущена. Это stdout record, не sd_notify watchdog, не хранимый DB heartbeat и не уже подключённый alert.

Expiry snapshot в окружении **expiry caller**:

```text
node apps/worker/dist/index.mjs --expire-status
```

или локальный alias `bun run worker:expire:status`. Exit 0 с status=observed означает успешное чтение; disabled/exit 0 — flag false. Ни один из них сам не проверяет watch. Никакого автоматического изменения заявки при status:

- counts.due — synthetic pending с expires_at <= server statement timestamp, включая locked work;
- scheduled — будущий сохранённый срок; untimedPending — NULL, не due;
- automaticExpired — накопленное число automatic expired, без ручных истечений;
- oldestDueAt/oldestDueAgeSeconds — самый ранний due deadline и целые секунды просрочки, null при due=0;
- lastAutomaticExpiryAt — сохранённый decided_at последнего automatic expiry, null если таких нет;
- snapshotAt — время statement БД. JSON не содержит IDs, суммы, область, людей или текст.

Оператор сопоставляет **свежий snapshot**, freshness alive, exit/restart и прирост completion. Due>0 при свежем alive может означать contention; due=0 при пропавшем alive не доказывает работоспособность. lastAutomaticExpiryAt может быть старым при пустой очереди. Счётчики агрегируют всю synthetic историю; query timeout 10 s ограничивает ожидание, но нагрузка/стоимость на target не измерены.

Для synthetic rehearsal предложены проверки freshness >120 s, oldestDueAgeSeconds >120 s и любой exit 1/исчерпание restart limit. Это сигнал для расследования, не бизнес-срок или утверждённый alert. Частота чтения, реальные пороги, сборщик/канал, ответственный и retention требуют оператора/P-02/P-06; они не устанавливаются автоматически. Notification `--status` остаётся сводкой simulation receipts, а exact-scope UI показывает её/журнал; реальные Bot API failures ещё не проверяются.

## Stop, rollback и восстановление

При ошибке сначала остановить соответствующий unit/process и выключить его независимый flag. Проверить, что процесс действительно завершился и restart не продолжается. Не удалять redemptions/receipts/ledger/audit для повторного прогона и не запускать ручную правку проекций. Сопоставить сохранённый статус, исходный резерв и журнал через разрешённый read/restore tool; при inconsistent state требуется отдельный разбор.

Возобновление — после устранения причины, проверки роли/TLS/схемы и разрешённого restart. Due сохранённые заявки подхватятся; NULL deadlines не реконструируются. После expiry crash повтор не возвращает ресурсы дважды. После simulation crash lease может удерживаться до 30 s, receipt retries не означают внешнюю доставку. Восстановление БД сохраняет owners и ACL definer; same-cluster rehearsal описан отдельно. Отказ новой сводки на старой схеме не повод выдать прямой SELECT worker.

## Проверка перед target выпуском

Локальная автоматизация: `bun run test:worker-ops` с явным TEST_DATABASE_URL isolated cluster; `bun run test:restore` с PG_BIN. Linux CI содержит POSIX idle SIGTERM, in-flight drain и настоящий 20 s deadline в Node harness со stalled cleanup. Последний использует production shutdown helper, не имитирует сетевой сбой PostgreSQL. Результат удалённого CI/target host записывается отдельно; добавленный workflow не доказывает его выполнение. [Локальные результаты](../verification/2026-10-05-worker-observability.md).
