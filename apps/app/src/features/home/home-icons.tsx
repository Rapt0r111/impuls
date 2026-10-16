import type { SVGProps } from "react";

// Значки макета «NR_Point Home»: одна обводка 1.8–2.2, скругления как в нижней панели.
type Props = SVGProps<SVGSVGElement>;
const stroke = (width = 2): Props => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: width,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const Pulse = (p: Props) => (
  <svg {...stroke()} {...p}>
    <path d="M3 13h3l2.5-6 3.5 11 2.5-7 1.5 2H21" />
  </svg>
);
export const Star = (p: Props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <polygon points="12,3.5 14.4,9 20.4,9.5 15.9,13.5 17.3,19.4 12,16.3 6.7,19.4 8.1,13.5 3.6,9.5 9.6,9" />
  </svg>
);
export const Check = (p: Props) => (
  <svg {...stroke()} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const DoubleCheck = (p: Props) => (
  <svg {...stroke(2.2)} {...p}>
    <path d="M4 12.5l4.5 4.5L14 10.5M11 16.5l1.5 1.5L20 9" />
  </svg>
);
export const Bell = (p: Props) => (
  <svg {...stroke(1.8)} {...p}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);
export const Dots = (p: Props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);
export const Chevron = (p: Props) => (
  <svg {...stroke()} {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const ChevronLeft = (p: Props) => (
  <svg {...stroke()} {...p}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const Close = (p: Props) => (
  <svg {...stroke()} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Info = (p: Props) => (
  <svg {...stroke(1.8)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.01" />
  </svg>
);
export const PlusCircle = (p: Props) => (
  <svg {...stroke()} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
export const Arrow = (p: Props) => (
  <svg {...stroke(2.2)} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Lock = (p: Props) => (
  <svg {...stroke()} {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Clock = (p: Props) => (
  <svg {...stroke()} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const Person = (p: Props) => (
  <svg {...stroke(1.8)} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
  </svg>
);
export const Help = (p: Props) => (
  <svg {...stroke(1.8)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
  </svg>
);
export const ReviewList = (p: Props) => (
  <svg {...stroke()} {...p}>
    <rect x="5" y="4" width="14" height="16" rx="3" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

// Знак приложения: тактическая кибер-морковка «Стимул» (символ мотивации и поощрения).
export function Logo() {
  return (
    <svg viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true">
      <defs>
        <radialGradient id="homeLogoBg" cx="50%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#143644" />
          <stop offset="60%" stopColor="#0a1d26" />
          <stop offset="100%" stopColor="#050e14" />
        </radialGradient>
        <linearGradient id="homeCarrotBody" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff9d1e" />
          <stop offset="50%" stopColor="#ff6a00" />
          <stop offset="100%" stopColor="#d43800" />
        </linearGradient>
      </defs>
      <rect
        x="24"
        y="24"
        width="464"
        height="464"
        rx="108"
        fill="url(#homeLogoBg)"
        stroke="#00f0b5"
        strokeOpacity="0.5"
        strokeWidth="8"
      />
      {/* Leaves */}
      <path
        d="M 256 195 C 248 150, 244 110, 256 75 C 268 110, 264 150, 256 195 Z"
        fill="#00f0b5"
      />
      <path
        d="M 248 190 C 230 155, 192 120, 156 108 C 182 142, 220 178, 242 194 Z"
        fill="#00f0b5"
      />
      <path
        d="M 264 190 C 282 155, 320 120, 356 108 C 330 142, 292 178, 270 194 Z"
        fill="#00f0b5"
      />
      {/* Carrot Body */}
      <path
        d="M 186 198 C 186 182, 326 182, 326 198 C 326 248, 288 340, 258 406 C 257 408, 255 408, 254 406 C 224 340, 186 248, 186 198 Z"
        fill="url(#homeCarrotBody)"
      />
      {/* Energy Rings */}
      <path
        d="M 198 234 C 224 244, 288 244, 314 234"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M 214 286 C 234 294, 278 294, 298 286"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M 230 338 C 244 344, 268 344, 282 338"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Spark */}
      <circle cx="256" cy="188" r="14" fill="#ffbe3b" />
      <circle cx="256" cy="188" r="6" fill="#ffffff" />
    </svg>
  );
}
