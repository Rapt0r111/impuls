"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  quotaPublicationRequestSchema,
  quotaPublicationResponseSchema,
  type QuotaPublicationRequest,
} from "@impuls/contracts";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
const utc = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
    ? new Date(`${value}Z`).toISOString()
    : "";
const readable = (value: string) =>
  value.replace("T", " ").replace(".000Z", " UTC");
export function QuotaPublish({
  scope,
  rewardId,
  onClose,
  onPublished,
  onDenied,
}: {
  scope: string;
  rewardId: string;
  onClose(): void;
  onPublished(): void;
  onDenied(): void;
}) {
  const { csrfToken, reportDirty, confirmLeave, loseAccess } =
    useAuthorizedSession();
  const id = useId();
  const [start, setStart] = useState(""),
    [startTime, setStartTime] = useState(""),
    [end, setEnd] = useState(""),
    [endTime, setEndTime] = useState(""),
    [capacity, setCapacity] = useState(""),
    [reason, setReason] = useState("");
  const [preview, setPreview] = useState<QuotaPublicationRequest | null>(null),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [blocked, setBlocked] = useState(false);
  const intent = useRef<{ key: string; body: QuotaPublicationRequest } | null>(
      null,
    ),
    running = useRef(false),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  const dirty = Boolean(
    start || startTime || end || endTime || capacity || reason || preview,
  );
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(false);
  }, [dirty, reportDirty]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= { key: crypto.randomUUID(), body: preview };
    setSubmitted(true);
    running.current = true;
    setPending(true);
    setStatus("Публикуем период…");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`/api/v1/admin/rewards/${rewardId}/quotas`, {
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
      if (response.status === 404) {
        onDenied();
        return;
      }
      if (response.status === 429) {
        setStatus(mutationLimitMessage(response));
        return;
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        setBlocked(true);
        setStatus(
          response.status === 409
            ? "Периоды пересекаются либо ключ использован. Закройте форму и перечитайте периоды квоты перед новой публикацией."
            : "Публикация отклонена. Закройте форму и проверьте будущие даты UTC, число мест и основание.",
        );
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      const saved = quotaPublicationResponseSchema.parse(await response.json());
      if (!alive.current) return;
      if (
        saved.scope !== scope ||
        saved.quota.rewardId !== rewardId ||
        saved.quota.startsAt !== preview.startsAt ||
        saved.quota.endsAt !== preview.endsAt ||
        saved.quota.capacity !== preview.capacity
      )
        throw new Error("unconfirmed");
      reportDirty(false);
      onPublished();
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Поля сохранены. Повторите тот же запрос для подтверждения сервера.",
        );
    } finally {
      clearTimeout(timeout);
      running.current = false;
      controller.current = null;
      if (alive.current) setPending(false);
    }
  }
  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let startsAt = "",
      endsAt = "";
    try {
      startsAt = utc(`${start}T${startTime}`);
      endsAt = utc(`${end}T${endTime}`);
    } catch {
      /* Invalid native date. */
    }
    const parsed = quotaPublicationRequestSchema.safeParse({
      scope,
      startsAt,
      endsAt,
      capacity: /^(0|[1-9]\d*)$/.test(capacity) ? Number(capacity) : NaN,
      reason,
    });
    if (!parsed.success) {
      setStatus(
        "Укажите начало и более поздний конец в UTC, целое число мест от 0 до 1 000 000 и основание.",
      );
      return;
    }
    setPreview(parsed.data);
    setStatus("");
  }
  return (
    <form
      className="catalog-publication tasks-filter"
      onSubmit={review}
      aria-labelledby={`${id}-heading`}
      aria-busy={pending}
    >
      <h4 id={`${id}-heading`}>Новый период квоты</h4>
      <p className="notification-note">
        Только будущий период без пересечения с существующими. Старые резервы
        остаются в своих периодах. Новые места не гарантируют одобрения заявки.
      </p>
      {preview ? (
        <>
          <h5>Проверьте перед публикацией</h5>
          <p>
            Начало: {readable(preview.startsAt)}
            <br />
            Конец: {readable(preview.endsAt)} (не включается).
          </p>
          <p>
            Всего мест: {preview.capacity}. В новом периоде резервов и выдач
            пока нет.
          </p>
          <p className="admin-catalog-conditions">
            Основание: {preview.reason}
          </p>
          {!submitted ? (
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
              ? "Публикуем…"
              : submitted
                ? "Повторить тот же запрос"
                : "Подтвердить период"}
          </button>
        </>
      ) : (
        <>
          <label>
            <span>Дата начала, UTC</span>
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-describedby={`${id}-utc`}
            />
          </label>
          <label>
            <span>Время начала, UTC</span>
            <input
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              aria-describedby={`${id}-utc`}
            />
          </label>
          <label>
            <span>Дата конца, UTC</span>
            <input
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-describedby={`${id}-utc`}
            />
          </label>
          <label>
            <span>Время конца, UTC</span>
            <input
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              aria-describedby={`${id}-utc`}
            />
          </label>
          <p id={`${id}-utc`} className="notification-note">
            Вводите время в UTC. Начало должно оставаться в будущем в момент
            проверки сервером. Конец не входит в период.
          </p>
          <label>
            <span>Всего мест</span>
            <input
              inputMode="numeric"
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </label>
          <p className="notification-note">
            От 0 до 1 000 000. Ноль мест — резервирование в этом периоде
            недоступно.
          </p>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Основание публикации периода</label>
            <textarea
              id={`${id}-reason`}
              required
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button type="submit" className="tasks-action">
            Проверить период
          </button>
        </>
      )}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
      <button
        type="button"
        className="tasks-action"
        onClick={() => {
          if (confirmLeave()) onClose();
        }}
      >
        Закрыть форму периода
      </button>
    </form>
  );
}
