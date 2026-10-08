import type { AdminCatalogResponse } from "@impuls/contracts";

export class CatalogError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Admin catalog request failed");
  }
}
export const catalogDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));

export function CatalogTerms({
  value,
  label = "Действующие условия",
  history = false,
  pendingEffective = false,
  pendingVersion = false,
}: {
  value: NonNullable<AdminCatalogResponse["items"][number]["current"]>;
  label?: string;
  history?: boolean;
  pendingEffective?: boolean;
  pendingVersion?: boolean;
}) {
  const Heading = history ? "h4" : "h3";
  return (
    <div className="admin-catalog-terms">
      <Heading>{value.title}</Heading>
      <p>
        {label} ·{" "}
        {pendingVersion ? "номер назначит сервер" : `версия ${value.version}`} ·{" "}
        {value.enabled ? "Включена" : "Выключена"}
      </p>
      <p className="admin-catalog-price">
        {value.price.toLocaleString("ru-RU")} баллов
      </p>
      <p className="admin-catalog-conditions">{value.conditions}</p>
      <p className="notification-note">
        {pendingEffective ? (
          "Начало действия: время подтверждения сервером."
        ) : (
          <>
            Начало действия:{" "}
            <time dateTime={value.effectiveFrom}>
              {catalogDate(value.effectiveFrom)}
            </time>{" "}
            МСК.
          </>
        )}
        <br />
        {value.reservationSeconds === null
          ? "Срок резерва не задан."
          : `Срок резерва: ${value.reservationSeconds.toLocaleString("ru-RU")} с.`}
      </p>
    </div>
  );
}
