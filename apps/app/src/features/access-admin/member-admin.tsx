"use client";
import {
  memberChangeResponseSchema,
  type AccessListResponse,
} from "@impuls/contracts";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

// Outside the component: the clock is read only when the form is submitted.
const inFuture = (date: Date) => date.getTime() > Date.now();

type Change =
  | {
      path: "admissions";
      summary: string;
      body: {
        scope: string;
        telegramId: number;
        displayName: string;
        validUntil: string | null;
        reason: string;
      };
    }
  | {
      path: "removals";
      summary: string;
      body: {
        scope: string;
        membershipId: string;
        expectedVersion: number;
        reason: string;
      };
    };

// Admission and removal of participants for one area. The Telegram ID lives only in this form
// and in the request; it is never stored in the browser or shown again.
export function MemberAdmin({
  scope,
  data,
  onDirty,
  onChanged,
  onUnavailable,
}: {
  scope: string;
  data: AccessListResponse;
  onDirty(dirty: boolean): void;
  onChanged(): void;
  onUnavailable(): void;
}) {
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const id = useId();
  const [mode, setMode] = useState<"admit" | "remove">("admit");
  const [telegramId, setTelegramId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [until, setUntil] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Change | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const intent = useRef<{ key: string; change: Change } | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const dirty = Boolean(
    telegramId || displayName || until || membershipId || reason || preview,
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const removable = data.members.filter((m) => !m.isSelf);
  const reset = () => {
    setPreview(null);
    setTelegramId("");
    setDisplayName("");
    setUntil("");
    setMembershipId("");
    setReason("");
    setSubmitted(false);
    setBlocked(false);
    intent.current = null;
  };
  function stage(change: Change) {
    intent.current = null;
    setPreview(change);
    setStatus("");
  }
  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= { key: crypto.randomUUID(), change: preview };
    const { key, change } = intent.current;
    setSubmitted(true);
    running.current = true;
    setPending(true);
    setStatus("Сохраняем изменение…");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`/api/v1/admin/members/${change.path}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(change.body),
      });
      if (!alive.current) return;
      if ([401, 403].includes(response.status)) {
        loseAccess(response.status);
        return;
      }
      if (response.status === 404) {
        setBlocked(true);
        setStatus("Управление составом недоступно.");
        onUnavailable();
        return;
      }
      if (response.status === 429) {
        setStatus(mutationLimitMessage(response));
        return;
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        setBlocked(true);
        setStatus(
          "Изменение отклонено: состав уже изменился, участник уже допущен, срок неверен или участника нельзя изменить. Закройте форму и обновите список.",
        );
        return;
      }
      if (!response.ok) throw Error("unconfirmed");
      const saved = memberChangeResponseSchema.parse(await response.json());
      if (!alive.current) return;
      if (
        saved.scope !== scope ||
        saved.kind !== (change.path === "admissions" ? "admit" : "remove") ||
        (change.path === "removals" &&
          saved.member.membershipId !== change.body.membershipId)
      )
        throw Error("unconfirmed");
      onDirty(false);
      reset();
      onChanged();
      setStatus(
        saved.kind === "admit"
          ? "Участник допущен."
          : saved.userDeactivated
            ? "Допуск отозван. Сессии участника закрыты."
            : "Участник исключён.",
      );
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Основание сохранено. Повторите тот же запрос, чтобы получить подтверждение сервера.",
        );
    } finally {
      clearTimeout(timeout);
      running.current = false;
      if (alive.current) setPending(false);
    }
  }
  function submitAdmission(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(telegramId);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      setStatus("Telegram ID — положительное целое число.");
      return;
    }
    const validUntil = until ? new Date(until) : null;
    if (validUntil && !inFuture(validUntil)) {
      setStatus("Срок допуска должен быть в будущем.");
      return;
    }
    stage({
      path: "admissions",
      summary: `Допустить «${displayName.trim()}» (Telegram ID ${numeric})${validUntil ? ` до ${dateTime.format(validUntil)} МСК` : " без срока"}.`,
      body: {
        scope,
        telegramId: numeric,
        displayName: displayName.trim(),
        validUntil: validUntil ? validUntil.toISOString() : null,
        reason: reason.trim(),
      },
    });
  }
  const member = removable.find((m) => m.membershipId === membershipId);
  return (
    <section
      className="catalog-publication tasks-filter"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`}>Участники</h3>
      <p className="notification-note">
        Допуск и отзыв участников. Свой допуск и допуск администраторов здесь
        изменить нельзя. Журнал изменений неизменяем.
      </p>
      {!preview ? (
        <div role="group" aria-label="Действие над составом">
          {(
            [
              ["admit", "Допустить"],
              ["remove", "Отозвать допуск"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="tasks-action"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setReason("");
                setStatus("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {preview ? (
        <div className="catalog-publication tasks-filter">
          <h4>Проверьте изменение</h4>
          <p className="admin-catalog-conditions">{preview.summary}</p>
          <p className="admin-catalog-conditions">
            Основание: {preview.body.reason}
          </p>
          {preview.path === "removals" ? (
            <p className="notification-note">
              Права участника будут отозваны, допуск прекратится, а его сессии
              закроются.
            </p>
          ) : null}
          {!submitted ? (
            <button
              type="button"
              className="tasks-action"
              onClick={() => setPreview(null)}
            >
              Вернуться к форме
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
              : submitted
                ? "Повторить тот же запрос"
                : "Подтвердить изменение"}
          </button>
        </div>
      ) : mode === "admit" ? (
        <form
          className="catalog-publication tasks-filter"
          aria-labelledby={`${id}-admit`}
          onSubmit={submitAdmission}
        >
          <h4 id={`${id}-admit`}>Допустить участника</h4>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-tg`}>Telegram ID</label>
            <input
              id={`${id}-tg`}
              required
              inputMode="numeric"
              pattern="[0-9]{1,16}"
              autoComplete="off"
              value={telegramId}
              onChange={(event) => setTelegramId(event.target.value.trim())}
            />
          </div>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-name`}>Имя или псевдоним</label>
            <input
              id={`${id}-name`}
              required
              maxLength={80}
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-until`}>Допуск до (необязательно)</label>
            <input
              id={`${id}-until`}
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Основание допуска</label>
            <textarea
              id={`${id}-reason`}
              required
              maxLength={500}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="tasks-action"
            disabled={!telegramId || !displayName.trim() || !reason.trim()}
          >
            Проверить допуск
          </button>
        </form>
      ) : (
        <form
          className="catalog-publication tasks-filter"
          aria-labelledby={`${id}-remove`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!member) return;
            stage({
              path: "removals",
              summary: `Отозвать допуск у ${member.displayName}.`,
              body: {
                scope,
                membershipId: member.membershipId,
                expectedVersion: member.membershipVersion,
                reason: reason.trim(),
              },
            });
          }}
        >
          <h4 id={`${id}-remove`}>Отозвать допуск</h4>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-member`}>Участник</label>
            <select
              id={`${id}-member`}
              required
              value={membershipId}
              onChange={(event) => setMembershipId(event.target.value)}
            >
              <option value="">Выберите участника</option>
              {removable.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-rr`}>Основание отзыва</label>
            <textarea
              id={`${id}-rr`}
              required
              maxLength={500}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="tasks-action"
            disabled={!member || !reason.trim()}
          >
            Проверить отзыв
          </button>
        </form>
      )}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
    </section>
  );
}
