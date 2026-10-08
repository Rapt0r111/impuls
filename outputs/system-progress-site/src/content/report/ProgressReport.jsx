import React, { useState, useRef, useMemo } from "react";
import {
  EvidenceChart,
  DataComponent,
  ReportSection,
  RichNarrative,
  useDataApp,
} from "../../data-app-public.jsx";
import profile from "../assets/profile.png";
import report from "../assets/task-report.png";
import reward from "../assets/reward.png";
import history from "../assets/catalog-history.png";
import "./progress.css";
import { ProgressNumbers, statusColors } from "./ProgressNumbers.jsx";

const percent = (n) => `${Math.round(n)}%`;

const labels = {
  R1: "Первый этап · R1",
  R2: "Расширение · R2",
  all: "Весь объём · R1 + R2",
};

const shots = [
  {
    src: report,
    title: "Задача → отчёт",
    text: "Сдача результата, версия и безопасный повтор.",
    feature: "F03",
    res: "320 px",
  },
  {
    src: profile,
    title: "Профиль участника",
    text: "XP, уровень, баллы и «Первый результат».",
    feature: "F05",
    res: "320 px",
  },
  {
    src: reward,
    title: "Подтверждение выдачи",
    text: "Отдельное полномочие и факт предоставления.",
    feature: "F06",
    res: "320 px",
  },
  {
    src: history,
    title: "История каталога",
    text: "Неизменяемые версии под каждой позицией.",
    feature: "F07",
    res: "390 px",
  },
];

export function ReportContent() {
  const {
    snapshot,
    reviewedRows,
    appTitle,
    canEdit,
    mode,
    setAppTitle,
    visible,
  } = useDataApp();

  const [phase, setPhase] = useState("R1");
  const [opened, setOpened] = useState(0);
  const [rubricFilter, setRubricFilter] = useState("all");
  const [rubricSearch, setRubricSearch] = useState("");
  const [activeSegmentTooltip, setActiveSegmentTooltip] = useState(null);
  const [expandedFeatures, setExpandedFeatures] = useState({});
  const dialog = useRef(null);

  const allCriteria = reviewedRows("criteria");
  const rows = useMemo(
    () => allCriteria.filter((r) => phase === "all" || r.phase === phase),
    [allCriteria, phase],
  );
  const features = useMemo(
    () => reviewedRows("features").filter((r) => phase === "all" || r.phase === phase),
    [reviewedRows, phase],
  );
  const gates = reviewedRows("gates");

  const points = rows.reduce((s, r) => s + r.score, 0);
  const done = rows.filter((r) => r.score === 1).length;
  const partial = rows.filter((r) => r.score === 0.5).length;
  const missing = rows.length - done - partial;
  const coverage = (100 * points) / rows.length;
  const strictCoverage = (100 * done) / rows.length;
  const remainingPoints = rows.length - points;

  const featureRows = features.map((r) => ({
    ...r,
    "Покрытие (%)": r.coverage,
  }));

  const composition = [
    {
      label: labels[phase],
      Реализовано: done,
      Частично: partial,
      Отсутствует: missing,
    },
  ];

  const controls = (
    <div className="progress-scope" role="group" aria-label="Объём оценки">
      {Object.entries(labels).map(([id, label]) => {
        const count = id === "all" ? 72 : id === "R1" ? 48 : 24;
        const isActive = phase === id;
        return (
          <button
            key={id}
            type="button"
            className={`scope-tab ${isActive ? "active" : ""}`}
            aria-pressed={isActive}
            onClick={() => setPhase(id)}
          >
            <span className="scope-tab-title">{label}</span>
            <span className="scope-tab-count">{count}</span>
          </button>
        );
      })}
    </div>
  );

  const toggleFeatureExpand = (featureCode) => {
    setExpandedFeatures((prev) => ({
      ...prev,
      [featureCode]: !prev[featureCode],
    }));
  };

  const filteredCriteriaForRubric = useMemo(() => {
    let list = rows;
    if (rubricFilter === "done") list = list.filter((r) => r.score === 1);
    else if (rubricFilter === "partial") list = list.filter((r) => r.score === 0.5);
    else if (rubricFilter === "missing") list = list.filter((r) => r.score === 0);

    if (rubricSearch.trim()) {
      const q = rubricSearch.toLowerCase();
      list = list.filter(
        (r) =>
          r.criterion.toLowerCase().includes(q) ||
          r.note.toLowerCase().includes(q) ||
          r.feature.toLowerCase().includes(q) ||
          r.evidence.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, rubricFilter, rubricSearch]);

  const ownerGates = useMemo(
    () => gates.filter((g) => g.id.startsWith("P-")),
    [gates],
  );
  const engineeringGates = useMemo(
    () => gates.filter((g) => !g.id.startsWith("P-")),
    [gates],
  );

  return (
    <article
      className="report-content impuls-report"
      aria-label="Отчёт о реализации Импульса"
    >
      <header className="progress-hero">
        <div className="hero-atmosphere" aria-hidden="true">
          <div className="ambient-radial-glow glow-mint" />
          <div className="ambient-radial-glow glow-gold" />
          <div className="ambient-grid-overlay" />
        </div>

        <div className="hero-top-row">
          <div className="hero-telemetry">
            <span className="hud-pulse" aria-hidden="true" />
            <span className="telemetry-badge">ИМПУЛЬС · ТЕХНОЛОГИЧЕСКИЙ ЦЕНТР</span>
            <span className="telemetry-sep">/</span>
            <span className="telemetry-date">05.10.2026</span>
            <span className="telemetry-tag">СИНТЕТИЧЕСКИЙ СРЕЗ</span>
          </div>
          <div className="hero-phase-chip">
            <span className="phase-indicator-dot" />
            <span>{phase === "R1" ? "Фаза R1 · Пилотный контур" : phase === "R2" ? "Фаза R2 · Расширение" : "Полный целевой объём"}</span>
          </div>
        </div>

        <h1
          data-data-app-title
          contentEditable={canEdit && mode === "edit"}
          suppressContentEditableWarning
          onBlur={(e) => {
            if (canEdit && mode === "edit")
              setAppTitle(e.currentTarget.textContent.trim() || appTitle);
          }}
        >
          {appTitle}
        </h1>

        <RichNarrative
          id="progress:lead"
          value="Основной рабочий цикл собран. Следующий рубеж — управление системой, настоящая доставка уведомлений и допуск к пилоту."
          className="progress-deck"
        />

        <div className="hero-pulse-waveform" aria-hidden="true">
          <svg className="waveform-svg" viewBox="0 0 1000 64" preserveAspectRatio="none">
            <defs>
              <linearGradient id="waveformGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#70e1c2" stopOpacity="0.1" />
                <stop offset="25%" stopColor="#70e1c2" stopOpacity="0.4" />
                <stop offset="50%" stopColor="#70e1c2" stopOpacity="0.9" />
                <stop offset="75%" stopColor="#f0ca7a" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#70e1c2" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path
              className="waveform-baseline"
              d="M0,32 L200,32 L240,32 L260,16 L280,48 L300,10 L320,54 L340,32 L460,32 L490,32 L510,18 L530,46 L550,12 L570,52 L590,32 L780,32 L810,32 L830,20 L850,44 L870,32 L1000,32"
            />
            <path
              className="waveform-active-trace"
              d="M0,32 L200,32 L240,32 L260,16 L280,48 L300,10 L320,54 L340,32 L460,32 L490,32 L510,18 L530,46 L550,12 L570,52 L590,32 L780,32 L810,32 L830,20 L850,44 L870,32 L1000,32"
            />
          </svg>
          <div className="waveform-readout">
            <span>ТЕЛЕМЕТРИЯ: 1.0 Гц</span>
            <span>72 КРИТЕРИЯ В РУБРИКЕ</span>
            <span>POSTGRESQL 18.6 ЛОКАЛЬНО</span>
            <span>NEXT.JS 16 API</span>
          </div>
        </div>

        <div className="progress-scope-statement">
          <span className="statement-icon">ℹ</span>
          <span>Оценка локального кода и проверок · Только синтетические операции · Без реального контура</span>
        </div>
      </header>

      {visible("overview") && (
        <DataComponent
          id="overview"
          queryId="criteria"
          kind="custom"
          title="Насколько реализована система"
          sourceRows={rows}
          displayRows={rows}
          headerControls={controls}
        >
          <div
            className="progress-overview-container"
            data-reviewed-rows
            aria-live="polite"
          >
            <div className="overview-hero-card">
              <div className="overview-gauge-section">
                <div className="circular-gauge-wrap">
                  <svg className="circular-gauge-svg" viewBox="0 0 160 160">
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="var(--progress-done)" />
                        <stop offset="100%" stopColor="#70e1c2" />
                      </linearGradient>
                    </defs>
                    <circle
                      className="gauge-track"
                      cx="80"
                      cy="80"
                      r="65"
                    />
                    <circle
                      className="gauge-fill"
                      cx="80"
                      cy="80"
                      r="65"
                      style={{
                        strokeDashoffset: 408.4 - (408.4 * coverage) / 100,
                      }}
                    />
                  </svg>
                  <div className="gauge-center-content">
                    <span className="gauge-big-num">{percent(coverage)}</span>
                    <span className="gauge-sublabel">покрытие чек-листа</span>
                    <span className="gauge-phase-tag">{labels[phase].split(" · ")[0]}</span>
                  </div>
                </div>
              </div>

              <div className="overview-metrics-grid">
                <div className="overview-stat-tile">
                  <span className="stat-tile-title">Набрано баллов</span>
                  <div className="stat-tile-val-group">
                    <strong className="stat-tile-value">
                      {points.toLocaleString("ru-RU")}
                    </strong>
                    <span className="stat-tile-denom">/ {rows.length}</span>
                  </div>
                  <div className="stat-tile-bar-wrap">
                    <div
                      className="stat-tile-bar-fill"
                      style={{ width: `${(points / rows.length) * 100}%` }}
                    />
                  </div>
                  <span className="stat-tile-note">
                    {points === rows.length ? "100% чек-листа" : `${remainingPoints.toLocaleString("ru-RU")} б. остаток`}
                  </span>
                </div>

                <div className="overview-stat-tile">
                  <span className="stat-tile-title">Строгий подсчёт</span>
                  <div className="stat-tile-val-group">
                    <strong className="stat-tile-value">{percent(strictCoverage)}</strong>
                    <span className="stat-tile-denom">({done} из {rows.length})</span>
                  </div>
                  <div className="stat-tile-bar-wrap">
                    <div
                      className="stat-tile-bar-fill bar-strict"
                      style={{ width: `${strictCoverage}%` }}
                    />
                  </div>
                  <span className="stat-tile-note">Без учёта частичных (0,5 б.)</span>
                </div>

                <div className="overview-stat-tile">
                  <span className="stat-tile-title">Критериев в коде</span>
                  <div className="stat-tile-val-group">
                    <strong className="stat-tile-value">{done + partial}</strong>
                    <span className="stat-tile-denom">/ {rows.length}</span>
                  </div>
                  <div className="stat-tile-bar-wrap">
                    <div
                      className="stat-tile-bar-fill bar-coverage"
                      style={{ width: `${((done + partial) / rows.length) * 100}%` }}
                    />
                  </div>
                  <span className="stat-tile-note">
                    {done} полных + {partial} частичных
                  </span>
                </div>

                <div className="overview-stat-tile">
                  <span className="stat-tile-title">Остаток доработки</span>
                  <div className="stat-tile-val-group">
                    <strong className="stat-tile-value stat-val-gap">
                      {remainingPoints.toLocaleString("ru-RU")}
                    </strong>
                    <span className="stat-tile-denom">баллов</span>
                  </div>
                  <div className="stat-tile-bar-wrap">
                    <div
                      className="stat-tile-bar-fill bar-gap"
                      style={{ width: `${(remainingPoints / rows.length) * 100}%` }}
                    />
                  </div>
                  <span className="stat-tile-note">
                    {partial + missing} критериев требуют внимания
                  </span>
                </div>
              </div>
            </div>

            <div className="progress-note-banner">
              <span className="note-badge">Методика</span>
              <p>
                <strong>Процент — аналитическая оценка покрытия функций, а не готовность к релизу и не доля оставшегося времени.</strong> 1 балл за реализованный критерий, 0,5 за частичный, 0 за отсутствующий. R1 — 48 критериев; R2 — ещё 24. Полная рубрика с точными ссылками на код раскрывается ниже.
              </p>
            </div>
          </div>
        </DataComponent>
      )}

      <ProgressNumbers
        rows={rows}
        features={features}
        allCriteria={allCriteria}
        phaseLabel={labels[phase]}
        cardsOnly
      />

      <ReportSection
        id="reading"
        title="Где сосредоточен остаток"
        queryId="features"
        sourceRows={reviewedRows("features").filter((r) => r.phase === "R1")}
        showHeading={false}
      >
        <div className="reading-card">
          <div className="reading-header">
            <span className="reading-kicker">ФОКУС РЕАЛИЗАЦИИ</span>
            <h2>Где сосредоточен остаток</h2>
          </div>
          <p className="reading-paragraph">
            В <strong>R1</strong> работают серверные срезы входа и прав, задачи от назначения до приёмки, журнал XP и баллов, рейтинг и профиль, резервирование и выдача косметики. Администратор уже видит аудит, каталог и историю версий.
          </p>
          <div className="reading-badges-row">
            <span className="reading-chip chip-ready">✓ Вход &amp; Права</span>
            <span className="reading-chip chip-ready">✓ Задачи &amp; Журнал</span>
            <span className="reading-chip chip-ready">✓ Профиль &amp; Рейтинг</span>
            <span className="reading-chip chip-ready">✓ Каталог &amp; Выдача</span>
            <span className="reading-chip chip-ready">✓ Аудит администратора</span>
            <span className="reading-chip chip-gap">⚠ Настройка через админку</span>
            <span className="reading-chip chip-gap">⚠ Telegram Bot API доставка</span>
          </div>
          <p className="reading-subtext">
            Основные пробелы — изменение настроек через администратора и доставка через Telegram Bot API. Счёт 100% у отдельной функции означает покрытие её шести критериев в синтетическом режиме; приёмка функции по §12 плана этим не подтверждается.
          </p>
        </div>
      </ReportSection>

      {visible("feature-coverage") && (
        <EvidenceChart
          id="feature-coverage"
          queryId="features"
          title={`Покрытие по функциям · ${labels[phase]}`}
          rows={featureRows}
          sourceRows={features}
          height={Math.max(340, features.length * 52)}
          spec={{
            type: "horizontalBar",
            x: "label",
            y: "Покрытие (%)",
            stackable: false,
            valueDecimals: 1,
            colors: { "Покрытие (%)": statusColors.Реализовано },
            showValues: true,
            domain: [0, 100],
          }}
          renderPlot={() => (
            <div className="interactive-feature-coverage-chart" data-reviewed-rows>
              <div className="feature-bars-container">
                {features.map((f) => {
                  const featureCriteria = rows.filter((r) => r.feature === f.feature);
                  const is100 = f.coverage === 100;
                  const isZero = f.coverage === 0;
                  const isExpanded = !!expandedFeatures[f.feature];
                  return (
                    <div
                      key={f.feature}
                      className={`feature-bar-row ${is100 ? "row-complete" : isZero ? "row-zero" : "row-partial"}`}
                    >
                      <div className="feature-row-header">
                        <div className="feature-title-group">
                          <span className={`feature-pill ${f.phase === "R1" ? "pill-r1" : "pill-r2"}`}>
                            {f.feature}
                          </span>
                          <span className="feature-title-text">{f.name}</span>
                          <span className="feature-phase-tag">{f.phase}</span>
                        </div>
                        <div className="feature-stats-group">
                          <strong className="feature-percent-num">
                            {f.coverage.toFixed(f.coverage % 1 === 0 ? 0 : 1)}%
                          </strong>
                          <span className="feature-points-tag">
                            {f.points.toLocaleString("ru-RU", { minimumFractionDigits: f.points % 1 === 0 ? 0 : 1 })} / 6 б.
                          </span>
                          <button
                            type="button"
                            className="feature-expand-btn"
                            aria-expanded={isExpanded}
                            onClick={() => toggleFeatureExpand(f.feature)}
                            title="Раскрыть 6 критериев"
                          >
                            {isExpanded ? "▲" : "▼"}
                          </button>
                        </div>
                      </div>

                      <div className="feature-track-outer">
                        <div
                          className="feature-track-fill"
                          style={{ width: `${Math.max(f.coverage, isZero ? 0 : 4)}%` }}
                        >
                          <div className="track-glow-lead" />
                        </div>
                      </div>

                      <div className="feature-micro-segments">
                        <span className="micro-segments-label">6 критериев:</span>
                        <div className="micro-segments-track">
                          {featureCriteria.map((c, idx) => {
                            const isDone = c.score === 1;
                            const isPart = c.score === 0.5;
                            const slotClass = isDone ? "seg-done" : isPart ? "seg-part" : "seg-miss";
                            const segId = `${c.id}-bar`;
                            const isHovered = activeSegmentTooltip === segId;
                            return (
                              <div
                                key={c.id}
                                className={`micro-seg-chip ${slotClass}`}
                                onMouseEnter={() => setActiveSegmentTooltip(segId)}
                                onMouseLeave={() => setActiveSegmentTooltip(null)}
                                onFocus={() => setActiveSegmentTooltip(segId)}
                                onBlur={() => setActiveSegmentTooltip(null)}
                                tabIndex={0}
                                role="button"
                                aria-label={`${c.criterion}: ${c.status}`}
                              >
                                <span className="chip-idx">{idx + 1}</span>
                                <span className="chip-symbol">
                                  {isDone ? "✓" : isPart ? "◐" : "—"}
                                </span>
                                {isHovered && (
                                  <div className="micro-seg-tooltip" role="tooltip">
                                    <div className="tooltip-top">
                                      <strong>#{idx + 1} {c.criterion}</strong>
                                      <span className={`tooltip-tag ${slotClass}`}>
                                        {c.status} ({c.score} б.)
                                      </span>
                                    </div>
                                    <p>{c.note}</p>
                                    <code>{c.evidence}</code>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="feature-expanded-criteria-list">
                          {featureCriteria.map((c) => (
                            <div key={c.id} className="expanded-criterion-card">
                              <div className="card-top">
                                <strong>{c.criterion}</strong>
                                <span className={`card-badge status-${c.score === 1 ? "done" : c.score === 0.5 ? "partial" : "missing"}`}>
                                  {c.status} · {c.score.toLocaleString("ru-RU")} б.
                                </span>
                              </div>
                              <p className="card-note">{c.note}</p>
                              <code className="card-code">{c.evidence}</code>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        />
      )}

      {visible("composition") && (
        <EvidenceChart
          id="composition"
          queryId="criteria"
          title={`Статусы ${rows.length} критериев · ${labels[phase]}`}
          rows={composition}
          sourceRows={rows}
          height={240}
          spec={{
            type: "horizontalStackedBar",
            x: "label",
            y: "Реализовано",
            fields: ["Реализовано", "Частично", "Отсутствует"],
            colors: statusColors,
            valueDecimals: 0,
            showValues: false,
          }}
          renderPlot={() => (
            <div className="interactive-composition-card" data-reviewed-rows>
              <div className="composition-meter-wrap">
                <div className="composition-stacked-bar" aria-hidden="true">
                  <div
                    className="comp-segment seg-done"
                    style={{ width: `${(done / rows.length) * 100}%` }}
                    title={`Реализовано: ${done}`}
                  />
                  <div
                    className="comp-segment seg-partial"
                    style={{ width: `${(partial / rows.length) * 100}%` }}
                    title={`Частично: ${partial}`}
                  />
                  <div
                    className="comp-segment seg-missing"
                    style={{ width: `${(missing / rows.length) * 100}%` }}
                    title={`Отсутствует: ${missing}`}
                  />
                </div>
              </div>

              <div className="composition-breakdown-cards">
                <div className="comp-breakdown-card card-done">
                  <div className="breakdown-header">
                    <span className="breakdown-dot dot-done" />
                    <strong>Реализовано</strong>
                    <span className="breakdown-score">1.0 балл</span>
                  </div>
                  <div className="breakdown-body">
                    <span className="breakdown-count">{done}</span>
                    <span className="breakdown-share">{percent((done / rows.length) * 100)}</span>
                  </div>
                  <span className="breakdown-desc">Полные серверные сценарии с отрицательными тестами</span>
                </div>

                <div className="comp-breakdown-card card-partial">
                  <div className="breakdown-header">
                    <span className="breakdown-dot dot-partial" />
                    <strong>Частично</strong>
                    <span className="breakdown-score">0.5 балла</span>
                  </div>
                  <div className="breakdown-body">
                    <span className="breakdown-count">{partial}</span>
                    <span className="breakdown-share">{percent((partial / rows.length) * 100)}</span>
                  </div>
                  <span className="breakdown-desc">Работает в симуляции / чтение без мутаций (+{partial * 0.5} б.)</span>
                </div>

                <div className="comp-breakdown-card card-missing">
                  <div className="breakdown-header">
                    <span className="breakdown-dot dot-missing" />
                    <strong>Отсутствует</strong>
                    <span className="breakdown-score">0 баллов</span>
                  </div>
                  <div className="breakdown-body">
                    <span className="breakdown-count">{missing}</span>
                    <span className="breakdown-share">{percent((missing / rows.length) * 100)}</span>
                  </div>
                  <span className="breakdown-desc">Ещё не реализовано в кодовой базе</span>
                </div>
              </div>
            </div>
          )}
        />
      )}

      <ProgressNumbers
        rows={rows}
        features={features}
        allCriteria={allCriteria}
        phaseLabel={labels[phase]}
      />

      <ReportSection
        id="methods"
        title="Как читать оценку"
        queryId="criteria"
        sourceRows={allCriteria}
        showHeading={false}
      >
        <div className="methods-card">
          <div className="methods-header">
            <span className="methods-kicker">ПРОЗРАЧНОСТЬ И ОГРАНИЧЕНИЯ</span>
            <h3>Как читать оценку</h3>
          </div>
          <p>
            Для каждой функции <strong>F01–F12</strong> выбраны шесть проверяемых возможностей. Функции имеют равный вес. Частичный балл означает работающую часть при явном пробеле — например, симуляционный worker без реальной отправки. Общие зависимости, такие как управление правами, встречаются в нескольких функциях.
          </p>
          <div className="methods-principles-grid">
            <div className="principle-box">
              <span className="principle-num">01</span>
              <strong>Только серверный код</strong>
              <p>Прототип R0, макеты и будущие функции не засчитываются как реализация.</p>
            </div>
            <div className="principle-box">
              <span className="principle-num">02</span>
              <strong>Не трудоёмкость</strong>
              <p>Проценты отражают количество пунктов чек-листа, а не часы или сложность задач.</p>
            </div>
            <div className="principle-box">
              <span className="principle-num">03</span>
              <strong>Синтетический режим</strong>
              <p>Все тесты подтверждают работу на синтетических данных; реальный контур закрыт.</p>
            </div>
          </div>
        </div>
      </ReportSection>

      <DataComponent
        id="architecture"
        queryId="architecture"
        kind="custom"
        title="Как устроен реализованный цикл"
        sourceRows={reviewedRows("architecture")}
        displayRows={reviewedRows("architecture")}
      >
        <div className="progress-architecture-canvas" data-reviewed-rows>
          <div className="pipeline-nodes-flow">
            <div className="pipeline-node node-ui">
              <div className="node-badge">01 / ИНТЕРФЕЙС</div>
              <strong className="node-title">Telegram WebView</strong>
              <p className="node-tech">React · Safe Areas · Отчёты</p>
              <span className="node-status-tag tag-verified">Локальный UI</span>
            </div>

            <div className="pipeline-connector-flow" aria-hidden="true">
              <span className="flow-line" />
              <span className="flow-arrow">→</span>
            </div>

            <div className="pipeline-node node-api">
              <div className="node-badge">02 / ГРАНИЦА</div>
              <strong className="node-title">Next.js API</strong>
              <p className="node-tech">Сессия · HMAC · CSRF · Контракты</p>
              <span className="node-status-tag tag-verified">Route Handlers</span>
            </div>

            <div className="pipeline-connector-flow" aria-hidden="true">
              <span className="flow-line" />
              <span className="flow-arrow">→</span>
            </div>

            <div className="pipeline-node node-domain">
              <div className="node-badge">03 / ПРАВИЛА</div>
              <strong className="node-title">Доменные сервисы</strong>
              <p className="node-tech">Права · XP · Баланс · Аудит</p>
              <span className="node-status-tag tag-verified">Бизнес-логика</span>
            </div>
          </div>

          <div className="architecture-database-bridge">
            <div className="bridge-vertical-line" aria-hidden="true">
              <span className="down-arrow">↓</span>
            </div>
            <div className="database-core-box">
              <div className="db-top">
                <span className="db-badge">04 / ХРАНИЛИЩЕ И ЦЕЛОСТНОСТЬ</span>
                <strong className="db-title">PostgreSQL 18 · Одна предметная транзакция</strong>
                <span className="db-migrations">Миграции 000001–000023 применены</span>
              </div>
              <div className="db-tables-grid">
                <div className="table-chip">
                  <span className="chip-ico">●</span>
                  <span>Результат задачи</span>
                </div>
                <div className="table-chip">
                  <span className="chip-ico">●</span>
                  <span>Журнал / Баланс XP</span>
                </div>
                <div className="table-chip">
                  <span className="chip-ico">●</span>
                  <span>Аудит операций</span>
                </div>
                <div className="table-chip">
                  <span className="chip-ico">●</span>
                  <span>Таблица Outbox</span>
                </div>
              </div>
            </div>
          </div>

          <div className="architecture-worker-flow">
            <div className="worker-branch">
              <div className="worker-box box-worker-active">
                <div className="worker-badge">05 / ФОНОВАЯ ОБРАБОТКА</div>
                <strong className="worker-title">Отдельный Worker</strong>
                <p className="worker-tech">Симуляция · Lease · Retry · Журнал попыток</p>
                <span className="node-status-tag tag-verified">Скрипт apps/worker</span>
              </div>

              <div className="worker-bridge-arrow" aria-hidden="true">
                <span>⇢</span>
              </div>

              <div className="worker-box box-worker-missing">
                <div className="worker-badge">ВНЕШНИЙ ШЛЮЗ</div>
                <strong className="worker-title">Telegram Bot API</strong>
                <p className="worker-tech">Реальная отправка уведомлений участникам</p>
                <span className="node-status-tag tag-warning">Адаптер отсутствует</span>
              </div>
            </div>
          </div>

          <div className="architecture-legend-note">
            <span className="legend-icon">🛡</span>
            <p>
              Бизнес-операции защищены на уровне схемы PostgreSQL и доменных сервисов. Физические мобильные устройства и Bot API в этой работе не подключались.
            </p>
          </div>
        </div>
      </DataComponent>

      <ReportSection
        id="gallery-intro"
        title="Что уже можно увидеть"
        queryId="gallery"
        sourceRows={reviewedRows("gallery")}
        showHeading={false}
      >
        <div className="gallery-intro-card">
          <span className="gallery-kicker">ИНТЕРФЕЙСНЫЕ СКРИНШОТЫ</span>
          <h2>Что уже можно увидеть</h2>
          <p>
            Снимки из сохранённых браузерных проверок 2–4 октября. Это рабочие локальные экраны на синтетических данных. Нажмите на снимок, чтобы открыть полноразмерный диалог.
          </p>
        </div>
      </ReportSection>

      <DataComponent
        id="gallery"
        queryId="gallery"
        kind="custom"
        title="Четыре реализованных экрана"
        sourceRows={reviewedRows("gallery")}
        displayRows={reviewedRows("gallery")}
      >
        <div className="progress-gallery-grid" data-reviewed-rows>
          {shots.map((shot, i) => (
            <figure key={shot.feature} className="gallery-figure">
              <div className="phone-mockup-frame">
                <div className="phone-mockup-topbar">
                  <span className="mockup-camera-dot" />
                  <span className="mockup-res-tag">{shot.res}</span>
                </div>
                <button
                  type="button"
                  className="gallery-preview-btn"
                  aria-label={`Раскрыть снимок: ${shot.title}`}
                  onClick={() => {
                    setOpened(i);
                    dialog.current.showModal();
                  }}
                >
                  <img
                    src={shot.src}
                    alt={`Интерфейс «Импульса»: ${shot.title}, синтетические данные`}
                    loading="lazy"
                  />
                  <div className="gallery-hover-overlay">
                    <span className="zoom-btn-pill">
                      <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden="true">
                        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M7 5V9M5 7H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                      Развернуть ↗
                    </span>
                  </div>
                </button>
              </div>
              <figcaption className="gallery-caption">
                <div className="caption-header">
                  <span className="caption-feature-badge">{shot.feature}</span>
                  <strong>{shot.title}</strong>
                </div>
                <span>{shot.text}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <dialog
          ref={dialog}
          className="progress-image-dialog"
          aria-label={shots[opened].title}
        >
          <div className="dialog-header">
            <div className="dialog-title-group">
              <span className="dialog-feature-badge">{shots[opened].feature}</span>
              <strong>{shots[opened].title}</strong>
              <span className="dialog-res-pill">{shots[opened].res}</span>
            </div>
            <button
              autoFocus
              type="button"
              className="dialog-close-btn"
              onClick={() => dialog.current.close()}
            >
              Закрыть ×
            </button>
          </div>
          <div className="dialog-image-body">
            <img src={shots[opened].src} alt={shots[opened].title} />
          </div>
          <div className="dialog-footer">
            <p>{shots[opened].text} · Синтетический демонстрационный профиль.</p>
          </div>
        </dialog>
      </DataComponent>

      <DataComponent
        id="criteria"
        queryId="criteria"
        kind="custom"
        title={`Проверяемая рубрика · ${labels[phase]}`}
        sourceRows={rows}
        displayRows={rows}
      >
        <div className="rubric-interactive-wrap" data-reviewed-rows>
          <div className="rubric-controls-bar">
            <div className="rubric-filter-pills" role="group" aria-label="Фильтр по статусу">
              <button
                type="button"
                className={`filter-pill ${rubricFilter === "all" ? "active" : ""}`}
                onClick={() => setRubricFilter("all")}
              >
                Все ({rows.length})
              </button>
              <button
                type="button"
                className={`filter-pill pill-done ${rubricFilter === "done" ? "active" : ""}`}
                onClick={() => setRubricFilter("done")}
              >
                ✓ Реализовано ({done})
              </button>
              <button
                type="button"
                className={`filter-pill pill-partial ${rubricFilter === "partial" ? "active" : ""}`}
                onClick={() => setRubricFilter("partial")}
              >
                ◐ Частично ({partial})
              </button>
              <button
                type="button"
                className={`filter-pill pill-missing ${rubricFilter === "missing" ? "active" : ""}`}
                onClick={() => setRubricFilter("missing")}
              >
                ○ Отсутствует ({missing})
              </button>
            </div>

            <div className="rubric-search-box">
              <span className="search-icon">🔍</span>
              <input
                type="search"
                className="rubric-search-input"
                placeholder="Поиск по критерию или коду..."
                value={rubricSearch}
                onChange={(e) => setRubricSearch(e.target.value)}
              />
              {rubricSearch && (
                <button
                  type="button"
                  className="rubric-search-clear"
                  onClick={() => setRubricSearch("")}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="progress-criteria-accordions">
            {features.map((f) => {
              const featureItems = filteredCriteriaForRubric.filter((r) => r.feature === f.feature);
              if (featureItems.length === 0) return null;
              return (
                <details key={f.feature} className="rubric-details" open={rubricFilter !== "all" || !!rubricSearch}>
                  <summary className="rubric-summary">
                    <div className="summary-left">
                      <span className="summary-pill">{f.feature}</span>
                      <strong className="summary-title">{f.name}</strong>
                    </div>
                    <div className="summary-right">
                      <span className="summary-items-count">{featureItems.length} из 6</span>
                      <strong className="summary-coverage">{percent(f.coverage)}</strong>
                      <span className="accordion-chevron" aria-hidden="true" />
                    </div>
                  </summary>
                  <div className="progress-criterion-list">
                    {featureItems.map((r) => (
                      <div key={r.id} className="progress-criterion-card">
                        <div className="criterion-top">
                          <strong className="criterion-title">{r.criterion}</strong>
                          <span
                            className={`criterion-status-badge status-${r.score === 1 ? "done" : r.score === 0.5 ? "partial" : "missing"}`}
                          >
                            {r.score === 1 ? "✓ Реализован" : r.score === 0.5 ? "◐ Частично" : "○ Отсутствует"} · {r.score.toLocaleString("ru-RU")} б.
                          </span>
                        </div>
                        <p className="criterion-desc">{r.note}</p>
                        <div className="criterion-evidence-tag">
                          <span className="code-icon">⌘</span>
                          <code>{r.evidence}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </DataComponent>

      <ReportSection
        id="release-reading"
        title="Что осталось до релиза"
        queryId="gates"
        sourceRows={gates}
        showHeading={false}
      >
        <div className="release-lead-card">
          <span className="release-kicker">ГОТОВНОСТЬ К ПИЛОТУ</span>
          <h2>До релиза остаётся больше, чем дописать код</h2>
          <p>
            По §12 плана пилот требует утверждённых <strong>P-01…P-06</strong>, полной проверки F01…F08, восстановления и ручного прохода Telegram. Подтверждения закрытия этих условий в репозитории нет. R2 не блокирует первый пилот, но входит в полный целевой объём.
          </p>
        </div>
      </ReportSection>

      <DataComponent
        id="release-gates"
        queryId="gates"
        kind="custom"
        title="Условия допуска к первому пилоту"
        sourceRows={gates}
        displayRows={gates}
      >
        <div className="progress-gates-container" data-reviewed-rows>
          <div className="gates-group">
            <div className="gates-group-header">
              <span className="group-badge badge-owner">P-01 … P-06</span>
              <h3>Решения владельца (Управленческий контур)</h3>
            </div>
            <p className="gates-group-desc">
              Без письменного решения владельца допуск реальных участников заблокирован, даже если код готов.
            </p>
            <div className="gates-cards-list">
              {ownerGates.map((g) => (
                <div key={g.id} className="gate-card gate-owner">
                  <div className="gate-card-id">{g.id}</div>
                  <div className="gate-card-content">
                    <strong className="gate-card-title">{g.title}</strong>
                    <p className="gate-card-next">{g.next}</p>
                  </div>
                  <div className="gate-card-state">
                    <span className="gate-state-pill pill-pending">{g.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="gates-group">
            <div className="gates-group-header">
              <span className="group-badge badge-tech">Инженерия</span>
              <h3>Технические условия допуска к пилоту</h3>
            </div>
            <p className="gates-group-desc">
              Эксплуатационные проверки: аудит, мобильные клиенты, TLS, восстановление и доставка.
            </p>
            <div className="gates-cards-list">
              {engineeringGates.map((g) => (
                <div key={g.id} className="gate-card gate-tech">
                  <div className="gate-card-id">{g.id}</div>
                  <div className="gate-card-content">
                    <strong className="gate-card-title">{g.title}</strong>
                    <p className="gate-card-next">{g.next}</p>
                  </div>
                  <div className="gate-card-state">
                    <span className="gate-state-pill pill-info">{g.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DataComponent>

      <ReportSection
        id="next-work"
        title="Следующие работы"
        queryId="gates"
        sourceRows={gates}
        showHeading={false}
      >
        <div className="next-work-card">
          <div className="next-work-header">
            <span className="next-work-kicker">ДОРОЖНАЯ КАРТА</span>
            <h2>Следующие работы в порядке зависимостей</h2>
          </div>
          <div className="roadmap-steps-grid">
            <div className="roadmap-step">
              <span className="step-num">01</span>
              <strong>Управление R1</strong>
              <p>Допуск и права, версии правил, запись каталога и квот с аудитом, настройка бонусов. Решения владельца определяют допустимые операции.</p>
            </div>
            <div className="roadmap-step">
              <span className="step-num">02</span>
              <strong>Доставка и жизненный цикл</strong>
              <p>Bot API, реальные ошибки и повторы, статус доставки, hosting worker и автоматическое истечение резервов.</p>
            </div>
            <div className="roadmap-step">
              <span className="step-num">03</span>
              <strong>Переход из синтетического режима</strong>
              <p>После P-решений — согласованная схема, правила, данные, миграции и эксплуатационная инструкция.</p>
            </div>
            <div className="roadmap-step">
              <span className="step-num">04</span>
              <strong>Приёмка и выпуск</strong>
              <p>PostgreSQL 17.6 CI, security scan и зависимости, TLS, нагрузка, restore, Android/iOS; затем согласованная раскатка app/API/worker.</p>
            </div>
          </div>
          <div className="roadmap-footer-notice">
            <span>Срок и бюджет не оценены: для них нужен согласованный объём оставшихся операций и эксплуатационный контур.</span>
          </div>
        </div>
      </ReportSection>

      <ReportSection
        id="verification"
        title="Что проверено"
        queryId="checks"
        sourceRows={reviewedRows("checks")}
        showHeading={false}
      >
        <div className="verification-card">
          <span className="verification-kicker">ЖУРНАЛ ПРОВЕРОК</span>
          <h2>Что проверено</h2>
          <RichNarrative
            id="progress:verification-copy"
            value={snapshot.verificationText}
          />
        </div>
      </ReportSection>

      <footer className="progress-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="hud-pulse" />
            <strong>«ИМПУЛЬС» · Аналитический отчёт реализации</strong>
          </div>
          <RichNarrative
            id="progress:footer"
            value="Источник требований — IMPLEMENTATION_PLAN.md §§10–12. Источник реализации — локальные API, доменные сервисы, миграции и docs/verification. Меню каждого блока позволяет открыть использованные данные и методику. Отчёт фиксирует состояние на 5 октября 2026 года; новые изменения требуют пересчёта."
          />
        </div>
      </footer>
    </article>
  );
}
