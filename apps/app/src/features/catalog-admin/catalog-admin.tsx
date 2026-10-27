"use client";
import {
  adminCatalogResponseSchema,
  apiErrorSchema,
  type AdminCatalogResponse,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import "../notifications/notification-status.css";
import "./catalog-admin.css";
import { CatalogHistory } from "./catalog-history";
import { CatalogQuotas } from "./catalog-quotas";
import { CatalogCreate } from "./catalog-create";
import { CatalogCancel } from "./catalog-cancel";
import { CatalogPublish } from "./catalog-publish";
import { QuotaPublish } from "./quota-publish";
import { RewardQuickCreate } from "./reward-quick-create";
import { RewardBadge } from "../rewards/reward-visual";
import { useTelegramBack } from "@/shared/telegram/back-navigation";
import { Select } from "@/shared/ui/select";
import {
  CatalogError,
  CatalogTerms,
  catalogDate as date,
} from "./catalog-terms";
async function load(scope: string, cursor: string, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "20" });
  if (scope) params.set("scope", scope);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/admin/rewards?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new CatalogError(
      response.status,
      parsed.success ? parsed.data.code : "UNAVAILABLE",
    );
  }
  return adminCatalogResponseSchema.parse(await response.json());
}
export function CatalogAdmin() {
  const { loseAccess, confirmLeave } = useAuthorizedSession();
  const client = useQueryClient();
  const [scope, setScope] = useState("");
  const [cursor, setCursor] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useTelegramBack(
    editing !== null,
    () => {
      if (confirmLeave()) setEditing(null);
    },
    60,
  );
  const query = useQuery({
    queryKey: ["admin-catalog", scope, cursor],
    queryFn: async ({ signal }) => {
      try {
        return await load(scope, cursor, signal);
      } catch (error) {
        if (
          error instanceof CatalogError &&
          [401, 403, 404].includes(error.status)
        ) {
          await client.cancelQueries({ queryKey: ["admin-catalog-history"] });
          await client.cancelQueries({ queryKey: ["admin-catalog-quotas"] });
          client.setQueriesData(
            { queryKey: ["admin-catalog-quotas"] },
            () => null,
          );
          client.setQueriesData(
            { queryKey: ["admin-catalog-history"] },
            () => null,
          );
          client.setQueriesData<AdminCatalogResponse | null>(
            { queryKey: ["admin-catalog"] },
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
    [401, 403, 404, 400].includes(error.status);
  useEffect(() => {
    if (error instanceof CatalogError && [401, 403].includes(error.status))
      loseAccess(error.status);
  }, [error, loseAccess]);
  const data = denied ? null : query.data;
  const refresh = () => {
    if (!confirmLeave()) return;
    setEditing(null);
    if (cursor) setCursor("");
    else void query.refetch();
  };
  return (
    <section
      className="tasks-section notification-section admin-catalog-section"
      aria-labelledby="admin-catalog-title"
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <h2 id="admin-catalog-title">Управление каталогом</h2>
        <button
          type="button"
          className="tasks-action"
          aria-label="Обновить каталог управления"
          disabled={query.isFetching}
          onClick={refresh}
        >
          Обновить
        </button>
      </div>
      <p className="notification-intro">
        Поощрения, которые участники могут получить за баллы.
      </p>
      {query.isPending ? (
        <p className="tasks-state" role="status">
          Загружаем конфигурацию каталога…
        </p>
      ) : null}
      {query.isError ? (
        <p className="tasks-state" role="alert">
          {error instanceof CatalogError && error.status === 404
            ? error.code === "ADMIN_CATALOG_DISABLED"
              ? "Просмотр управления каталогом выключен."
              : "Каталог управления недоступен."
            : error instanceof CatalogError && error.status === 400
              ? "Страница изменилась. Обновите каталог с первой страницы."
              : "Не удалось загрузить конфигурацию. Нажмите «Обновить»."}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data ? (
        <>
          {data.scopes.length > 1 ? (
            <label className="tasks-filter notification-scope">
              <span id="admin-catalog-scope-label">Область</span>
              <Select
                labelledBy="admin-catalog-scope-label"
                value={scope || data.scope.id}
                onValueChange={(next) => {
                  if (!confirmLeave()) return;
                  setEditing(null);
                  setNotice("");
                  setScope(next);
                  setCursor("");
                }}
                options={data.scopes.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
              />
            </label>
          ) : null}
          {query.isError ? (
            <p className="notification-asof">
              Показаны данные на {date(data.updatedAt)}.
            </p>
          ) : null}
          {data.canCreate && data.canPublish && data.canPublishQuota ? (
            editing === "quick" ? (
              <RewardQuickCreate
                key={`quick|${data.scope.id}`}
                scope={data.scope.id}
                serverTime={data.updatedAt}
                onClose={() => setEditing(null)}
                onDone={(title) => {
                  setEditing(null);
                  setNotice(
                    `Поощрение «${title}» добавлено. Участники увидят его примерно через минуту.`,
                  );
                  void client.invalidateQueries({ queryKey: ["admin-audit"] });
                  void client.invalidateQueries({
                    queryKey: ["reward-catalog"],
                  });
                  if (cursor) setCursor("");
                  else void query.refetch();
                }}
                onDenied={() => {
                  setEditing(null);
                  setNotice("Добавление недоступно. Обновите каталог.");
                  void query.refetch();
                }}
              />
            ) : (
              <button
                type="button"
                className="tasks-action admin-catalog-add"
                disabled={query.isFetching || query.isError}
                onClick={() => {
                  if (confirmLeave()) {
                    setEditing("quick");
                    setNotice("");
                  }
                }}
              >
                Добавить поощрение
              </button>
            )
          ) : data.canCreate ? (
            editing === "create" ? (
              <CatalogCreate
                key={`create|${data.scope.id}`}
                scope={data.scope.id}
                onClose={() => setEditing(null)}
                onPublished={() => {
                  setEditing(null);
                  setNotice(
                    "Позиция создана и выключена. Квота не задана. Перечитываем каталог.",
                  );
                  void client.invalidateQueries({ queryKey: ["admin-audit"] });
                  if (cursor) setCursor("");
                  else void query.refetch();
                }}
                onDenied={() => {
                  setEditing(null);
                  for (const key of [
                    "admin-catalog",
                    "admin-catalog-history",
                    "admin-catalog-quotas",
                  ]) {
                    void client.cancelQueries({ queryKey: [key] });
                    client.setQueriesData({ queryKey: [key] }, () => null);
                  }
                  setNotice("Создание недоступно. Обновите каталог.");
                }}
              />
            ) : (
              <button
                type="button"
                className="tasks-action"
                disabled={query.isFetching || query.isError}
                onClick={() => {
                  if (confirmLeave()) {
                    setEditing("create");
                    setNotice("");
                  }
                }}
              >
                Создать позицию косметики
              </button>
            )
          ) : null}
          {!data.items.length ? (
            <p className="tasks-empty">Поощрений пока нет.</p>
          ) : (
            <ul className="admin-catalog-items">
              {data.items.map((item) => (
                <li key={item.rewardId}>
                  <div className="admin-reward-head">
                    <RewardBadge title={item.current?.title ?? ""} />
                    <div>
                      <p className="admin-reward-title">
                        {item.current?.title ?? "Без названия"}
                      </p>
                      <p className="admin-reward-sub">
                        {item.current ? (
                          <span className="admin-catalog-price">
                            {item.current.price.toLocaleString("ru-RU")} баллов
                          </span>
                        ) : null}
                        <span>
                          {!item.current?.enabled
                            ? "Выключено"
                            : !item.quota
                              ? "Сейчас недоступно"
                              : item.quota.available === 0
                                ? "Закончились"
                                : "Доступно участникам"}
                        </span>
                      </p>
                    </div>
                  </div>
                  {item.quota ? (
                    <div className="admin-reward-places">
                      {item.quota.capacity === null ? null : (
                        <progress
                          max={item.quota.capacity}
                          value={item.quota.used + item.quota.reserved}
                          aria-label={`Занято ${item.quota.used + item.quota.reserved} из ${item.quota.capacity}`}
                        />
                      )}
                      <span>
                        Выдано {item.quota.used} · ждут решения{" "}
                        {item.quota.reserved} ·{" "}
                        {item.quota.capacity === null
                          ? "без лимита"
                          : `свободно ${item.quota.available} из ${item.quota.capacity}`}
                      </span>
                    </div>
                  ) : null}
                  <details className="admin-catalog-more">
                    <summary>Подробнее и изменить</summary>
                    {item.current ? (
                      <CatalogTerms value={item.current} />
                    ) : (
                      <p>Действующие условия ещё не заданы.</p>
                    )}
                    {item.scheduled ? (
                      <details className="notification-errors">
                        <summary>
                          Будущая версия {item.scheduled.version}
                        </summary>
                        <CatalogTerms
                          value={item.scheduled}
                          label="Ближайшие будущие условия"
                        />
                      </details>
                    ) : null}
                    {item.scheduled && data.canCancelSchedule ? (
                      editing === `cancel:${item.rewardId}` ? (
                        <CatalogCancel
                          key={`cancel|${data.scope.id}|${item.scheduled.id}`}
                          scope={data.scope.id}
                          rewardId={item.rewardId}
                          scheduled={item.scheduled}
                          onClose={() => setEditing(null)}
                          onCancelled={() => {
                            setEditing(null);
                            setNotice(
                              "Отмена подтверждена сервером. Перечитываем каталог.",
                            );
                            void client.invalidateQueries({
                              queryKey: ["admin-catalog-history"],
                            });
                            void client.invalidateQueries({
                              queryKey: ["admin-audit"],
                            });
                            void client.invalidateQueries({
                              queryKey: ["reward-catalog"],
                            });
                            void query.refetch();
                          }}
                          onDenied={() => {
                            setEditing(null);
                            for (const key of [
                              "admin-catalog",
                              "admin-catalog-history",
                              "admin-catalog-quotas",
                            ]) {
                              void client.cancelQueries({ queryKey: [key] });
                              client.setQueriesData(
                                { queryKey: [key] },
                                () => null,
                              );
                            }
                            setNotice("Отмена недоступна. Обновите каталог.");
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="tasks-action"
                          disabled={query.isFetching || query.isError}
                          onClick={() => {
                            if (confirmLeave()) {
                              setEditing(`cancel:${item.rewardId}`);
                              setNotice("");
                            }
                          }}
                        >
                          Отменить будущие условия
                        </button>
                      )
                    ) : null}
                    {item.quota ? (
                      <div className="admin-catalog-quota">
                        <h4>Текущая квота</h4>
                        <p className="notification-note">
                          {date(item.quota.startsAt)} —{" "}
                          {date(item.quota.endsAt)}
                        </p>
                        <dl className="notification-counts">
                          {(
                            [
                              ["Всего мест", item.quota.capacity],
                              ["В резерве", item.quota.reserved],
                              ["Использовано", item.quota.used],
                              ["Осталось", item.quota.available],
                            ] as const
                          ).map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>
                                {value === null
                                  ? "Без лимита"
                                  : value.toLocaleString("ru-RU")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : (
                      <p className="notification-note">
                        Сейчас участникам недоступно: период с местами ещё не
                        начался или уже закончился.
                      </p>
                    )}
                    {(data.canPublish || data.canSchedule) && item.current ? (
                      item.scheduled ? (
                        <p className="notification-note">
                          Есть будущие условия. Новая публикация для этой
                          позиции недоступна до их начала действия или
                          подтверждённой отмены.
                        </p>
                      ) : editing === item.rewardId ||
                        editing === `schedule:${item.rewardId}` ? (
                        <CatalogPublish
                          key={`publish|${data.scope.id}|${editing}`}
                          scheduling={editing === `schedule:${item.rewardId}`}
                          scope={data.scope.id}
                          rewardId={item.rewardId}
                          current={item.current}
                          onClose={() => setEditing(null)}
                          onPublished={() => {
                            setEditing(null);
                            setNotice(
                              "Новая версия подтверждена сервером. Перечитываем каталог.",
                            );
                            void client.invalidateQueries({
                              queryKey: ["admin-catalog-history"],
                            });
                            void client.invalidateQueries({
                              queryKey: ["admin-audit"],
                            });
                            void query.refetch();
                          }}
                          onDenied={() => {
                            setEditing(null);
                            for (const key of [
                              "admin-catalog",
                              "admin-catalog-history",
                              "admin-catalog-quotas",
                            ]) {
                              void client.cancelQueries({ queryKey: [key] });
                              client.setQueriesData(
                                { queryKey: [key] },
                                () => null,
                              );
                            }
                            setNotice(
                              "Публикация недоступна. Обновите каталог.",
                            );
                          }}
                        />
                      ) : (
                        <>
                          {data.canPublish ? (
                            <button
                              type="button"
                              className="tasks-action"
                              disabled={query.isFetching || query.isError}
                              onClick={() => {
                                if (confirmLeave()) {
                                  setEditing(item.rewardId);
                                  setNotice("");
                                }
                              }}
                            >
                              Опубликовать новые условия
                            </button>
                          ) : null}
                          {data.canSchedule ? (
                            <button
                              type="button"
                              className="tasks-action"
                              disabled={query.isFetching || query.isError}
                              onClick={() => {
                                if (confirmLeave()) {
                                  setEditing(`schedule:${item.rewardId}`);
                                  setNotice("");
                                }
                              }}
                            >
                              Запланировать новые условия
                            </button>
                          ) : null}
                        </>
                      )
                    ) : null}
                    <CatalogHistory
                      key={`${data.scope.id}|${item.rewardId}`}
                      scope={data.scope.id}
                      rewardId={item.rewardId}
                    />
                    <CatalogQuotas
                      key={`quotas|${data.scope.id}|${item.rewardId}`}
                      scope={data.scope.id}
                      rewardId={item.rewardId}
                    />
                    {data.canPublishQuota ? (
                      editing === `quota|${item.rewardId}` ? (
                        <QuotaPublish
                          key={`quota-publish|${data.scope.id}|${item.rewardId}`}
                          scope={data.scope.id}
                          rewardId={item.rewardId}
                          onClose={() => setEditing(null)}
                          onPublished={() => {
                            setEditing(null);
                            setNotice(
                              "Период подтверждён сервером. Перечитываем квоты.",
                            );
                            void client.invalidateQueries({
                              queryKey: ["admin-catalog-quotas"],
                            });
                            void client.invalidateQueries({
                              queryKey: ["admin-audit"],
                            });
                            void query.refetch();
                          }}
                          onDenied={() => {
                            setEditing(null);
                            for (const key of [
                              "admin-catalog",
                              "admin-catalog-history",
                              "admin-catalog-quotas",
                            ]) {
                              void client.cancelQueries({ queryKey: [key] });
                              client.setQueriesData(
                                { queryKey: [key] },
                                () => null,
                              );
                            }
                            setNotice(
                              "Публикация периода недоступна. Обновите каталог.",
                            );
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="tasks-action"
                          disabled={query.isFetching || query.isError}
                          onClick={() => {
                            if (confirmLeave()) {
                              setEditing(`quota|${item.rewardId}`);
                              setNotice("");
                            }
                          }}
                        >
                          Опубликовать период квоты
                        </button>
                      )
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
          {data.nextCursor ? (
            <button
              type="button"
              className="tasks-action"
              disabled={query.isFetching || query.isError}
              onClick={() => {
                if (!confirmLeave()) return;
                setEditing(null);
                setNotice("");
                setScope(data.scope.id);
                setCursor(data.nextCursor!);
              }}
            >
              Следующая страница
            </button>
          ) : null}
          {cursor ? (
            <p className="notification-note">
              «Обновить» возвращает первую страницу. Условия и квоты могут
              измениться между страницами.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
