import React, { useState } from "react";
import {
  DataComponent,
  EvidenceChart,
  useDataApp,
} from "../../data-app-public.jsx";

export const statusColors = {
  Реализовано: "var(--progress-done)",
  Частично: "var(--progress-partial)",
  Отсутствует: "var(--progress-missing)",
};

export function ProgressNumbers({
  rows,
  features,
  allCriteria,
  phaseLabel,
  cardsOnly = false,
}) {
  const { visible } = useDataApp();
  const [activeCellTooltip, setActiveCellTooltip] = useState(null);

  const done = rows.filter((r) => r.score === 1).length;
  const partial = rows.filter((r) => r.score === 0.5).length;
  const missing = rows.filter((r) => r.score === 0).length;
  const earnedPoints = rows.reduce((s, r) => s + r.score, 0);
  const remaining = rows.length - earnedPoints;

  const donePercent = Math.round((done / rows.length) * 100);
  const partialPercent = Math.round((partial / rows.length) * 100);
  const missingPercent = Math.round((missing / rows.length) * 100);

  const detail = features.map((f) => ({
    ...f,
    Реализовано: f.done,
    Частично: f.partial,
    Отсутствует: f.missing,
  }));

  const stages = ["R1", "R2"].map((phase) => {
    const c = allCriteria.filter((r) => r.phase === phase);
    const earned = c.reduce((s, r) => s + r.score, 0);
    const doneCount = c.filter((r) => r.score === 1).length;
    const partialCount = c.filter((r) => r.score === 0.5).length;
    const missingCount = c.filter((r) => r.score === 0).length;
    return {
      phase,
      label: `${phase} · ${c.length} баллов`,
      doneCount,
      partialCount,
      missingCount,
      Выполнено: doneCount,
      "Засчитано частично": partialCount * 0.5,
      Осталось: c.length - earned,
      earned,
      total: c.length,
      percent: Math.round((100 * earned) / c.length),
    };
  });

  return (
    <>
      {cardsOnly && visible("criterion-numbers") && (
        <DataComponent
          id="criterion-numbers"
          kind="custom"
          queryId="criteria"
          title={`Что означают проценты · ${phaseLabel}`}
          sourceRows={rows}
          displayRows={rows}
        >
          <div
            className="progress-number-cards"
            data-reviewed-rows
            aria-live="polite"
          >
            <div className="number-card number-done">
              <div className="number-card-header">
                <span className="number-card-badge status-badge-done">
                  <svg className="badge-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M5 8.2L7 10.2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  1.0 балл
                </span>
                <span className="number-card-share">{donePercent}%</span>
              </div>
              <strong className="number-card-value">{done}</strong>
              <span className="number-card-label">критериев реализовано</span>
              <div className="number-card-meter" aria-hidden="true">
                <div
                  className="meter-bar meter-done"
                  style={{ width: `${(done / rows.length) * 100}%` }}
                />
              </div>
              <small className="number-card-note">
                Из {rows.length} выбранных · Серверные операции, контракты, валидация
              </small>
            </div>

            <div className="number-card number-partial">
              <div className="number-card-header">
                <span className="number-card-badge status-badge-partial">
                  <svg className="badge-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 1A7 7 0 0 1 8 15Z" fill="currentColor" />
                  </svg>
                  0.5 балла
                </span>
                <span className="number-card-share">{partialPercent}%</span>
              </div>
              <strong className="number-card-value">{partial}</strong>
              <span className="number-card-label">реализовано частично</span>
              <div className="number-card-meter" aria-hidden="true">
                <div
                  className="meter-bar meter-partial"
                  style={{ width: `${(partial / rows.length) * 100}%` }}
                />
              </div>
              <small className="number-card-note">
                Дают +{(partial * 0.5).toLocaleString("ru-RU")} балла · Симуляционный worker, чтение без мутаций
              </small>
            </div>

            <div className="number-card number-missing">
              <div className="number-card-header">
                <span className="number-card-badge status-badge-missing">
                  <svg className="badge-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.3" />
                  </svg>
                  0 баллов
                </span>
                <span className="number-card-share">{missingPercent}%</span>
              </div>
              <strong className="number-card-value">{missing}</strong>
              <span className="number-card-label">ещё отсутствуют</span>
              <div className="number-card-meter" aria-hidden="true">
                <div
                  className="meter-bar meter-missing"
                  style={{ width: `${(missing / rows.length) * 100}%` }}
                />
              </div>
              <small className="number-card-note">
                Остаток функционала · Настройка квот, живая доставка Telegram
              </small>
            </div>

            <div className="number-card number-remaining">
              <div className="number-card-header">
                <span className="number-card-badge status-badge-remaining">
                  <svg className="badge-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2L10 6L14.5 6.7L11.2 9.9L12 14.4L8 12.3L4 14.4L4.8 9.9L1.5 6.7L6 6L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  Остаток
                </span>
                <span className="number-card-share">{remaining.toLocaleString("ru-RU")} б.</span>
              </div>
              <strong className="number-card-value">{partial + missing}</strong>
              <span className="number-card-label">нужно доработать</span>
              <div className="number-card-meter" aria-hidden="true">
                <div
                  className="meter-bar meter-remaining-fill"
                  style={{ width: `${((partial + missing) / rows.length) * 100}%` }}
                />
              </div>
              <small className="number-card-note">
                {done} × 1 + {partial} × 0,5 = {earnedPoints.toLocaleString("ru-RU")} из {rows.length} баллов
              </small>
            </div>
          </div>
          <div className="progress-numeric-callout">
            <span className="callout-pill">Формула расчёта</span>
            <p>
              Каждый критерий имеет вес 1 балл. Строго выполнено <strong>{done}</strong> критериев, частично <strong>{partial}</strong> (по 0,5 балла), отсутствуют <strong>{missing}</strong>. Сумма баллов: <strong>{earnedPoints.toLocaleString("ru-RU")} из {rows.length}</strong>. Остаток — <strong>{remaining.toLocaleString("ru-RU")} баллов</strong> аналитического чек-листа (не трудоёмкость в часах).
            </p>
          </div>
        </DataComponent>
      )}

      {!cardsOnly && visible("feature-statuses") && (
        <EvidenceChart
          id="feature-statuses"
          queryId="features"
          title={`В каждой функции — 6 критериев · ${phaseLabel}`}
          rows={detail}
          sourceRows={features}
          height={Math.max(340, features.length * 48)}
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
            <div className="interactive-feature-matrix" data-reviewed-rows>
              <div className="matrix-table-wrap">
                <table className="matrix-table">
                  <caption className="matrix-caption">
                    Матрица 6 критериев каждой функции: наведите на маркер для просмотра названия, статуса и ссылки на код.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-feature">Функция</th>
                      <th scope="col" className="col-aspects">6 критериев реализации</th>
                      <th scope="col" className="col-stat">Есть</th>
                      <th scope="col" className="col-stat">Часть</th>
                      <th scope="col" className="col-stat">Нет</th>
                      <th scope="col" className="col-gap">Доработать</th>
                      <th scope="col" className="col-points">Баллы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {features.map((f) => {
                      const featureCriteria = rows.filter((r) => r.feature === f.feature);
                      return (
                        <tr key={f.feature} className="matrix-row">
                          <th scope="row" className="cell-feature">
                            <span className="feature-code-badge">{f.feature}</span>
                            <strong className="feature-name">{f.name}</strong>
                          </th>
                          <td className="cell-aspects">
                            <div className="criteria-dots-row">
                              {featureCriteria.map((c, idx) => {
                                const isDone = c.score === 1;
                                const isPartial = c.score === 0.5;
                                const statusClass = isDone ? "dot-done" : isPartial ? "dot-partial" : "dot-missing";
                                const tooltipId = `${c.id}`;
                                const isHovered = activeCellTooltip === tooltipId;
                                return (
                                  <div
                                    key={c.id}
                                    className={`criterion-dot-slot ${statusClass}`}
                                    onMouseEnter={() => setActiveCellTooltip(tooltipId)}
                                    onMouseLeave={() => setActiveCellTooltip(null)}
                                    onFocus={() => setActiveCellTooltip(tooltipId)}
                                    onBlur={() => setActiveCellTooltip(null)}
                                    tabIndex={0}
                                    role="button"
                                    aria-label={`${idx + 1}. ${c.criterion}: ${c.status}`}
                                  >
                                    <span className="dot-index">{idx + 1}</span>
                                    <span className="dot-mark" aria-hidden="true">
                                      {isDone ? "✓" : isPartial ? "◐" : "○"}
                                    </span>
                                    {isHovered && (
                                      <div className="criterion-mini-popover" role="tooltip">
                                        <div className="popover-header">
                                          <span className="popover-num">#{idx + 1}</span>
                                          <strong>{c.criterion}</strong>
                                        </div>
                                        <div className="popover-status">
                                          <span className={`popover-tag ${statusClass}`}>
                                            {c.status} · {c.score.toLocaleString("ru-RU")} б.
                                          </span>
                                        </div>
                                        <p className="popover-note">{c.note}</p>
                                        <code className="popover-code">{c.evidence}</code>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="cell-stat stat-done">
                            <span className="pill-stat pill-done">{f.done}</span>
                          </td>
                          <td className="cell-stat stat-partial">
                            <span className="pill-stat pill-partial">{f.partial}</span>
                          </td>
                          <td className="cell-stat stat-missing">
                            <span className="pill-stat pill-missing">{f.missing}</span>
                          </td>
                          <td className="cell-gap">
                            <div className="gap-indicator">
                              <span className="gap-text">{f.partial + f.missing} / 6</span>
                              <div className="gap-track" aria-hidden="true">
                                <div
                                  className="gap-fill"
                                  style={{ width: `${((f.partial + f.missing) / 6) * 100}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="cell-points">
                            <strong className="points-badge">
                              {f.points.toLocaleString("ru-RU", { minimumFractionDigits: f.points % 1 === 0 ? 0 : 1 })} / 6
                            </strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        />
      )}

      {!cardsOnly && visible("phase-comparison") && (
        <EvidenceChart
          id="phase-comparison"
          queryId="criteria"
          title="Два этапа: сколько объёма остаётся"
          rows={stages}
          sourceRows={allCriteria}
          height={320}
          spec={{
            type: "horizontalStackedBar",
            x: "label",
            y: "Выполнено",
            fields: ["Выполнено", "Засчитано частично", "Осталось"],
            colors: {
              Выполнено: statusColors.Реализовано,
              "Засчитано частично": statusColors.Частично,
              Осталось: statusColors.Отсутствует,
            },
            valueDecimals: 1,
            showValues: false,
          }}
          renderPlot={() => (
            <div className="interactive-stage-comparison" data-reviewed-rows>
              <div className="stage-cards-grid">
                {stages.map((s) => {
                  const isR1 = s.phase === "R1";
                  return (
                    <div key={s.label} className={`stage-card ${isR1 ? "stage-r1" : "stage-r2"}`}>
                      <div className="stage-card-top">
                        <div className="stage-badge-group">
                          <span className="stage-badge">{s.phase}</span>
                          <span className="stage-subtitle">
                            {isR1 ? "Первый закрытый пилот" : "Целевое расширение системы"}
                          </span>
                        </div>
                        <div className="stage-percent-display">
                          <strong className="stage-percent">{s.percent}%</strong>
                          <span>покрытия</span>
                        </div>
                      </div>

                      <div className="stage-progress-bar-wrap" aria-hidden="true">
                        <div className="stage-progress-track">
                          <div
                            className="stage-seg-done"
                            style={{ width: `${(s.doneCount / s.total) * 100}%` }}
                            title={`Реализовано: ${s.doneCount}`}
                          />
                          <div
                            className="stage-seg-partial"
                            style={{ width: `${((s.partialCount * 0.5) / s.total) * 100}%` }}
                            title={`Частично (+${s.partialCount * 0.5} б.): ${s.partialCount}`}
                          />
                          <div
                            className="stage-seg-missing"
                            style={{ width: `${(s.Осталось / s.total) * 100}%` }}
                            title={`Осталось: ${s.Осталось}`}
                          />
                        </div>
                        <div className="stage-bar-labels">
                          <span>0%</span>
                          <span>50%</span>
                          <span>100% ({s.total} баллов)</span>
                        </div>
                      </div>

                      <div className="stage-stats-row">
                        <div className="stage-stat-item">
                          <span className="stat-value">{s.earned.toLocaleString("ru-RU")} / {s.total}</span>
                          <span className="stat-desc">набрано баллов</span>
                        </div>
                        <div className="stage-stat-item">
                          <span className="stat-value">{s.doneCount} / {s.total}</span>
                          <span className="stat-desc">полных критериев</span>
                        </div>
                        <div className="stage-stat-item">
                          <span className="stat-value stat-highlight-gap">{s.Осталось}</span>
                          <span className="stat-desc">остаток чек-листа</span>
                        </div>
                      </div>

                      <p className="stage-footer-note">
                        {isR1
                          ? "Критерии F01–F08: вход, права, задачи, XP, профиль, каталог, аудит, симуляция."
                          : "Критерии F09–F12: баланс наград, дополнительные механики, аналитика, бот."}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="total-milestone-banner">
                <div className="milestone-header">
                  <div className="milestone-title-group">
                    <span className="milestone-pill">Суммарный горизонт сервиса</span>
                    <strong>R1 + R2 · 38 из 72 баллов (52,8%)</strong>
                  </div>
                  <span className="milestone-remain">Остаток всего проекта: 34 балла</span>
                </div>
                <div className="milestone-track" aria-hidden="true">
                  <div className="milestone-fill" style={{ width: "52.8%" }}>
                    <span className="milestone-pointer">52,8%</span>
                  </div>
                  <div className="milestone-marker r1-marker" style={{ left: "66.67%" }}>
                    <span className="marker-label">Рубеж R1 (48)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        />
      )}
    </>
  );
}
