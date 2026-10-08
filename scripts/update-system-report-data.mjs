import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "outputs/system-progress-site/src/data.json");
const current = JSON.parse(fs.readFileSync(file, "utf8"));
const data = JSON.parse(
  fs.readFileSync(
    path.join(root, "outputs/system-progress-reviewed.json"),
    "utf8",
  ),
);
data.id = current.id;
data.buildStatus = process.argv.includes("--complete")
  ? "complete"
  : "updating";
data.report = { asOf: "2026-10-05" };
const source = data.queries.criteria.source;
for (const query of [data.queries.criteria, data.queries.features]) {
  query.source.metricDefinitions.push({
    label: "Количество критериев и остаток",
    definition:
      "Есть / часть / нет — количество строк со score 1 / 0,5 / 0. Доработать = часть + нет. Остаток баллов = число критериев − сумма score. Сравнение этапов всегда использует все 72 строки; остальные новые блоки — выбранный этап.",
    formula:
      "unfinished = COUNT(score < 1); remainingPoints = COUNT(*) - SUM(score)",
    componentIds: ["criterion-numbers", "feature-statuses", "phase-comparison"],
  });
}
data.queries.gallery = {
  rows: [
    {
      feature: "F03",
      screen: "Задача → отчёт",
      file: "docs/verification/assets/f06-fulfillment/f03-report-320.png",
      mode: "synthetic",
      date: "2026-10-03",
    },
    {
      feature: "F05",
      screen: "Профиль",
      file: "docs/verification/assets/f05-profile/profile/profile-320.png",
      mode: "synthetic",
      date: "2026-10-02",
    },
    {
      feature: "F06",
      screen: "Выдача",
      file: "docs/verification/assets/f06-fulfillment/reward-fulfillment/form-320.png",
      mode: "synthetic",
      date: "2026-10-03",
    },
    {
      feature: "F07",
      screen: "История каталога",
      file: "docs/verification/assets/f07-catalog-history/admin-catalog/history-390.png",
      mode: "synthetic",
      date: "2026-10-04",
    },
  ],
  source: { ...source, label: "Сохранённые captures локального интерфейса" },
  methods: [
    {
      language: "text",
      code: "Использованы исходные PNG из docs/verification/assets; рисунки не генерировались и значения интерфейса не менялись. Превью обрезано по высоте; диалог показывает весь снимок.",
    },
  ],
};
data.queries.checks = {
  rows: [
    {
      command: "bun run test:unit (TEST_DATABASE_URL пустой)",
      result: "98 passed, 296 skipped; 24 suites passed, 39 skipped",
      environment: "Windows, Node 24.21.0",
      source: "test-results/system-report-unit.log",
      date: "2026-10-05",
    },
    {
      command:
        "node scripts/verify-task-slice.mjs (TEST_SKIP_SCREENSHOTS=true)",
      result:
        "295 passed, 1 skipped; 39 suites passed; browser scenarios passed",
      environment:
        "Windows, PostgreSQL 18.6, Next production server localhost:3100",
      source: "test-results/system-report-regression.log",
      date: "2026-10-05",
    },
    {
      command: "bun run test:integration без TEST_APP_ORIGIN",
      result: "241 passed, 36 skipped, 1 failed: Run bun run test:task-slice",
      environment: "Первичный неполный запуск; заменён штатным runner",
      source: "Вывод команды в текущей сессии",
      date: "2026-10-05",
    },
    {
      command: "Runner в песочнице / до запуска PostgreSQL",
      result:
        "SWC access denied / ECONNREFUSED; повтор после запуска базы прошёл",
      environment: "Сбой среды, отдельно от результата штатного прогона",
      source: "Вывод команд в текущей сессии",
      date: "2026-10-05",
    },
  ],
  source: { ...source, label: "Результаты фактически выполненных проверок" },
  methods: [
    {
      language: "text",
      code: "Читать итоговые строки логов. Прогоны используют пересекающиеся тесты; результаты не складывать. Skipped не считать пройденными. TEST_DATABASE_URL указывает только на изолированную loopback-базу; секреты не включены.",
    },
  ],
};
data.verificationText =
  "## Что проверено\n\n**5 октября, текущая работа:** `bun run test:unit` — 98 прошли, 296 пропущены (интеграционные проверки без БД). Штатный `node scripts/verify-task-slice.mjs` с отдельной PostgreSQL 18.6 и локальным production server — 295 интеграционных тестов прошли, один пропущен; браузерные сценарии прошли. Два счётчика не складываются: наборы могут пересекаться.\n\nПервый прямой запуск integration дал 241 успешный тест и один сбой из-за отсутствия TEST_APP_ORIGIN. При повторе были также ошибки Windows SWC и недоступная тестовая БД. После запуска существующей изолированной базы и штатного runner получен успешный результат выше.\n\n**Предыдущие зафиксированные проверки 4 октября:** typecheck, lint и production build прошли для среза истории каталога; ссылки и точные команды — в docs/verification/2026-10-04-f07-catalog-history.md. Это не новый запуск этих команд в текущей работе.\n\n**Не проверено здесь:** удалённое развёртывание, PostgreSQL 17.6 CI, фактическая доставка Bot API, ручной Android/iOS, нагрузка и восстановление резервной копии. Сборка и браузер не заменяют проверку Telegram на устройстве.";
for (const row of data.queries.gallery.rows)
  if (!fs.existsSync(path.join(root, row.file)))
    throw new Error(`Missing screenshot ${row.file}`);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`Updated ${data.id}; status=${data.buildStatus}`);
