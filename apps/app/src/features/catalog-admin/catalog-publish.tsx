"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  catalogPublicationRequestSchema,
  catalogSchedulingRequestSchema,
  catalogPublicationResponseSchema,
  type AdminCatalogResponse,
  type CatalogPublicationRequest,
  type CatalogSchedulingRequest,
} from "@impuls/contracts";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { CatalogTerms } from "./catalog-terms";

export function CatalogPublish({
  scope,
  rewardId,
  current,
  scheduling = false,
  onClose,
  onPublished,
  onDenied,
}: {
  scope: string;
  rewardId: string;
  current: NonNullable<AdminCatalogResponse["items"][number]["current"]>;
  scheduling?: boolean;
  onClose(): void;
  onPublished(): void;
  onDenied(): void;
}) {
  const { csrfToken, reportDirty, confirmLeave, loseAccess } =
    useAuthorizedSession();
  const id = useId();
  const [title, setTitle] = useState(current.title),
    [conditions, setConditions] = useState(current.conditions),
    [price, setPrice] = useState(String(current.price)),
    [enabled, setEnabled] = useState(current.enabled),
    [seconds, setSeconds] = useState(
      current.reservationSeconds === null
        ? ""
        : String(current.reservationSeconds),
    ),
    [reason, setReason] = useState(""),
    [effectiveFrom, setEffectiveFrom] = useState(""),
    [preview, setPreview] = useState<
      CatalogPublicationRequest | CatalogSchedulingRequest | null
    >(null),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [blocked, setBlocked] = useState(false);
  const intent = useRef<{
      key: string;
      body: CatalogPublicationRequest | CatalogSchedulingRequest;
    } | null>(null),
    running = useRef(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const dirty = Boolean(
    preview ||
    reason ||
    effectiveFrom ||
    title !== current.title ||
    conditions !== current.conditions ||
    price !== String(current.price) ||
    enabled !== current.enabled ||
    seconds !==
      (current.reservationSeconds === null
        ? ""
        : String(current.reservationSeconds)),
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
    setStatus("Публикуем условия…");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(
        `/api/v1/admin/rewards/${rewardId}/${scheduling ? "scheduled-versions" : "versions"}`,
        {
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
        },
      );
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
          "Условия или ключ запроса изменились. Закройте форму и обновите каталог перед новой публикацией.",
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
          "Публикация отклонена. Закройте форму и перечитайте условия; проверьте поля и будущие версии.",
        );
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      const saved = catalogPublicationResponseSchema.parse(
        await response.json(),
      );
      if (
        saved.scope !== scope ||
        saved.catalog.rewardId !== rewardId ||
        saved.catalog.previousVersion !== preview.expectedVersion ||
        saved.catalog.published.title !== preview.title ||
        saved.catalog.published.conditions !== preview.conditions ||
        saved.catalog.published.price !== preview.price ||
        saved.catalog.published.enabled !== preview.enabled ||
        saved.catalog.published.reservationSeconds !==
          preview.reservationSeconds ||
        ("effectiveFrom" in preview &&
          Date.parse(saved.catalog.published.effectiveFrom) !==
            Date.parse(preview.effectiveFrom))
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
    const scheduledAt =
      effectiveFrom &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(effectiveFrom)
        ? Date.parse(`${effectiveFrom}Z`)
        : NaN;
    const value = (
      scheduling
        ? catalogSchedulingRequestSchema
        : catalogPublicationRequestSchema
    ).safeParse({
      scope,
      expectedVersion: current.version,
      title,
      conditions,
      price: /^[1-9]\d*$/.test(price) ? Number(price) : NaN,
      enabled,
      reservationSeconds:
        seconds === ""
          ? null
          : /^[1-9]\d*$/.test(seconds)
            ? Number(seconds)
            : NaN,
      reason,
      ...(scheduling
        ? {
            effectiveFrom: Number.isFinite(scheduledAt)
              ? new Date(scheduledAt).toISOString()
              : "",
          }
        : {}),
    });
    if (!value.success) {
      setStatus(
        "Проверьте поля: цена — целое число от 1 до 1 000 000, срок — от 1 до 2 592 000 секунд либо пустой, основание обязательно. Для отложенной публикации укажите дату UTC.",
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
      <h4 id={`${id}-heading`}>
        {scheduling ? "Будущая версия условий" : "Новая версия условий"}
      </h4>
      <p className="notification-note">
        {scheduling
          ? "Новые условия начнут действовать в указанное время. До него действуют прежние условия. Отмена до начала действия требует отдельного права."
          : "Публикация действует сразу для новых заявок."}{" "}
        Существующие заявки сохраняют свои условия. Квоты не изменяются.
      </p>
      {preview ? (
        <>
          <CatalogTerms
            value={{ ...current, ...preview, version: current.version + 1 }}
            history
            pendingVersion
            pendingEffective={!scheduling}
            label="Проверьте перед публикацией"
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
              ? "Публикуем…"
              : submitted
                ? "Повторить тот же запрос"
                : "Подтвердить публикацию"}
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
            Пустое поле — без автоматического истечения. Максимум 2 592 000
            секунд (30 суток).
          </p>
          <label className="catalog-publication-enabled">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Включить для новых заявок</span>
          </label>
          {scheduling ? (
            <>
              <label>
                <span>Начало действия, UTC</span>
                <input
                  type="datetime-local"
                  required
                  step="1"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  aria-describedby={`${id}-schedule`}
                />
              </label>
              <p id={`${id}-schedule`} className="notification-note">
                Укажите время в UTC. Сервер отклонит прошедшую дату.
              </p>
            </>
          ) : null}
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Основание публикации</label>
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
            Проверить изменения
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
