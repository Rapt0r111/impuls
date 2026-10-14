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

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11
    ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? few
      : many;
};
// Срок резерва хранится в секундах; человеку показываем дни, часы или минуты.
export function reservationText(seconds: number) {
  const n = (value: number) => value.toLocaleString("ru-RU");
  if (seconds % 86400 === 0)
    return `${n(seconds / 86400)} ${plural(seconds / 86400, "день", "дня", "дней")}`;
  if (seconds % 3600 === 0)
    return `${n(seconds / 3600)} ${plural(seconds / 3600, "час", "часа", "часов")}`;
  if (seconds % 60 === 0)
    return `${n(seconds / 60)} ${plural(seconds / 60, "минута", "минуты", "минут")}`;
  return `${n(seconds)} с`;
}

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
          : `Срок резерва: ${reservationText(value.reservationSeconds)}.`}
      </p>
    </div>
  );
}
