"use client";

import { useEffect } from "react";

// Скрытие до появления включается только когда JS работает: без него весь текст видно сразу.
// Слова подсветки и блоки открываются один раз, при пересечении линии на 60% высоты экрана.
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const targets = document.querySelectorAll<HTMLElement>(
      ".landing .reveal, .landing .tagline-word",
    );
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    root.classList.add("landing-js");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -40% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      root.classList.remove("landing-js");
    };
  }, []);

  return null;
}
