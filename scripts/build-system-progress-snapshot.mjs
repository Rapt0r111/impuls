import fs from "node:fs";
import path from "node:path";

// An explicit analytical rubric, not an estimate of hours or production readiness.
const root = path.resolve(import.meta.dirname, "..");
const ref = (file, needle) => {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const line = text.split(/\r?\n/).findIndex((x) => x.includes(needle)) + 1;
  if (!line) throw new Error(`Missing evidence: ${file} / ${needle}`);
  return `${file}:${line}`;
};
const domain = (file, needle) => ref(`packages/domain/src/${file}.ts`, needle);
const plan = (needle) => ref("IMPLEMENTATION_PLAN.md", needle);
const permission = domain(
  "permissions/service",
  "export async function hasPermission",
);
const auth = domain("auth/service", "export async function createLoginSession");
const telegram = domain(
  "auth/telegram",
  "export function verifyTelegramInitData",
);
const manage = domain("tasks/manage", "export function createTask");
const review = domain(
  "tasks/reviews",
  "export async function reviewTaskSubmission",
);
const credit = domain(
  "ledger/credit",
  "export async function creditAcceptedTask",
);
const catalog = domain(
  "admin/catalog",
  "export async function readAdminCatalog",
);
const worker = ref("apps/worker/src/index.ts", "Never loads app .env");
const features = [
  [
    "F01",
    "R1",
    "Telegram-вход",
    [
      [
        "Подпись initData",
        1,
        "Сервер проверяет HMAC и формат, отрицательные сценарии.",
        telegram,
      ],
      [
        "Срок действия initData",
        1,
        "Возраст подписи и допустимое отклонение времени.",
        telegram,
      ],
      [
        "Допуск через allowlist",
        1,
        "Активный пользователь проверяется на сервере.",
        auth,
      ],
      [
        "Серверная сессия",
        1,
        "Хеш сессии, срок действия и проверка пользователя.",
        domain("auth/service", "export async function readSession"),
      ],
      [
        "Выход и отзыв",
        1,
        "Отзыв сессии на сервере; отказ после деактивации.",
        domain("auth/service", "export async function revokeSession"),
      ],
      [
        "Состояния входа и защита частоты",
        1,
        "Рабочий экран входа, отказ и повтор; лимиты API.",
        ref(
          "apps/app/src/app/api/v1/auth/telegram/route.ts",
          "export async function POST",
        ),
      ],
    ],
  ],
  [
    "F02",
    "R1",
    "Права и области",
    [
      [
        "Право по действию",
        1,
        "Отдельные права для предметных операций.",
        permission,
      ],
      [
        "Точное совпадение области",
        1,
        "Нет наследования соседней или родительской области.",
        permission,
      ],
      [
        "Срок и отзыв полномочий",
        1,
        "revoked_at, valid_from и valid_until проверяются.",
        permission,
      ],
      [
        "Проверки объекта и самоодобрения",
        1,
        "Владение и запрет приёмки своего результата.",
        review,
      ],
      [
        "Разрешённые действия и безопасный отказ UI",
        1,
        "Права читаются с сервера, операции повторно авторизуются.",
        domain(
          "permissions/service",
          "export async function listActivePermissions",
        ),
      ],
      [
        "Управление жизненным циклом прав",
        0,
        "Выдача и отзыв полномочий через админ API/UI ещё отсутствуют.",
        plan("| F02 |"),
      ],
    ],
  ],
  [
    "F03",
    "R1",
    "Цикл задачи",
    [
      [
        "Создание и назначение",
        1,
        "Серверная операция с областью и участником.",
        manage,
      ],
      [
        "Редактирование и отмена",
        1,
        "Причина, версия, идемпотентность и ограничения состояния.",
        domain("tasks/manage", "export function editTask"),
      ],
      [
        "Начало и сдача отчёта",
        1,
        "Переходы и неизменяемая сдача.",
        domain("tasks/write", "export async function mutateAssignedTask"),
      ],
      [
        "Возврат и приёмка",
        1,
        "Решение проверяющего и защита двойной приёмки.",
        review,
      ],
      [
        "История и хронология",
        1,
        "Отдельные защищённые чтения.",
        domain("tasks/timeline", "export async function readTaskTimeline"),
      ],
      [
        "Конфликт версии и повтор запроса",
        1,
        "Запрос проходит права; прежний ключ не начисляет повторно.",
        review,
      ],
    ],
  ],
  [
    "F04",
    "R1",
    "XP и баллы",
    [
      [
        "Раздельные XP и расходуемые баллы",
        1,
        "Отдельные записи и проекции баланса.",
        credit,
      ],
      [
        "Атомарное начисление и баланс",
        1,
        "Начисление в транзакции приёмки; блокировка проекции.",
        credit,
      ],
      [
        "Сохранённая версия и базовый фонд",
        1,
        "Правила и фонд сохраняются для задачи и приёмки.",
        review,
      ],
      [
        "Личный журнал операций",
        1,
        "Суммы и основания доступны участнику.",
        domain("ledger/read", "export"),
      ],
      [
        "Компенсирующее исправление",
        1,
        "Исходное начисление не переписывается; отрицательный баланс запрещён.",
        domain("ledger/corrections", "export async function reverseAcceptance"),
      ],
      [
        "Настраиваемые бонусы при приёмке",
        0,
        "Выбор бонуса и его отдельное начисление ещё не реализованы.",
        plan("Бонус выбирается"),
      ],
    ],
  ],
  [
    "F05",
    "R1",
    "Рейтинг и профиль",
    [
      [
        "Рейтинг по времени приёмки и месяцу",
        1,
        "Сезон и часовой пояс фиксируются источником.",
        domain("ranking/read", "export async function readLeaderboard"),
      ],
      [
        "Равные результаты",
        1,
        "Равенство и стабильный порядок проверены.",
        domain("ranking/read", "export async function readLeaderboard"),
      ],
      [
        "Область и собственный результат",
        1,
        "Защищённая область и приватная собственная позиция.",
        domain("ranking/read", "export async function readLeaderboard"),
      ],
      [
        "Уровни по версии правил",
        1,
        "Пороговая шкала берётся из синтетической версии.",
        domain("profile/progression", "export function levelProgress"),
      ],
      [
        "Первый результат один раз",
        1,
        "Уникальное достижение выдаётся в транзакции.",
        credit,
      ],
      [
        "Профиль и последствия исправлений",
        1,
        "Профиль читает согласованный баланс и достижения.",
        domain("profile/read", "export async function readParticipantProfile"),
      ],
    ],
  ],
  [
    "F06",
    "R1",
    "Каталог и заявки",
    [
      [
        "Версии условий и каталог",
        1,
        "Синтетическая косметика, условия, пагинация.",
        domain("rewards/read", "export async function readRewardCatalog"),
      ],
      [
        "Атомарный резерв и квота",
        1,
        "Гонки за последнюю квоту и баланс проверены.",
        domain("rewards/write", "export async function mutateRedemption"),
      ],
      [
        "Собственные заявки и отмена",
        1,
        "История и однократный возврат резерва.",
        domain("rewards/read", "export async function readMyRedemptions"),
      ],
      [
        "Согласование и отказ",
        1,
        "Решение в области, запрет самоодобрения.",
        domain("rewards/decisions", "export async function decideRedemption"),
      ],
      [
        "Факт выдачи и владение",
        1,
        "Выдача и защита повторного владения.",
        domain(
          "rewards/fulfillment",
          "export async function fulfillRedemption",
        ),
      ],
      [
        "Полный цикл завершения резерва",
        0.5,
        "Ручной expire есть; нет автоматического планировщика и утверждённой политики отмены.",
        domain("rewards/decisions", "export async function decideRedemption"),
      ],
    ],
  ],
  [
    "F07",
    "R1",
    "Администрирование",
    [
      [
        "Управление допуском",
        0,
        "Нет админ операций для реестра пользователей.",
        plan("| F07 |"),
      ],
      [
        "Управление правами",
        0,
        "Нет операций выдачи/отзыва binding через API/UI.",
        plan("| F07 |"),
      ],
      [
        "Управление версиями правил",
        0,
        "Нет создания и публикации правил администратором.",
        plan("| F07 |"),
      ],
      [
        "Управление каталогом",
        0.5,
        "Чтение конфигурации и истории есть; запись и публикация отсутствуют.",
        catalog,
      ],
      [
        "Управление квотами",
        0.5,
        "Чтение текущих, прошлых и будущих периодов есть; изменение квот отсутствует.",
        domain(
          "admin/catalog-quotas",
          "export async function readAdminCatalogQuotas",
        ),
      ],
      [
        "Предметный аудит",
        1,
        "Защищённый просмотр, безопасные изменения, actor/scope.",
        domain("admin/audit", "export async function readAudit"),
      ],
    ],
  ],
  [
    "F08",
    "R1",
    "Уведомления",
    [
      [
        "Транзакционный outbox",
        1,
        "Предметный результат и событие фиксируются вместе.",
        ref(
          "packages/domain/src/rewards/write.ts",
          "INSERT INTO impuls.notification_outbox",
        ),
      ],
      [
        "Получение событий и lease",
        0.5,
        "Работает отдельный симуляционный worker, без настоящего транспорта.",
        domain(
          "notifications/simulation",
          "export async function claimNotificationSimulation",
        ),
      ],
      ["Отправка через Bot API", 0, "Адаптера реальной отправки нет.", worker],
      [
        "Повторы, backoff и восстановление",
        0.5,
        "Проверено для локального sink; реальные сетевые ответы Telegram не проверены.",
        domain(
          "notifications/simulation",
          "export async function processNotificationSimulation",
        ),
      ],
      [
        "Статус доставки в UI",
        0.5,
        "Есть сводка, страницы событий и журнал попыток симуляции; факта доставки нет.",
        domain(
          "notifications/attempts",
          "export async function readNotificationAttempts",
        ),
      ],
      [
        "Размещение и supervision worker",
        0,
        "Целевой hosting, перезапуск и его проверка отсутствуют.",
        worker,
      ],
    ],
  ],
  [
    "F09",
    "R2",
    "Пул и инициативы",
    [
      "Свободный пул",
      "Атомарный захват",
      "Лимит взятых задач",
      "Подача инициативы",
      "Решение по инициативе",
      "Очередь и история",
    ].map((x) => [
      x,
      0,
      "Серверного вертикального среза R2 нет; R0 не учитывается.",
      plan("| F09 |"),
    ]),
  ],
  [
    "F10",
    "R2",
    "Вехи и доли",
    [
      "Жизненный цикл вех",
      "Фонды вех",
      "Выплата остатка",
      "Совместные доли",
      "Округление распределения",
      "UI уже выплаченного",
    ].map((x) => [
      x,
      0,
      "Серверного вертикального среза R2 нет; R0 не учитывается.",
      plan("| F10 |"),
    ]),
  ],
  [
    "F11",
    "R2",
    "Компетенции",
    [
      "Категории XP",
      "Матрица компетенций",
      "Форма благодарности",
      "Подтверждение благодарности",
      "Ограничения признания",
      "Достижение Наставник",
    ].map((x) => [
      x,
      0,
      "Серверного вертикального среза R2 нет; R0 не учитывается.",
      plan("| F11 |"),
    ]),
  ],
  [
    "F12",
    "R2",
    "Итоги сезона",
    [
      "Общая цель",
      "Уникальные командные события",
      "Закрытие сезона",
      "Архив снимка",
      "Поздние errata",
      "Зал Славы",
    ].map((x) => [
      x,
      0,
      "Серверного вертикального среза R2 нет; R0 не учитывается.",
      plan("| F12 |"),
    ]),
  ],
];
const criteria = features.flatMap(([feature, phase, name, items]) =>
  items.map(([criterion, score, note, evidence], i) => ({
    id: `${feature}-${i + 1}`,
    feature,
    phase,
    name,
    criterion,
    score,
    status:
      score === 1 ? "Реализован" : score === 0.5 ? "Частично" : "Отсутствует",
    note,
    evidence,
  })),
);
const summary = features.map(([feature, phase, name]) => {
  const c = criteria.filter((r) => r.feature === feature);
  return {
    feature,
    phase,
    name,
    label: `${feature} · ${name}`,
    points: c.reduce((s, r) => s + r.score, 0),
    total: c.length,
    coverage: (100 * c.reduce((s, r) => s + r.score, 0)) / c.length,
    done: c.filter((x) => x.score === 1).length,
    partial: c.filter((x) => x.score === 0.5).length,
    missing: c.filter((x) => x.score === 0).length,
  };
});
const gates = [
  [
    "P-01",
    "Владелец",
    "Допуск и полномочия",
    "Не утверждено",
    "Участники, области, сроки, вступление и выбытие.",
  ],
  [
    "P-02",
    "Владелец",
    "Данные и разрешённый контур",
    "Не утверждено",
    "Поля, хранение и допустимость платформ.",
  ],
  [
    "P-03",
    "Владелец",
    "Поощрения и отмена",
    "Не утверждено",
    "Допустимые позиции, условия, квоты и факт выдачи.",
  ],
  [
    "P-04",
    "Владелец",
    "Экономика и бонусы",
    "Не утверждено",
    "Версия фондов, ограничений и исправлений.",
  ],
  [
    "P-05",
    "Владелец",
    "Видимость и рейтинг",
    "Не утверждено",
    "Псевдонимы, области и публичность результатов.",
  ],
  [
    "P-06",
    "Владелец",
    "Ответственность за пилот",
    "Не утверждено",
    "Команда, бюджет, восстановление и остановка.",
  ],
  [
    "G-01",
    "Разработка",
    "Полный F01–F08",
    "Не закрыто",
    "Дописать администрирование, бонусы, автоматическое истечение и настоящую доставку.",
  ],
  [
    "G-02",
    "Эксплуатация",
    "Режим реальных данных",
    "Не проверено",
    "Адаптировать синтетические ограничения схемы и домена к утверждённым правилам.",
  ],
  [
    "G-03",
    "Проверки",
    "Telegram Android / iOS",
    "Не проверено",
    "Физические WebView, клавиатура, safe areas, отзыв доступа.",
  ],
  [
    "G-04",
    "Проверки",
    "Безопасность и восстановление",
    "Не проверено",
    "Security scan, зависимости, проверенный TLS/CA, restore и нагрузка.",
  ],
  [
    "G-05",
    "Выпуск",
    "Целевая CI и раскатка",
    "Не проверено",
    "PostgreSQL 17.6 CI, удалённые миграции, согласованный выпуск app/API/worker.",
  ],
];
const metadata = {
  label: "Аудит локального репозитория «Импульс», 5 октября 2026",
  tables: [
    "IMPLEMENTATION_PLAN.md §11–12",
    "packages/domain/src",
    "apps/app/src",
    "apps/worker/src",
    "docs/verification",
  ],
  filters: [
    "Локальный исходный код; синтетические операции; R0 не включён",
    "Удалённый production и физические устройства в этой оценке не проверялись",
  ],
  evidenceFlow: [
    {
      title: "Первичный источник",
      detail:
        "Прочитаны IMPLEMENTATION_PLAN.md §§2, 5, 10–12, PRODUCT.md, DESIGN.md и серверные модули по пути/строке в каждой строке чек-листа.",
    },
    {
      title: "Проверка структуры",
      detail:
        "rg --files и rg -n по packages/domain/src, apps/app/src/app/api/v1, apps/worker/src, db/migrations и docs/verification.",
    },
    {
      title: "Ограничение оценки",
      detail:
        "Рубрика создана для данного отчёта: 6 критериев на функцию, равный вес F01–F12. Это оценка покрытия выбранных возможностей, а не доля трудозатрат или приёмка §12. Общие зависимости могут учитываться в нескольких функциях.",
    },
  ],
  metricDefinitions: [
    {
      label: "Покрытие чек-листа",
      definition:
        "Сумма баллов / число критериев × 100. Реализован = 1, частично = 0,5, отсутствует = 0. 48 критериев R1 и 24 R2. Все функции имеют одинаковый вес.",
      formula: "100 * SUM(score) / COUNT(criteria)",
      componentIds: ["overview", "feature-coverage", "criteria", "composition"],
    },
    {
      label: "Строгая оценка",
      definition:
        "Число полностью реализованных критериев / все критерии × 100; частичные не учитываются.",
      componentIds: ["overview", "methods"],
    },
  ],
};
// Repository files are evidence, not warehouse tables.
metadata.files = metadata.tables;
delete metadata.tables;
const query = (rows, label) => ({
  rows,
  source: { ...metadata, label },
  methods: [
    {
      language: "text",
      code: "Прочитать файлы из evidence. Сопоставить операцию/API/UI и зафиксированные отрицательные проверки. Присвоить статус по явной рубрике. Для каждой F суммировать шесть баллов; для фазы суммировать только её строки. Не суммировать результаты пересекающихся тестовых прогонов.",
    },
  ],
});
const snapshot = {
  id: "impuls-system-progress-20261005",
  surface: "report",
  title: "Импульс · от реализации к пилоту",
  generatedAt: new Date().toISOString(),
  status: "reviewed-assessment",
  buildStatus: "creating",
  filters: [],
  queries: {
    criteria: query(criteria, "72 критерия реализации"),
    features: query(summary, "Покрытие функций F01–F12"),
    gates: query(
      gates.map(([id, group, title, status, next]) => ({
        id,
        group,
        title,
        status,
        next,
        evidence: plan(
          id.startsWith("P") ? `| ${id} |` : "До допуска реальных участников",
        ),
      })),
      "Условия допуска к пилоту",
    ),
    architecture: query(
      [
        {
          node: "Telegram WebView",
          state: "Локальный UI; физические устройства не проверены",
        },
        { node: "Next.js /api/v1", state: "Защищённые Node Route Handlers" },
        {
          node: "Доменные сервисы",
          state: "Права, транзакции, XP, резервы, аудит",
        },
        {
          node: "PostgreSQL",
          state: "Локальные миграции 000001–000023; синтетический режим",
        },
        {
          node: "Worker",
          state: "Симуляция, lease, retry, журнал попыток; без Bot API",
        },
      ],
      "Схема реализованной архитектуры",
    ),
  },
};
const out = path.join(root, "outputs", "system-progress-reviewed.json");
fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
for (const phase of ["R1", "R2", "all"]) {
  const rows = criteria.filter((x) => phase === "all" || x.phase === phase);
  console.log(
    phase,
    JSON.stringify({
      points: rows.reduce((s, x) => s + x.score, 0),
      criteria: rows.length,
      done: rows.filter((x) => x.score === 1).length,
      partial: rows.filter((x) => x.score === 0.5).length,
      missing: rows.filter((x) => !x.score).length,
      percent: (100 * rows.reduce((s, x) => s + x.score, 0)) / rows.length,
    }),
  );
}
console.log(out);
