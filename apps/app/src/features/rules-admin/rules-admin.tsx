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

type BonusRow = { title: string; percent: string };
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

// «0, 100, 250» → [0, 100, 250]; пусто → null (уровни не настроены).
function parseThresholds(text: string): number[] | null | "invalid" {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return null;
  const numbers = parts.map((part) =>
    /^\d+$/.test(part) ? Number(part) : NaN,
  );
  return numbers.some(Number.isNaN) ? "invalid" : numbers;
}

type Settings = {
  timeZone: string;
  acceptanceEnabled: boolean;
  minPercent: number | null;
  bonuses: { title: string; percent: number }[];
  levelThresholds: number[] | null;
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
    "Проверяющий может снизить награду до",
    (v) => (v.minPercent === null ? "нельзя" : `${v.minPercent} % фонда`),
  ],
  [
    "Бонусы",
    (v) =>
      v.bonuses.length
        ? v.bonuses.map((b) => `${b.title} (+${b.percent} %)`).join(", ")
        : "нет",
  ],
  [
    "Пороги уровней, XP",
    (v) => (v.levelThresholds ? v.levelThresholds.join(", ") : "не настроены"),
  ],
  [
    "Предел взятых свободных задач",
    (v) => (v.openTaskLimit === null ? "без предела" : String(v.openTaskLimit)),
  ],
];
const changesBetween = (before: Settings | null, after: Settings) =>
  labels.flatMap(([title, text]) => {
    const was = before ? text(before) : NOT_SET;
    const now = text(after);
    return was === now ? [] : [{ title, was, now }];
  });

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
    <section className="tasks-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Настройки начислений</h2>
      <p className="notification-note">
        Здесь задано, как считаются награды и уровни. Новые доли и бонусы
        действуют для задач, созданных после сохранения: уже созданные задачи и
        начисленное не меняются. Пороги уровней применяются сразу ко всем.
      </p>
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
          <p>
            {current
              ? `Действуют с ${dateText(current.effectiveFrom)}.`
              : "Настроек ещё нет: первое сохранение создаст их."}
          </p>
          {current?.legacyOptions ? (
            <p className="notification-note">
              Сейчас часть настроек задана в абсолютных числах. Форма показывает
              только доли фонда; сохранение заменит их долями.
            </p>
          ) : null}
          {done ? <p role="status">Настройки сохранены.</p> : null}
          <RulesForm
            key={current?.versionNumber ?? 0}
            current={current}
            onPublished={() => setDone(true)}
          />
          <h3>Кто и когда менял</h3>
          {query.data.history.length ? (
            <ul>
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
  const [zone, setZone] = useState(current?.timeZone ?? "Europe/Moscow");
  const [enabled, setEnabled] = useState(current?.acceptanceEnabled ?? true);
  const [adjust, setAdjust] = useState(current?.minPercent != null);
  const [minPercent, setMinPercent] = useState(
    String(current?.minPercent ?? 50),
  );
  const [bonuses, setBonuses] = useState<BonusRow[]>(
    () =>
      current?.bonuses.map((b) => ({
        title: b.title,
        percent: String(b.percent),
      })) ?? [],
  );
  const [levels, setLevels] = useState(
    current?.levelThresholds?.join(", ") ?? "",
  );
  const [limited, setLimited] = useState(current?.openTaskLimit != null);
  const [limit, setLimit] = useState(String(current?.openTaskLimit ?? 3));
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
    const thresholds = parseThresholds(levels);
    const percents = bonuses.map((b) => Number(b.percent));
    const parsed =
      thresholds === "invalid"
        ? null
        : rulesPublishRequestSchema.safeParse({
            timeZone: zone.trim(),
            acceptanceEnabled: enabled,
            minPercent:
              adjust && /^\d+$/.test(minPercent) ? Number(minPercent) : null,
            bonuses: bonuses.map((b, i) => ({
              code: `plus_${percents[i]}`,
              title: b.title,
              percent: percents[i],
            })),
            levelThresholds: thresholds,
            openTaskLimit:
              limited && /^\d+$/.test(limit) ? Number(limit) : null,
            reason,
          });
    if (
      !parsed?.success ||
      (adjust && !/^\d+$/.test(minPercent)) ||
      (limited && !/^\d+$/.test(limit))
    ) {
      setStatus(
        "Проверьте поля: часовой пояс из списка IANA, нижний предел от 0 до 100, бонусы с разными целыми процентами, пороги уровней по возрастанию с нуля, предел задач от 1 до 50 и пояснение.",
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
    <form className="tasks-filter" onSubmit={review} aria-busy={pending}>
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
          <p className="admin-catalog-conditions">
            Пояснение: {preview.reason}
          </p>
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
            <legend>Проверка отчёта</legend>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => edit(setEnabled)(e.target.checked)}
              />
              <span>Начислять XP и баллы при приёмке</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={adjust}
                onChange={(e) => edit(setAdjust)(e.target.checked)}
              />
              <span>Проверяющий может снижать награду</span>
            </label>
            {adjust ? (
              <label>
                <span>Не ниже, % от фонда задачи</span>
                <input
                  inputMode="numeric"
                  value={minPercent}
                  onChange={(e) => edit(setMinPercent)(e.target.value)}
                />
              </label>
            ) : null}
          </fieldset>
          <fieldset>
            <legend>Бонусы проверяющего (не более семи)</legend>
            <p className="notification-note">
              Проверяющий может добавить к награде один бонус — долю фонда
              задачи.
            </p>
            {bonuses.map((row, index) => (
              <div key={index} className="catalog-publication-field">
                <label>
                  <span>Название бонуса {index + 1}</span>
                  <input
                    value={row.title}
                    maxLength={80}
                    onChange={(e) =>
                      edit(setBonuses)(
                        bonuses.map((b, i) =>
                          i === index ? { ...b, title: e.target.value } : b,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Доля фонда, %</span>
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
                  onClick={() =>
                    edit(setBonuses)(bonuses.filter((_, i) => i !== index))
                  }
                >
                  Убрать бонус {index + 1}
                </button>
              </div>
            ))}
            {bonuses.length < 7 ? (
              <button
                type="button"
                className="tasks-action"
                onClick={() =>
                  edit(setBonuses)([...bonuses, { title: "", percent: "" }])
                }
              >
                Добавить бонус
              </button>
            ) : null}
          </fieldset>
          <fieldset>
            <legend>Уровни</legend>
            <label>
              <span>Пороги уровней, XP через запятую</span>
              <input
                value={levels}
                placeholder="0, 100, 250, 500"
                onChange={(e) => edit(setLevels)(e.target.value)}
              />
            </label>
            <p className="notification-note">
              Это XP, с которого начинается каждый уровень. Первый порог — 0,
              каждый следующий больше предыдущего. Пусто — уровни не настроены,
              профиль скажет об этом.
            </p>
          </fieldset>
          <fieldset>
            <legend>Свободные задачи</legend>
            <label>
              <input
                type="checkbox"
                checked={limited}
                onChange={(e) => edit(setLimited)(e.target.checked)}
              />
              <span>Ограничить число взятых задач у одного участника</span>
            </label>
            {limited ? (
              <label>
                <span>Не больше незавершённых взятых задач</span>
                <input
                  inputMode="numeric"
                  value={limit}
                  onChange={(e) => edit(setLimit)(e.target.value)}
                />
              </label>
            ) : null}
            <p className="notification-note">
              Считаются задачи, которые участник взял сам и ещё не довёл до
              приёмки. Без галочки предела нет.
            </p>
          </fieldset>
          <fieldset>
            <legend>Месяц</legend>
            <label>
              <span>Часовой пояс расчёта месяца</span>
              <input
                value={zone}
                required
                maxLength={80}
                onChange={(e) => edit(setZone)(e.target.value)}
              />
            </label>
          </fieldset>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Что меняете и почему</label>
            <textarea
              id={`${id}-reason`}
              required
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(e) => edit(setReason)(e.target.value)}
            />
          </div>
          <button type="submit" className="tasks-action">
            Проверить изменения
          </button>
        </>
      )}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
    </form>
  );
}
