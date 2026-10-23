"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  rulesPublishRequestSchema,
  rulesPublishResponseSchema,
  rulesResponseSchema,
  type RulesPublishRequest,
  type RulesResponse,
} from "@impuls/contracts";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { Select } from "@/shared/ui/select";
import "./rules-admin.css";

// Бонус задаётся одной долей фонда; название прежнего бонуса сохраняется, пока доля та же.
type BonusRow = { title: string; percent: string; original: number | null };
const QUERY_KEY = ["admin-rules"];
const dateText = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

async function load(): Promise<RulesResponse> {
  const response = await fetch("/api/v1/admin/rules", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw Object.assign(new Error("rules"), { status: response.status });
  return rulesResponseSchema.parse(await response.json());
}

// Поля уровней 2…N → [0, …]; нет полей — уровни не настроены (null).
function parseLevels(rows: string[]): number[] | null | "invalid" {
  if (!rows.length) return null;
  if (rows.some((row) => !/^\d+$/.test(row.trim()))) return "invalid";
  return [0, ...rows.map((row) => Number(row.trim()))];
}
const wholeOrEmpty = (text: string) => /^\d*$/.test(text.trim());
// Варианты нижнего предела; нестандартное действующее значение добавляется отдельно.
const MIN_CHOICES = [100, 90, 75, 50, 25];
const DEFAULT_REASON = "Изменение настроек начислений";
const EXAMPLE_FUND = 100;

type Settings = {
  timeZone: string;
  acceptanceEnabled: boolean;
  minPercent: number | null;
  bonuses: { title: string; percent: number }[];
  levelThresholds: number[] | null;
  levelNames: string[];
  openTaskLimit: number | null;
};
const NOT_SET = "не задано";
// Одна строка на настройку: по ней сравниваются «было» и «станет».
const labels: [string, (value: Settings) => string][] = [
  ["Часовой пояс месяца", (v) => v.timeZone],
  [
    "Начисление при приёмке",
    (v) => (v.acceptanceEnabled ? "включено" : "выключено"),
  ],
  [
    "Минимальная награда",
    (v) =>
      v.minPercent === null
        ? "вся награда, снижать нельзя"
        : `${v.minPercent} % награды`,
  ],
  [
    "Бонусы",
    (v) =>
      v.bonuses.length
        ? v.bonuses.map((b) => `+${b.percent} %`).join(", ")
        : "нет",
  ],
  [
    "Уровни",
    (v) =>
      v.levelThresholds && v.levelThresholds.length > 1
        ? v.levelThresholds
            .map((t, i) => `${levelLabel(v, i)} с ${t} XP`)
            .join(", ")
        : "не заданы",
  ],
  [
    "Свободных задач на человека",
    (v) =>
      v.openTaskLimit === null ? "без предела" : `не больше ${v.openTaskLimit}`,
  ],
];
const changesBetween = (before: Settings | null, after: Settings) =>
  labels.flatMap(([title, text]) => {
    const was = before ? text(before) : NOT_SET;
    const now = text(after);
    return was === now ? [] : [{ title, was, now }];
  });

// Название уровня или «N-й уровень», если название не задано.
const levelLabel = (v: Settings, index: number) =>
  v.levelNames[index]?.trim() || `${index + 1}-й уровень`;

// Действующие настройки простыми словами на примере задачи с фондом 100 XP.
function plainSummary(v: Settings): string[] {
  const lines: string[] = [];
  if (!v.acceptanceEnabled)
    lines.push("При приёмке отчёта XP и баллы сейчас не начисляются.");
  else {
    const low =
      v.minPercent === null || v.minPercent === 100
        ? `ровно ${EXAMPLE_FUND} XP`
        : `от ${Math.floor((EXAMPLE_FUND * v.minPercent) / 100)} до ${EXAMPLE_FUND} XP — на выбор проверяющего`;
    lines.push(`За задачу на ${EXAMPLE_FUND} XP исполнитель получит ${low}.`);
    if (v.bonuses.length)
      lines.push(
        `За отличную работу проверяющий может добавить ${v.bonuses.map((b) => `+${Math.floor((EXAMPLE_FUND * b.percent) / 100)} XP`).join(" или ")}.`,
      );
    lines.push("Баллы считаются так же.");
  }
  lines.push(
    v.levelThresholds && v.levelThresholds.length > 1
      ? `Уровни: ${v.levelThresholds.map((t, i) => `${levelLabel(v, i)} с ${t} XP`).join(", ")}.`
      : "Уровни не заданы.",
  );
  lines.push(
    v.openTaskLimit === null
      ? "Свободных задач один человек может взять сколько угодно."
      : `Свободных задач один человек может держать не больше ${v.openTaskLimit}.`,
  );
  return lines;
}

export function RulesAdmin() {
  const { loseAccess } = useAuthorizedSession();
  const id = useId();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: load, retry: false });
  const [done, setDone] = useState(false);
  const current = query.data?.current ?? null;
  const failure = query.error as (Error & { status?: number }) | null;
  useEffect(() => {
    if (failure?.status === 401 || failure?.status === 403)
      loseAccess(failure.status);
  }, [failure, loseAccess]);
  return (
    <section
      className="tasks-section rules-admin"
      aria-labelledby={`${id}-title`}
    >
      <div className="tasks-heading">
        <div>
          <h2 id={`${id}-title`}>Настройки начислений</h2>
          <p>
            Сколько XP и баллов получает исполнитель после проверки. Изменения
            касаются только новых задач.
          </p>
        </div>
      </div>
      {query.isPending ? <p role="status">Загружаем настройки…</p> : null}
      {failure && failure.status !== 401 && failure.status !== 403 ? (
        <p role="alert">
          {failure.status === 404
            ? "Изменение настроек выключено или недоступно."
            : "Настройки не загрузились. Попробуйте позже."}
        </p>
      ) : null}
      {query.data ? (
        <>
          {current ? null : (
            <p>Настроек ещё нет: первое сохранение создаст их.</p>
          )}
          {current?.legacyOptions ? (
            <p className="notification-note">
              Сейчас часть настроек задана в абсолютных числах. Форма показывает
              только доли фонда; сохранение заменит их долями.
            </p>
          ) : null}
          {current ? (
            <div className="rules-summary">
              <h3>Как сейчас</h3>
              <ul>
                {plainSummary(current).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {done ? <p role="status">Настройки сохранены.</p> : null}
          <RulesForm
            key={current?.versionNumber ?? 0}
            current={current}
            onPublished={() => setDone(true)}
          />
          <h3>Кто и когда менял</h3>
          {query.data.history.length ? (
            <ul className="rules-history">
              {query.data.history.map((item) => (
                <li key={item.versionNumber}>
                  {dateText(item.effectiveFrom)}
                  {item.publishedBy ? `, ${item.publishedBy}` : ""}
                  {item.reason ? ` — ${item.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>Изменений ещё не было.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

// Поля заполняются действующими настройками при создании формы. После сохранения
// формируется новая запись, форма пересоздаётся (key) и показывает сохранённое.
function RulesForm({
  current,
  onPublished,
}: {
  current: RulesResponse["current"];
  onPublished(): void;
}) {
  const { csrfToken, reportDirty, loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  const id = useId();
  // Часовой пояс месяца решён владельцем (Europe/Moscow, P-04) и в форме не меняется.
  const zone = current?.timeZone ?? "Europe/Moscow";
  const [enabled, setEnabled] = useState(current?.acceptanceEnabled ?? true);
  // «100» — снижать нельзя (на сервере это null).
  const [minPercent, setMinPercent] = useState(
    String(current?.minPercent ?? 100),
  );
  const minChoices = [
    ...new Set([...MIN_CHOICES, current?.minPercent ?? 100]),
  ].sort((x, y) => y - x);
  const [bonuses, setBonuses] = useState<BonusRow[]>(
    () =>
      current?.bonuses.map((b) => ({
        title: b.title,
        percent: String(b.percent),
        original: b.percent,
      })) ?? [],
  );
  // Пороги со второго уровня: первый всегда начинается с 0 XP.
  const [levels, setLevels] = useState<string[]>(
    () => current?.levelThresholds?.slice(1).map(String) ?? [],
  );
  // Названия уровней по порядку, с первого; пустое поле — уровень без названия.
  const [names, setNames] = useState<string[]>(() => current?.levelNames ?? []);
  const [limit, setLimit] = useState(
    current?.openTaskLimit == null ? "" : String(current.openTaskLimit),
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RulesPublishRequest | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(false);
  const intent = useRef<{ key: string; body: RulesPublishRequest } | null>(
    null,
  );
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    reportDirty(touched);
    return () => reportDirty(false);
  }, [touched, reportDirty]);

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setTouched(true);
      setPreview(null);
      setStatus("");
    };

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const thresholds = parseLevels(levels);
    const percents = bonuses.map((b) => Number(b.percent));
    const min = Number(minPercent);
    const parsed =
      thresholds === "invalid" ||
      !wholeOrEmpty(limit) ||
      bonuses.some((b) => !/^\d+$/.test(b.percent.trim()))
        ? null
        : rulesPublishRequestSchema.safeParse({
            timeZone: zone.trim(),
            acceptanceEnabled: enabled,
            minPercent: min >= 100 ? null : min,
            bonuses: bonuses.map((b, i) => ({
              code: `plus_${percents[i]}`,
              title:
                b.original === percents[i] && b.title.trim()
                  ? b.title
                  : `Бонус +${percents[i]} %`,
              percent: percents[i],
            })),
            levelThresholds: thresholds,
            levelNames: Array.isArray(thresholds)
              ? thresholds.map((_, i) => (names[i] ?? "").trim())
              : [],
            openTaskLimit: limit.trim() ? Number(limit) : null,
            reason: reason.trim() || DEFAULT_REASON,
          });
    if (!parsed?.success) {
      setStatus(
        "Проверьте поля: бонусы — разные целые проценты от 1 до 100, каждый следующий уровень больше предыдущего, свободных задач от 1 до 50 или пусто.",
      );
      return;
    }
    if (current && !changesBetween(current, parsed.data).length) {
      setStatus("Вы ничего не изменили.");
      return;
    }
    setPreview(parsed.data);
    setStatus("");
  }

  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= { key: crypto.randomUUID(), body: preview };
    setSent(true);
    running.current = true;
    setPending(true);
    setStatus("Сохраняем настройки…");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/v1/admin/rules", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": intent.current.key,
        },
        body: JSON.stringify(intent.current.body),
      });
      if (!alive.current) return;
      if (response.status === 401 || response.status === 403) {
        loseAccess(response.status);
        return;
      }
      if (response.status === 429) {
        setStatus(mutationLimitMessage(response));
        return;
      }
      if ([400, 404, 409, 413, 422].includes(response.status)) {
        setBlocked(true);
        setStatus(
          "Сохранение отклонено. Обновите экран и проверьте поля: возможно, изменение настроек выключено или запрос уже использован.",
        );
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      rulesPublishResponseSchema.parse(await response.json());
      onPublished();
      setPreview(null);
      setTouched(false);
      reportDirty(false);
      intent.current = null;
      setSent(false);
      await client.invalidateQueries({ queryKey: QUERY_KEY });
      setStatus("");
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Поля сохранены. Повторите тот же запрос — сервер не сохранит изменения дважды.",
        );
    } finally {
      clearTimeout(timeout);
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  return (
    <form className="rules-form" onSubmit={review} aria-busy={pending}>
      {preview ? (
        <>
          <h3>Проверьте изменения</h3>
          <ul>
            {changesBetween(current, preview).map((item) => (
              <li key={item.title}>
                {item.title}: {item.was} → {item.now}
              </li>
            ))}
          </ul>
          {preview.reason !== DEFAULT_REASON ? (
            <p className="admin-catalog-conditions">
              Комментарий: {preview.reason}
            </p>
          ) : null}
          {!sent ? (
            <button
              type="button"
              className="tasks-action"
              onClick={() => setPreview(null)}
            >
              Вернуться к полям
            </button>
          ) : null}
          <button
            type="button"
            className="tasks-action"
            disabled={pending || blocked}
            onClick={() => void send()}
          >
            {pending
              ? "Сохраняем…"
              : sent
                ? "Повторить тот же запрос"
                : "Сохранить"}
          </button>
        </>
      ) : (
        <>
          <fieldset>
            <legend>Награда при приёмке</legend>
            <label>
              <span id="rules-min-percent-label">
                Минимум, который получит исполнитель
              </span>
              <Select
                labelledBy="rules-min-percent-label"
                value={minPercent}
                onValueChange={edit(setMinPercent)}
                options={minChoices.map((value) => ({
                  value: String(value),
                  label:
                    value === 100
                      ? "Вся награда — снижать нельзя"
                      : `${value} % награды`,
                }))}
              />
            </label>
            <p className="notification-note">
              Проверяющий выбирает сумму от этого минимума до полной награды
              задачи.
            </p>
          </fieldset>
          <fieldset>
            <legend>Бонусы за отличную работу</legend>
            <p className="notification-note">
              Проверяющий может добавить один бонус — процент от награды задачи.
              Баллы и XP за одну задачу — не больше 100 с учётом бонуса: если
              итог выше, начисление не пройдёт, и проверяющий выберет меньшую
              базу или бонус.
            </p>
            {bonuses.map((row, index) => (
              <div key={index} className="rules-row">
                <label>
                  <span>Бонус {index + 1}, %</span>
                  <input
                    inputMode="numeric"
                    value={row.percent}
                    onChange={(e) =>
                      edit(setBonuses)(
                        bonuses.map((b, i) =>
                          i === index ? { ...b, percent: e.target.value } : b,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="tasks-action"
                  aria-label={`Убрать бонус ${index + 1}`}
                  onClick={() =>
                    edit(setBonuses)(bonuses.filter((_, i) => i !== index))
                  }
                >
                  Убрать
                </button>
              </div>
            ))}
            {bonuses.length < 7 ? (
              <button
                type="button"
                className="tasks-action"
                onClick={() =>
                  edit(setBonuses)([
                    ...bonuses,
                    { title: "", percent: "", original: null },
                  ])
                }
              >
                Добавить бонус
              </button>
            ) : null}
          </fieldset>
          <fieldset>
            <legend>Уровни</legend>
            <p className="notification-note">
              {levels.length
                ? "Уровень растёт, когда у участника набирается указанный XP. Названия необязательны; после последнего уровня уровни продолжаются без предела."
                : "Уровни не заданы: в профиле уровень не показывается."}
            </p>
            {levels.length ? (
              <div className="rules-row">
                <p className="rules-fixed">1-й уровень — с 0 XP</p>
                <label>
                  <span>Название 1-го уровня</span>
                  <input
                    maxLength={40}
                    value={names[0] ?? ""}
                    placeholder="Без названия"
                    onChange={(e) =>
                      edit(setNames)(
                        Array.from(
                          { length: Math.max(names.length, 1) },
                          (_, i) =>
                            i === 0 ? e.target.value : (names[i] ?? ""),
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ) : null}
            {levels.map((value, index) => (
              <div key={index} className="rules-row">
                <label>
                  <span>{index + 2}-й уровень — с XP</span>
                  <input
                    inputMode="numeric"
                    value={value}
                    onChange={(e) =>
                      edit(setLevels)(
                        levels.map((v, i) =>
                          i === index ? e.target.value : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Название {index + 2}-го уровня</span>
                  <input
                    maxLength={40}
                    value={names[index + 1] ?? ""}
                    placeholder="Без названия"
                    onChange={(e) =>
                      edit(setNames)(
                        Array.from(
                          { length: Math.max(names.length, index + 2) },
                          (_, i) =>
                            i === index + 1 ? e.target.value : (names[i] ?? ""),
                        ),
                      )
                    }
                  />
                </label>
                {index === levels.length - 1 ? (
                  <button
                    type="button"
                    className="tasks-action"
                    aria-label={`Убрать ${index + 2}-й уровень`}
                    onClick={() => {
                      edit(setLevels)(levels.slice(0, -1));
                      edit(setNames)(names.slice(0, index + 1));
                    }}
                  >
                    Убрать
                  </button>
                ) : null}
              </div>
            ))}
            {levels.length < 99 ? (
              <button
                type="button"
                className="tasks-action"
                onClick={() => {
                  const last = Number(levels.at(-1) ?? 0);
                  edit(setLevels)([
                    ...levels,
                    String(Number.isFinite(last) && last > 0 ? last * 2 : 100),
                  ]);
                }}
              >
                Добавить уровень
              </button>
            ) : null}
          </fieldset>
          <fieldset>
            <legend>Свободные задачи</legend>
            <label>
              <span>Сколько можно держать одновременно</span>
              <input
                inputMode="numeric"
                value={limit}
                placeholder="Без предела"
                onChange={(e) => edit(setLimit)(e.target.value)}
              />
            </label>
            <p className="notification-note">
              Считаются задачи, которые человек взял сам и ещё не сдал. Пусто —
              без предела.
            </p>
          </fieldset>
          <details className="rules-more">
            <summary>Дополнительно</summary>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => edit(setEnabled)(e.target.checked)}
              />
              <span>Начислять XP и баллы при приёмке</span>
            </label>
            <p className="notification-note">
              Если снять галочку, принятые задачи перестанут давать XP и баллы.
            </p>
            <label htmlFor={`${id}-reason`}>Комментарий для журнала</label>
            <textarea
              id={`${id}-reason`}
              maxLength={2000}
              rows={2}
              value={reason}
              placeholder={DEFAULT_REASON}
              onChange={(e) => edit(setReason)(e.target.value)}
            />
          </details>
          <button type="submit" className="tasks-action">
            Проверить изменения
          </button>
        </>
      )}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
    </form>
  );
}
