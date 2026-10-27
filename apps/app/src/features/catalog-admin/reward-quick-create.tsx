"use client";
import {
  catalogCreationRequestSchema,
  catalogCreationResponseSchema,
  catalogPublicationResponseSchema,
  quotaPublicationResponseSchema,
} from "@impuls/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { RewardBadge } from "../rewards/reward-visual";

// «Новое поощрение» за один шаг: создать позицию, включить её и открыть места.
// Это три существующие серверные операции подряд, каждая со своим ключом
// идемпотентности; при сбое повтор продолжает с того шага, где остановились.
type Plan = {
  title: string;
  conditions: string;
  price: number;
  capacity: number | null;
  endsAt: string;
  reason: string;
};
type Progress = {
  plan: Plan;
  keys: [string, string, string];
  step: 0 | 1 | 2 | 3;
  rewardId: string | null;
  startsAt: string | null;
};

const DAY = 24 * 60 * 60 * 1000;
// Значение для <input type="date">: локальная дата через 30 дней.
function defaultEnd() {
  const date = new Date(Date.now() + 30 * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const dateText = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(
    new Date(value),
  );

class StepError extends Error {
  constructor(
    readonly status: number,
    readonly response: Response,
  ) {
    super(`step failed: ${status}`);
  }
}

export function RewardQuickCreate({
  scope,
  serverTime,
  onClose,
  onDone,
  onDenied,
}: {
  scope: string;
  serverTime: string;
  onClose: () => void;
  onDone: (title: string) => void;
  onDenied: () => void;
}) {
  const { csrfToken, loseAccess, reportDirty, confirmLeave } =
    useAuthorizedSession();
  const id = useId();
  const [title, setTitle] = useState("");
  const [conditions, setConditions] = useState("");
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [until, setUntil] = useState(defaultEnd);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const progress = useRef<Progress | null>(null);
  // Отражение progress для разметки: после первой отправки поля закрыты.
  const [started, setStarted] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  const dirty = Boolean(title || conditions || price || capacity || unlimited);
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(false);
  }, [dirty, reportDirty]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function post(path: string, key: string, body: unknown) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new StepError(response.status, response);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function run() {
    const current = progress.current;
    if (!current || running.current || blocked) return;
    running.current = true;
    setPending(true);
    setStatus("Сохраняем поощрение…");
    const { plan, keys } = current;
    try {
      if (current.step === 0) {
        const saved = catalogCreationResponseSchema.parse(
          await post("/api/v1/admin/rewards", keys[0], {
            scope,
            title: plan.title,
            conditions: plan.conditions,
            price: plan.price,
            reservationSeconds: null,
            reason: plan.reason,
          }),
        );
        if (saved.scope !== scope) throw new Error("unconfirmed");
        current.rewardId = saved.creation.rewardId;
        current.step = 1;
      }
      if (current.step === 1) {
        catalogPublicationResponseSchema.parse(
          await post(
            `/api/v1/admin/rewards/${current.rewardId}/versions`,
            keys[1],
            {
              scope,
              expectedVersion: 1,
              title: plan.title,
              conditions: plan.conditions,
              price: plan.price,
              enabled: true,
              reservationSeconds: null,
              reason: plan.reason,
            },
          ),
        );
        current.step = 2;
      }
      if (current.step === 2) {
        // Начало периода — через минуту по часам сервера: сервер принимает
        // только будущее начало. Повтор отправляет то же самое время.
        current.startsAt ??= new Date(
          Math.ceil(
            (Math.max(Date.now(), new Date(serverTime).getTime()) + 60_000) /
              1000,
          ) * 1000,
        ).toISOString();
        quotaPublicationResponseSchema.parse(
          await post(
            `/api/v1/admin/rewards/${current.rewardId}/quotas`,
            keys[2],
            {
              scope,
              startsAt: current.startsAt,
              endsAt: plan.endsAt,
              capacity: plan.capacity,
              reason: plan.reason,
            },
          ),
        );
        current.step = 3;
      }
      if (!alive.current) return;
      reportDirty(false);
      progress.current = null;
      setStarted(false);
      onDone(plan.title);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof StepError) {
        if (error.status === 401 || error.status === 403) {
          loseAccess(error.status);
          return;
        }
        if (error.status === 404) {
          onDenied();
          return;
        }
        if (error.status === 429) {
          setStatus(mutationLimitMessage(error.response));
          return;
        }
        if ([400, 409, 413, 422].includes(error.status)) {
          setBlocked(true);
          setStatus(
            current.step === 0
              ? "Сервер отклонил поощрение. Закройте форму, обновите каталог и проверьте поля."
              : "Поощрение создано, но открыть его не удалось. Закройте форму: в списке ниже можно опубликовать условия и период вручную.",
          );
          return;
        }
      }
      setStatus(
        "Нет подтверждения сервера. Поля сохранены; нажмите «Повторить» — повтор не создаст дубль.",
      );
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (progress.current) {
      void run();
      return;
    }
    const ends = until ? new Date(`${until}T23:59:59`) : null;
    const reason = `Новое поощрение «${title.trim()}»`;
    const parsed = catalogCreationRequestSchema.safeParse({
      scope,
      title,
      conditions,
      price: /^[1-9]\d*$/.test(price) ? Number(price) : NaN,
      reservationSeconds: null,
      reason,
    });
    const places = unlimited
      ? null
      : /^[1-9]\d*$/.test(capacity)
        ? Number(capacity)
        : NaN;
    if (
      !parsed.success ||
      (places !== null && !(places >= 1 && places <= 1_000_000)) ||
      !ends ||
      !(ends.getTime() > Date.now() + 2 * 60_000)
    ) {
      setStatus(
        "Заполните все поля: цена и количество — целые числа больше нуля или отметьте «Без лимита», дата окончания — позже сегодняшнего дня.",
      );
      return;
    }
    progress.current = {
      plan: {
        title: parsed.data.title,
        conditions: parsed.data.conditions,
        price: parsed.data.price,
        capacity: places,
        endsAt: new Date(
          Math.floor(ends.getTime() / 1000) * 1000,
        ).toISOString(),
        reason: parsed.data.reason,
      },
      keys: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
      step: 0,
      rewardId: null,
      startsAt: null,
    };
    setStarted(true);
    void run();
  }

  const locked = pending || started;
  return (
    <form
      className="catalog-publication tasks-filter"
      onSubmit={submit}
      aria-labelledby={`${id}-heading`}
      aria-busy={pending}
    >
      <h4 id={`${id}-heading`}>Новое поощрение</h4>
      <p className="notification-note">
        Участники увидят его в разделе «Поощрения» примерно через минуту после
        сохранения.
      </p>
      <label>
        <span>Название</span>
        <input
          value={title}
          maxLength={120}
          required
          disabled={locked}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="catalog-publication-field">
        <label htmlFor={`${id}-conditions`}>Что получит участник</label>
        <textarea
          id={`${id}-conditions`}
          rows={3}
          maxLength={2000}
          required
          disabled={locked}
          value={conditions}
          onChange={(event) => setConditions(event.target.value)}
        />
      </div>
      <label>
        <span>Цена в баллах</span>
        <input
          inputMode="numeric"
          required
          disabled={locked}
          value={price}
          onChange={(event) => setPrice(event.target.value.trim())}
        />
      </label>
      <label>
        <span>Сколько штук можно получить</span>
        <input
          inputMode="numeric"
          required={!unlimited}
          disabled={locked || unlimited}
          value={capacity}
          onChange={(event) => setCapacity(event.target.value.trim())}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={unlimited}
          disabled={locked}
          onChange={(event) => setUnlimited(event.target.checked)}
        />
        <span>Без лимита</span>
      </label>
      <label>
        <span>Доступно до</span>
        <input
          type="date"
          required
          disabled={locked}
          value={until}
          onChange={(event) => setUntil(event.target.value)}
        />
      </label>
      {until && !started ? (
        <p className="notification-note">
          Заявки принимаются до конца дня {dateText(`${until}T12:00:00`)}.
        </p>
      ) : null}
      {title.trim() ? (
        <div className="reward-preview" aria-label="Так увидят участники">
          <RewardBadge title={title} />
          <div>
            <strong>{title.trim()}</strong>
            <span>
              {/^[1-9]\d*$/.test(price) ? `${price} баллов` : "Цена не задана"}
              {unlimited
                ? " · без лимита"
                : /^[1-9]\d*$/.test(capacity)
                  ? ` · ${capacity} шт.`
                  : ""}
            </span>
          </div>
        </div>
      ) : null}
      <button
        type="submit"
        className="tasks-action"
        disabled={pending || blocked}
      >
        {pending ? "Сохраняем…" : started ? "Повторить" : "Добавить поощрение"}
      </button>
      <button
        type="button"
        className="tasks-action"
        disabled={pending}
        onClick={() => {
          if (confirmLeave()) onClose();
        }}
      >
        Закрыть форму
      </button>
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
    </form>
  );
}
