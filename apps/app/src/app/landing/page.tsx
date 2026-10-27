import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LandingMotion } from "./landing-motion";
import "./landing.css";

export const metadata: Metadata = {
  title: "Стимул: как работает приложение",
  description:
    "Задачи с понятным результатом, баллы после приёмки и поощрения для участников научной роты.",
  robots: { index: false, follow: false },
};

const benefits = [
  {
    title: "Понятные критерии",
    text: "У каждой задачи есть критерии результата. Исполнитель видит, что нужно сделать и по чему работу примут.",
  },
  {
    title: "Баллы только после приёмки",
    text: "XP и баллы начисляются, когда проверяющий принял отчёт. До приёмки ничего не начисляется.",
  },
  {
    title: "Поощрения за баллы",
    text: "Баллы можно обменять на поощрения из каталога. XP при этом не уменьшается.",
  },
];

const steps = [
  {
    title: "Командир ставит задачу",
    text: "Задаёт название, критерии результата, срок и фонд XP и баллов.",
  },
  {
    title: "Участник берёт задачу и сдаёт отчёт",
    text: "Свободные задачи можно взять самому. В отчёте написано, что сделано.",
  },
  {
    title: "Проверяющий принимает работу",
    text: "Принимает отчёт, возвращает на доработку или рекомендует XP и баллы в пределах фонда.",
  },
];

const questions = [
  {
    question: "Кто может пользоваться приложением?",
    answer:
      "Участники, которых добавил командир области. Доступ проверяется по аккаунту Telegram.",
  },
  {
    question: "Почему XP не тратится?",
    answer:
      "XP показывает уровень: Новичок, Исполнитель, Специалист, Ведущий, Эксперт. Тратятся только баллы.",
  },
  {
    question: "Почему баллы пока не пришли?",
    answer:
      "Баллы начисляются после приёмки отчёта. Пока отчёт на проверке, в счёте они не появляются.",
  },
  {
    question: "Что делать, если задачу вернули?",
    answer:
      "Исправить отчёт по замечаниям и отправить его снова. Начисление будет после приёмки.",
  },
  {
    question: "Где видно, за что начислены баллы?",
    answer:
      "В разделе «Баланс и журнал» показано каждое начисление и списание с датой и причиной.",
  },
  {
    question: "Как получить доступ?",
    answer:
      "Командир области добавляет участника в состав. Без этого приложение не откроется.",
  },
];

const tagline = "Задача понятна. Результат проверен. Баллы заработаны.";

function OpenButton({ variant }: { variant: "primary" | "ghost" }) {
  return (
    <Link
      href="/"
      className={
        variant === "primary"
          ? "landing-button"
          : "landing-button landing-button--ghost"
      }
    >
      Открыть приложение
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingMotion />
      <header className="landing-top">
        <Link
          href="/landing"
          className="landing-brand"
          aria-label="Стимул, главная страница"
        >
          <Image
            src="/brand/logo-mark.svg"
            alt=""
            width={32}
            height={32}
            unoptimized
          />
          <span>Стимул</span>
        </Link>
        <a className="landing-link" href="#how">
          Как это работает
        </a>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-eyebrow">Рабочее приложение научной роты</p>
          <h1 id="landing-title" className="landing-title">
            Задачи, отчёты и баллы в одном месте
          </h1>
          <p className="landing-lead">
            Командир ставит задачу, участник присылает отчёт, проверяющий
            принимает работу. После приёмки XP и баллы попадают в личный счёт, а
            баллы можно обменять на поощрения.
          </p>
          <div className="landing-actions">
            <OpenButton variant="primary" />
            <a className="landing-button landing-button--ghost" href="#how">
              Как это устроено
            </a>
          </div>
          <p className="landing-proof">
            Доступ только для участников области. Вход через Telegram.
          </p>
        </section>

        <section className="landing-tagline" aria-label="Главная идея">
          <p className="landing-tagline-text">
            {tagline.split(" ").map((word, index) => (
              <span key={`${word}-${index}`} className="tagline-word">
                {word}{" "}
              </span>
            ))}
          </p>
        </section>

        <section
          className="landing-section reveal"
          aria-labelledby="benefits-title"
        >
          <h2 id="benefits-title" className="landing-h2">
            Что получает участник
          </h2>
          <ul className="landing-cards">
            {benefits.map((item) => (
              <li key={item.title} className="landing-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="how"
          className="landing-section reveal"
          aria-labelledby="how-title"
        >
          <h2 id="how-title" className="landing-h2">
            Как проходит задача
          </h2>
          <ol className="landing-steps">
            {steps.map((step, index) => (
              <li key={step.title} className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section reveal" aria-labelledby="faq-title">
          <h2 id="faq-title" className="landing-h2">
            Частые вопросы
          </h2>
          <div className="landing-faq">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final reveal" aria-labelledby="final-title">
          <h2 id="final-title" className="landing-h2">
            Откройте приложение и посмотрите свои задачи
          </h2>
          <p className="landing-lead">
            Вход происходит через Telegram, отдельный пароль не нужен.
          </p>
          <OpenButton variant="primary" />
        </section>
      </main>

      <footer className="landing-footer">
        <p>Стимул. Рабочее приложение научной роты.</p>
      </footer>
    </div>
  );
}
