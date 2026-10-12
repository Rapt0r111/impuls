"use client";

import {
  participantProfileResponseSchema,
  profileNameResponseSchema,
  profileNameSchema,
} from "@impuls/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useAuthorizedSession } from "@/features/auth/session-context";
import { mutationLimitMessage } from "@/shared/http/mutation-limit-message";
import "./participant-profile.css";

export class ProfileError extends Error {
  constructor(readonly status: number) {
    super("Profile unavailable");
  }
}
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));

export function useParticipantProfile() {
  return useQuery({
    queryKey: ["participant-profile"],
    retry: false,
    networkMode: "always",
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/v1/me/profile", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new ProfileError(response.status);
      return participantProfileResponseSchema.parse(await response.json());
    },
  });
}

const nameRule = "От 2 до 40 символов: буквы, цифры, пробел и . _ ' -";

// The participant chooses the name other members see. The key is reused for a retry of the same
// text, so a lost response can be repeated safely; the server treats repeats as no change.
function ProfileNameForm({ current }: { current: string }) {
  const { csrfToken, loseAccess } = useAuthorizedSession();
  const queryClient = useQueryClient();
  const id = useId();
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const key = useRef<{ text: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const parsed = profileNameSchema.safeParse(value);
  const unchanged = parsed.success && parsed.data === current;

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.success || pending) return;
    if (key.current?.text !== parsed.data)
      key.current = { text: parsed.data, key: crypto.randomUUID() };
    const intent = key.current;
    setPending(true);
    setFailed(false);
    setStatus("Сохраняем имя…");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": intent.key,
        },
        body: JSON.stringify({ displayName: parsed.data }),
      });
      if (!alive.current) return;
      if ([401, 403].includes(response.status)) {
        loseAccess(response.status);
        return;
      }
      if (response.ok) {
        const saved = profileNameResponseSchema.parse(await response.json());
        setValue(saved.user.displayName);
        setStatus(
          saved.changed ? "Имя сохранено." : "Это имя уже установлено.",
        );
        await queryClient.invalidateQueries({
          queryKey: ["participant-profile"],
        });
        return;
      }
      setFailed(true);
      setStatus(
        response.status === 409
          ? "Такое имя уже занято. Выберите другое."
          : response.status === 429
            ? mutationLimitMessage(response)
            : response.status === 404
              ? "Смена имени сейчас недоступна."
              : response.status === 400
                ? `Имя не подходит. ${nameRule}.`
                : "Результат не подтверждён. Повторите сохранение.",
      );
    } catch {
      if (!alive.current) return;
      setFailed(true);
      setStatus(
        navigator.onLine
          ? "Результат не подтверждён. Повторите сохранение."
          : "Нет соединения. Имя не сохранено.",
      );
    } finally {
      clearTimeout(timeout);
      if (alive.current) setPending(false);
    }
  }
  return (
    <section className="profile-block" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Имя в приложении</h3>
      <form className="profile-name-form" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-name`}>Как вас видят другие участники</label>
        <input
          id={`${id}-name`}
          value={value}
          maxLength={40}
          autoComplete="nickname"
          aria-describedby={`${id}-hint`}
          aria-invalid={value !== current && !parsed.success}
          onChange={(event) => {
            setValue(event.target.value);
            setStatus("");
          }}
        />
        <p id={`${id}-hint`}>
          {nameRule}. Имя видно в рейтинге, очереди проверки и журналах области.
        </p>
        <button
          type="submit"
          className="tasks-action"
          disabled={pending || !parsed.success || unchanged}
        >
          Сохранить имя
        </button>
        <p role={failed ? "alert" : "status"}>{status}</p>
      </form>
    </section>
  );
}

export function ParticipantProfile() {
  const { loseAccess } = useAuthorizedSession();
  const query = useParticipantProfile();
  useEffect(() => {
    if (
      query.error instanceof ProfileError &&
      [401, 403].includes(query.error.status)
    )
      loseAccess(query.error.status);
  }, [query.error, loseAccess]);
  const hidden =
    query.error instanceof ProfileError &&
    [401, 403, 404].includes(query.error.status);
  const data = hidden ? undefined : query.data;
  const level = data?.progression.level;
  return (
    <section
      className="tasks-section participant-profile"
      aria-labelledby="profile-title"
      aria-busy={query.isFetching}
    >
      <div className="tasks-heading">
        <div>
          <h2 id="profile-title">Мой профиль</h2>
          <p>Синтетический режим · подтверждённые результаты.</p>
        </div>
        <button
          type="button"
          className="tasks-action"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить профиль
        </button>
      </div>
      {query.isPending ? <p role="status">Загружаем профиль…</p> : null}
      {query.isError ? (
        <p className="tasks-state" role="alert">
          {query.error instanceof ProfileError && query.error.status === 404
            ? "Синтетический профиль выключен."
            : !navigator.onLine
              ? "Нет соединения. Восстановите сеть и обновите профиль."
              : "Профиль недоступен. Повторите загрузку."}
          {data ? " Показаны последние подтверждённые значения." : ""}
        </p>
      ) : null}
      {data ? (
        <>
          <dl className="ledger-balances">
            <div>
              <dt>XP за всё время</dt>
              <dd>{number(data.balance.lifetimeXp)} XP</dd>
            </div>
          </dl>
          <p className="ledger-asof">
            Подтверждено сервером: {date(data.asOf)} МСК
          </p>
          <ProfileNameForm current={data.user.displayName} />
          <section
            className="profile-block"
            aria-labelledby="profile-level-title"
          >
            <h3 id="profile-level-title">Уровень</h3>
            {level ? (
              <>
                <p className="profile-level">
                  <strong className="sr-only">Уровень {level.level}</strong>
                  <span className="profile-level-number" aria-hidden="true">
                    {level.level}
                  </span>
                  <span>уровень</span>
                </p>
                {level.nextLevelXp === null ? (
                  <p>Достигнут последний настроенный уровень.</p>
                ) : (
                  <>
                    <label htmlFor="profile-progress">
                      До уровня {level.level + 1}: {number(level.remainingXp)}{" "}
                      XP
                    </label>
                    <progress
                      id="profile-progress"
                      max={level.spanXp!}
                      value={level.progressXp}
                    />
                    <p className="profile-level-caption">
                      {number(level.progressXp)} / {number(level.spanXp!)} XP ·
                      порог следующего уровня {number(level.nextLevelXp)} XP за
                      всё время.
                    </p>
                  </>
                )}
                <p>
                  Расчёт учитывает исправления начислений. Смена месяца не
                  сбрасывает XP.
                </p>
              </>
            ) : (
              <p>
                {data.progression.state === "invalid"
                  ? "Пороги уровней в настройках начислений некорректны. Сообщите администратору."
                  : "Уровни ещё не настроены."}
              </p>
            )}
          </section>
          <section
            className="profile-block"
            aria-labelledby="profile-achievement-title"
          >
            <h3 id="profile-achievement-title">Первый результат</h3>
            {data.firstResult ? (
              <>
                <p className="profile-result-status">
                  <strong>
                    {data.firstResult.sourceCorrected
                      ? "Исходное начисление возвращено"
                      : "Получено"}
                  </strong>
                </p>
                <p>{data.firstResult.task.title}</p>
                <p>
                  {date(data.firstResult.grantedAt)} МСК · условие{" "}
                  {data.firstResult.conditionVersion}
                </p>
                {data.firstResult.sourceCorrected ? (
                  <p>
                    Сохранено основание первого результата. Начисление по нему
                    исправлено; активность достижения требует решения правил.
                  </p>
                ) : null}
                {data.firstResult.provenance === "migration" ? (
                  <p>
                    Восстановлено по первой сохранённой приёмке при миграции.
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                Пока не получено. Появится после первой приёмки результата
                командиром.
              </p>
            )}
            <p>
              Косметическое достижение выдаётся один раз и не добавляет XP или
              баллы.
            </p>
          </section>
        </>
      ) : null}
    </section>
  );
}
