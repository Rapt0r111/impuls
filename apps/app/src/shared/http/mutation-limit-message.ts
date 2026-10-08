export function mutationLimitMessage(response: Response): string {
  const raw = response.headers.get("Retry-After");
  const seconds = raw && /^[1-9]\d?$/.test(raw) ? Number(raw) : null;
  const wait = seconds !== null && seconds <= 60 ? `${seconds} с` : "минуту";
  return `Слишком много действий. Подождите ${wait}, затем повторите тот же запрос. Данные сохранены.`;
}
