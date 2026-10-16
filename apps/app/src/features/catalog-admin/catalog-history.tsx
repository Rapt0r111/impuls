"use client";
import {
  adminCatalogHistoryResponseSchema,
  apiErrorSchema,
  type AdminCatalogHistoryResponse,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { CatalogError, CatalogTerms, catalogDate } from "./catalog-terms";

async function load(
  scope: string,
  rewardId: string,
  cursor: string,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ scope, limit: "10" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(
    `/api/v1/admin/rewards/${rewardId}/versions?${params}`,
    {
      signal,
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new CatalogError(
      response.status,
      error.success ? error.data.code : "UNAVAILABLE",
    );
  }
  const data = adminCatalogHistoryResponseSchema.parse(await response.json());
  if (data.scope.id !== scope || data.rewardId !== rewardId)
    throw new Error("Unexpected history identity");
  return data;
}
const labels = {
  current: "Действующие условия",
  scheduled: "Будущие условия",
  superseded: "Заменённые условия",
  cancelled: "Отменённые будущие условия",
};
export function CatalogHistory({
  scope,
  rewardId,
}: {
  scope: string;
  rewardId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [cursor, setCursor] = useState("");
  const { loseAccess } = useAuthorizedSession();
  const client = useQueryClient();
  useTelegramBack(
    expanded,
    () => {
      if (disclosure.current) disclosure.current.open = false;
      setExpanded(false);
    },
    20,
  );
  const query = useQuery({
    queryKey: ["admin-catalog-history", scope, rewardId, cursor],
    enabled: expanded,
    queryFn: async ({ signal }) => {
      try {
        return await load(scope, rewardId, cursor, signal);
      } catch (error) {
        if (
          error instanceof CatalogError &&
          [401, 403, 404].includes(error.status)
        ) {
          await client.cancelQueries({
            predicate: (q) =>
              q.queryKey[0] === "admin-catalog-quotas" ||
              (q.queryKey[0] === "admin-catalog-history" &&
                (q.queryKey[1] !== scope ||
                  q.queryKey[2] !== rewardId ||
                  q.queryKey[3] !== cursor)),
          });
          client.setQueriesData<AdminCatalogHistoryResponse | null>(
            { queryKey: ["admin-catalog-history"] },
            () => null,
          );
          client.setQueriesData(
            { queryKey: ["admin-catalog-quotas"] },
            () => null,
          );
        }
        throw error;
      }
    },
    retry: false,
    networkMode: "always",
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchOnReconnect: false,
  });
  const error = query.error;
  const denied =
    error instanceof CatalogError &&
    [400, 401, 403, 404].includes(error.status);
  const data = denied ? null : query.data;
  useEffect(() => {
    if (error instanceof CatalogError && [401, 403].includes(error.status))
      loseAccess(error.status);
  }, [error, loseAccess]);
  const refresh = () => {
    if (cursor) setCursor("");
    else void query.refetch();
  };
  return (
    <details
      ref={disclosure}
      className="notification-errors admin-catalog-history"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>История всех версий</summary>
      {expanded ? (
        <div aria-busy={query.isFetching}>
          <p className="notification-note">
            От поздней даты начала действия к ранней; при равной дате — от
            большей версии к меньшей. Статус рассчитан на момент чтения. Квота
            показана отдельно и к этой истории не относится.
          </p>
          <button
            type="button"
            className="tasks-action"
            disabled={query.isFetching}
            onClick={refresh}
          >
            Обновить историю
          </button>
          {query.isPending ? (
            <p role="status">Загружаем версии условий…</p>
          ) : null}
          {query.isError ? (
            <p role="alert">
              {error instanceof CatalogError && error.status === 404
                ? "История позиции недоступна."
                : error instanceof CatalogError && error.status === 400
                  ? "Страница истории изменилась. Обновите историю с первой страницы."
                  : "Не удалось загрузить версии. Нажмите «Обновить историю»."}
            </p>
          ) : null}
          {data ? (
            <>
              <p className="notification-asof">
                Прочитано{" "}
                <time dateTime={data.updatedAt}>
                  {catalogDate(data.updatedAt)}
                </time>{" "}
                {query.isError
                  ? "Показаны ранее подтверждённые версии."
                  : "История перечитывается вручную."}
              </p>
              {!data.items.length ? (
                <p>На этой странице больше нет сохранённых версий.</p>
              ) : (
                <ol className="admin-catalog-versions">
                  {data.items.map((version) => (
                    <li key={version.id}>
                      <CatalogTerms
                        value={version}
                        label={labels[version.state]}
                        history
                      />
                    </li>
                  ))}
                </ol>
              )}
              {data.nextCursor ? (
                <button
                  type="button"
                  className="tasks-action"
                  disabled={query.isFetching || query.isError}
                  onClick={() => setCursor(data.nextCursor!)}
                >
                  Следующие версии
                </button>
              ) : null}
              {cursor ? (
                <p className="notification-note">
                  «Обновить историю» возвращает первую страницу. Новые условия
                  могут появиться между чтениями.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
