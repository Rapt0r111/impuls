"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  catalogCreationRequestSchema,
  catalogCreationResponseSchema,
  type CatalogCreationRequest,
} from "@impuls/contracts";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { CatalogTerms } from "./catalog-terms";

export function CatalogCreate({
  scope,
  onClose,
  onPublished,
  onDenied,
}: {
  scope: string;
  onClose(): void;
  onPublished(): void;
  onDenied(): void;
}) {
  const { csrfToken, reportDirty, confirmLeave, loseAccess } =
    useAuthorizedSession();
  const id = useId();
  const [title, setTitle] = useState(""),
    [conditions, setConditions] = useState(""),
    [price, setPrice] = useState(""),
    [seconds, setSeconds] = useState(""),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<CatalogCreationRequest | null>(null),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [blocked, setBlocked] = useState(false);
  const intent = useRef<{
      key: string;
      body: CatalogCreationRequest;
    } | null>(null),
    running = useRef(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const dirty = Boolean(
    preview || reason || title || conditions || price || seconds,
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
  const close = () => {
    if (confirmLeave()) onClose();
  };
  async function send() {
    if (running.current || blocked || !preview) return;
    intent.current ??= { key: crypto.randomUUID(), body: preview };
    setSubmitted(true);
    running.current = true;
    setPending(true);
    setStatus("Создаём позицию…");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/v1/admin/rewards", {
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
      if (response.status === 409) {
        setBlocked(true);
        setStatus(
          "Ключ запроса уже использован. Закройте форму и обновите каталог перед новым созданием.",
        );
        return;
      }
      if (
        response.status === 400 ||
        response.status === 413 ||
        response.status === 422
      ) {
        setBlocked(true);
        setStatus(
          "Создание отклонено. Закройте форму, обновите каталог и проверьте поля.",
        );
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      const saved = catalogCreationResponseSchema.parse(await response.json());
      if (!alive.current) return;
      if (
        saved.scope !== scope ||
        saved.creation.initial.title !== preview.title ||
        saved.creation.initial.conditions !== preview.conditions ||
        saved.creation.initial.price !== preview.price ||
        saved.creation.initial.reservationSeconds !== preview.reservationSeconds
      )
        throw new Error("unconfirmed");
      reportDirty(false);
      onPublished();
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Поля сохранены. Повторите тот же запрос, чтобы получить подтверждение сервера.",
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
    const value = catalogCreationRequestSchema.safeParse({
      scope,
      title,
      conditions,
      price: /^[1-9]\d*$/.test(price) ? Number(price) : NaN,
      reservationSeconds:
        seconds === ""
          ? null
          : /^[1-9]\d*$/.test(seconds)
            ? Number(seconds)
            : NaN,
      reason,
    });
    if (!value.success) {
      setStatus(
        "Проверьте поля: цена — целое число от 1 до 1 000 000, срок — от 1 до 2 592 000 секунд либо пустой, основание обязательно.",
      );
      return;
    }
    setPreview(value.data);
    setStatus("");
  }
  return (
    <form
      className="catalog-publication tasks-filter"
      onSubmit={review}
      aria-labelledby={`${id}-heading`}
      aria-busy={pending}
    >
      <h4 id={`${id}-heading`}>Новая позиция косметики</h4>
      <p className="notification-note">
        Позиция будет выключена, без квоты. Чтобы открыть новые заявки, отдельно
        опубликуйте включённые условия и период квоты.
      </p>
      {preview ? (
        <>
          <CatalogTerms
            value={{
              ...preview,
              id: scope,
              version: 1,
              enabled: false,
              effectiveFrom: "",
            }}
            history
            pendingEffective
            label="Проверьте перед созданием"
          />
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
              ? "Создаём…"
              : submitted
                ? "Повторить тот же запрос"
                : "Подтвердить создание"}
          </button>
        </>
      ) : (
        <>
          <label>
            <span>Название</span>
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-conditions`}>Условия</label>
            <textarea
              id={`${id}-conditions`}
              required
              maxLength={2000}
              rows={5}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />
          </div>
          <label>
            <span>Цена в баллах</span>
            <input
              required
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label>
            <span>Срок резерва, секунды</span>
            <input
              inputMode="numeric"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              aria-describedby={`${id}-expiry`}
            />
          </label>
          <p id={`${id}-expiry`} className="notification-note">
            Пустое поле — без срока резерва. Истечение требует отдельной
            операции. Максимум 2 592 000 секунд (30 суток).
          </p>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Основание создания</label>
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
            Проверить позицию
          </button>
        </>
      )}
      {status ? <p role={blocked ? "alert" : "status"}>{status}</p> : null}
      <button type="button" className="tasks-action" onClick={close}>
        Закрыть форму
      </button>
    </form>
  );
}
