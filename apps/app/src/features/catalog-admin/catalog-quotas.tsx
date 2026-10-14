"use client";
import {
  adminCatalogQuotasResponseSchema,
  apiErrorSchema,
  type AdminCatalogQuotasResponse,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { CatalogError, catalogDate } from "./catalog-terms";

async function load(
  scope: string,
  rewardId: string,
  cursor: string,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ scope, limit: "10" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(
    `/api/v1/admin/rewards/${rewardId}/quotas?${params}`,
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
  const data = adminCatalogQuotasResponseSchema.parse(await response.json());
  if (data.scope.id !== scope || data.rewardId !== rewardId)
    throw new Error("Unexpected history identity");
  return data;
}
const labels = {
  current: "Текущий период",
  scheduled: "Будущий период",
  past: "Завершившийся период",
};
export function CatalogQuotas({
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
    queryKey: ["admin-catalog-quotas", scope, rewardId, cursor],
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
              q.queryKey[0] === "admin-catalog-history" ||
              (q.queryKey[0] === "admin-catalog-quotas" &&
                (q.queryKey[1] !== scope ||
                  q.queryKey[2] !== rewardId ||
                  q.queryKey[3] !== cursor)),
          });
          client.setQueriesData(
            { queryKey: ["admin-catalog-history"] },
            () => null,
          );
          client.setQueriesData<AdminCatalogQuotasResponse | null>(
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
      className="notification-errors admin-catalog-quotas"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Все периоды квоты</summary>
      {expanded ? (
        <div aria-busy={query.isFetching}>
          <p className="notification-note">
            От позднего начала периода к раннему. Счётчики и статус показаны на
            момент чтения: обработка старых заявок может изменить резерв и
            использование даже после конца периода. Конец периода сам по себе не
            возвращает резерв.
          </p>
          <button
            type="button"
            className="tasks-action"
            disabled={query.isFetching}
            onClick={refresh}
          >
            Обновить периоды
          </button>
          {query.isPending ? (
            <p role="status">Загружаем периоды квоты…</p>
          ) : null}
          {query.isError ? (
            <p role="alert">
              {error instanceof CatalogError && error.status === 404
                ? "Периоды квоты недоступны."
                : error instanceof CatalogError && error.status === 400
                  ? "Страница периодов изменилась. Обновите периоды с первой страницы."
                  : "Не удалось загрузить периоды. Нажмите «Обновить периоды»."}
            </p>
          ) : null}
          {data ? (
            <>
              <p className="notification-asof">
                Прочитано{" "}
                <time dateTime={data.updatedAt}>
                  {catalogDate(data.updatedAt)}
                </time>{" "}
                МСК.{" "}
                {query.isError
                  ? "Показаны ранее подтверждённые счётчики."
                  : "Счётчики перечитываются вручную."}
              </p>
              {!data.items.length ? (
                <p>На этой странице нет сохранённых периодов квоты.</p>
              ) : (
                <ol className="admin-catalog-periods">
                  {data.items.map((period) => (
                    <li key={period.id} className="admin-catalog-quota">
                      <h4>{labels[period.state]}</h4>
                      <p className="notification-note">
                        <time dateTime={period.startsAt}>
                          {catalogDate(period.startsAt)}
                        </time>
                        {" — "}
                        <time dateTime={period.endsAt}>
                          {catalogDate(period.endsAt)}
                        </time>{" "}
                        МСК. Начало включительно, конец исключительно.
                      </p>
                      <dl className="notification-counts">
                        {(
                          [
                            ["Всего мест", period.capacity],
                            ["В резерве", period.reserved],
                            ["Использовано", period.used],
                            ["Незанятые места", period.available],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value.toLocaleString("ru-RU")}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="notification-note">
                        Версия счётчиков {period.version}. Незанятые места этого
                        периода не подтверждают возможность новой заявки.
                      </p>
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
                  Следующие периоды
                </button>
              ) : null}
              {cursor ? (
                <p className="notification-note">
                  «Обновить периоды» возвращает первую страницу. Периоды и
                  счётчики могут измениться между чтениями.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
