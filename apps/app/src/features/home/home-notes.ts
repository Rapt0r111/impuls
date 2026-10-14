import type {
  accountLedgerResponseSchema,
  redemptionListResponseSchema,
  TaskListResponse,
} from "@impuls/contracts";

// Ленты уведомлений на сервере нет: в колокольчике собраны события из данных, которые
// участник уже видит в приложении (журнал начислений, назначенные задачи, решения по
// заявкам). Отметки «Прочитано» хранятся только на этом устройстве.
export type NoteKind = "task" | "assign" | "star";
export type NoteTarget = "tasks" | "rewards" | "ledger";
export type HomeNote = {
  id: string;
  kind: NoteKind;
  title: string;
  text: string;
  at: string;
  target: NoteTarget;
};

type LedgerPage = ReturnType<typeof accountLedgerResponseSchema.parse>;
type RedemptionPage = ReturnType<typeof redemptionListResponseSchema.parse>;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTE_LIMIT = 8;

const part = (amount: number, unit: string) =>
  amount > 0 ? `+${amount} ${unit}` : "";

export function buildNotes(
  sources: {
    ledger?: LedgerPage | undefined;
    tasks?: TaskListResponse | undefined;
    redemptions?: RedemptionPage | undefined;
  },
  now = Date.now(),
): HomeNote[] {
  const notes: HomeNote[] = [];
  const fresh = (at: string) => now - Date.parse(at) <= WEEK_MS;

  // Начисление за принятую задачу записано двумя строками (XP и баллы) в один момент.
  const awards = new Map<
    string,
    { title: string; at: string; xp: number; points: number; taskId: string }
  >();
  for (const entry of sources.ledger?.entries ?? []) {
    if (entry.kind !== "task_acceptance" || !entry.task) continue;
    if (!fresh(entry.createdAt)) continue;
    const key = `${entry.task.id}|${entry.createdAt}`;
    const award = awards.get(key) ?? {
      title: entry.task.title,
      at: entry.createdAt,
      xp: 0,
      points: 0,
      taskId: entry.task.id,
    };
    if (entry.currency === "xp") award.xp += entry.amount;
    else award.points += entry.amount;
    awards.set(key, award);
  }
  for (const [key, award] of awards) {
    const gained = [part(award.xp, "XP"), part(award.points, "баллов")]
      .filter(Boolean)
      .join(" и ");
    notes.push({
      id: `award:${key}`,
      kind: "task",
      title: "Задача принята",
      text: gained ? `${award.title}: ${gained}` : award.title,
      at: award.at,
      target: "ledger",
    });
  }

  for (const task of sources.tasks?.items ?? []) {
    if (task.status !== "assigned" || !fresh(task.updatedAt)) continue;
    notes.push({
      id: `assign:${task.id}:${task.updatedAt}`,
      kind: "assign",
      title: "Новое назначение",
      text: `Назначена задача «${task.title}»`,
      at: task.updatedAt,
      target: "tasks",
    });
  }

  for (const item of sources.redemptions?.items ?? []) {
    const decided = item.decision?.decidedAt;
    const given = item.fulfillment?.fulfilledAt;
    const [title, text, at] =
      item.status === "approved" && decided
        ? ["Поощрение одобрено", `«${item.title}» одобрено`, decided]
        : item.status === "fulfilled" && given
          ? ["Поощрение выдано", `«${item.title}» выдано`, given]
          : item.status === "rejected" && decided
            ? ["Заявка отклонена", `«${item.title}» не одобрено`, decided]
            : [];
    if (!title || !text || !at || !fresh(at)) continue;
    notes.push({
      id: `redemption:${item.id}:${item.status}`,
      kind: "star",
      title,
      text,
      at,
      target: "rewards",
    });
  }

  return notes
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, NOTE_LIMIT);
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// «Сегодня», «Вчера» или дата: подпись группы строк в списке.
export function dayLabel(at: string, now = new Date()): string {
  const days = Math.round(
    (startOfDay(now) - startOfDay(new Date(at))) / 86400000,
  );
  if (days <= 0) return "Сегодня";
  if (days === 1) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(at));
}

// «10 мин», «1 ч» в пределах суток, дальше время «18:40».
export function relativeTime(at: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 24 * 60 && sameDay(new Date(at), new Date(now)))
    return `${Math.floor(minutes / 60)} ч`;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}

function sameDay(a: Date, b: Date) {
  return startOfDay(a) === startOfDay(b);
}

export const taskWord = (count: number) => {
  const m10 = count % 10;
  const m100 = count % 100;
  if (m10 === 1 && m100 !== 11) return "задача";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "задачи";
  return "задач";
};

export const pointsWord = (count: number) => {
  const m10 = count % 10;
  const m100 = count % 100;
  if (m10 === 1 && m100 !== 11) return "балл";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "балла";
  return "баллов";
};

const NOTES_READ_KEY = "impuls.home.notes.read";
export function readReadNotes(): string[] {
  try {
    const raw = window.localStorage.getItem(NOTES_READ_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
export function writeReadNotes(ids: string[]) {
  try {
    window.localStorage.setItem(
      NOTES_READ_KEY,
      JSON.stringify(ids.slice(-100)),
    );
  } catch {
    // Без хранилища отметки сбросятся при следующем запуске.
  }
}
