"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  catalogCancellationRequestSchema,
  catalogCancellationResponseSchema,
  type AdminCatalogResponse,
  type CatalogCancellationRequest,
} from "@impuls/contracts";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import { CatalogTerms } from "./catalog-terms";

export function CatalogCancel({
  scope,
  rewardId,
  scheduled,
  onClose,
  onCancelled,
  onDenied,
}: {
  scope: string;
  rewardId: string;
  scheduled: NonNullable<AdminCatalogResponse["items"][number]["scheduled"]>;
  onClose(): void;
  onCancelled(): void;
  onDenied(): void;
}) {
  const { csrfToken, reportDirty, confirmLeave, loseAccess } =
    useAuthorizedSession();
  const id = useId(),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<CatalogCancellationRequest | null>(null),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [blocked, setBlocked] = useState(false);
  const intent = useRef<{
      key: string;
      body: CatalogCancellationRequest;
    } | null>(null),
    running = useRef(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const dirty = Boolean(reason || preview);
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
    setStatus("Отменяем будущие условия…");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(
        `/api/v1/admin/rewards/${rewardId}/scheduled-versions/cancel`,
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
      if ([401, 403].includes(response.status)) {
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
          "Отмена отклонена: условия изменились или уже вступили в силу. Закройте форму и обновите каталог.",
        );
        return;
      }
      if (!response.ok) throw Error("unconfirmed");
      const saved = catalogCancellationResponseSchema.parse(
        await response.json(),
      );
      if (!alive.current) return;
      if (
        saved.scope !== scope ||
        saved.cancellation.rewardId !== rewardId ||
        saved.cancellation.cancelled.id !== scheduled.id ||
        saved.cancellation.cancelled.version !== scheduled.version ||
        saved.cancellation.cancelled.title !== scheduled.title ||
        saved.cancellation.cancelled.conditions !== scheduled.conditions ||
        saved.cancellation.cancelled.price !== scheduled.price ||
        saved.cancellation.cancelled.enabled !== scheduled.enabled ||
        saved.cancellation.cancelled.reservationSeconds !==
          scheduled.reservationSeconds ||
        Date.parse(saved.cancellation.cancelled.effectiveFrom) !==
          Date.parse(scheduled.effectiveFrom)
      )
        throw Error("unconfirmed");
      reportDirty(false);
      onCancelled();
    } catch {
      if (alive.current)
        setStatus(
          "Результат не подтверждён. Причина сохранена. Повторите тот же запрос, чтобы получить подтверждение сервера.",
        );
    } finally {
      clearTimeout(timeout);
      running.current = false;
      controller.current = null;
      if (alive.current) setPending(false);
    }
  }
  return (
    <form
      className="catalog-publication tasks-filter"
      aria-labelledby={`${id}-heading`}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = catalogCancellationRequestSchema.safeParse({
          scope,
          versionId: scheduled.id,
          expectedVersion: scheduled.version,
          reason,
        });
        if (!parsed.success) {
          setStatus("Укажите основание отмены, не более 2 000 символов.");
          return;
        }
        setPreview(parsed.data);
        setStatus("");
      }}
    >
      <h4 id={`${id}-heading`}>Отмена будущих условий</h4>
      <p className="notification-note">
        Отменить можно только до начала действия. Прежние условия продолжат
        действовать. Квоты и существующие заявки сохранятся.
      </p>
      <CatalogTerms value={scheduled} history label="Версия для отмены" />
      {preview ? (
        <>
          <p className="admin-catalog-conditions">
            Основание: {preview.reason}
          </p>
          {!submitted ? (
            <button
              type="button"
              className="tasks-action"
              onClick={() => setPreview(null)}
            >
              Вернуться к причине
            </button>
          ) : null}
          <button
            type="button"
            className="tasks-action"
            disabled={pending || blocked}
            onClick={() => void send()}
          >
            {pending
              ? "Отменяем…"
              : submitted
                ? "Повторить тот же запрос"
                : "Подтвердить отмену"}
          </button>
        </>
      ) : (
        <>
          <div className="catalog-publication-field">
            <label htmlFor={`${id}-reason`}>Основание отмены</label>
            <textarea
              id={`${id}-reason`}
              required
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button type="submit" className="tasks-action">
            Проверить отмену
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
        Закрыть форму
      </button>
    </form>
  );
}
