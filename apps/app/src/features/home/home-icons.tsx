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

// Знак приложения из макета: пульс между двумя столбцами.
export function Logo() {
  return (
    <svg viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true">
      <rect
        x="24"
        y="24"
        width="464"
        height="464"
        rx="108"
        fill="#0d242e"
        stroke="#70e1c2"
        strokeOpacity="0.5"
        strokeWidth="10"
      />
      <rect x="124" y="128" width="48" height="256" rx="14" fill="#52bda4" />
      <rect x="340" y="128" width="48" height="256" rx="14" fill="#328a7d" />
      <path
        d="M 148 340 L 200 340 L 228 368 L 256 142 L 284 316 L 312 210 L 336 210 L 364 172"
        fill="none"
        stroke="#70e1c2"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <path
        d="M 148 340 L 200 340 L 228 368 L 256 142 L 284 316 L 312 210 L 336 210 L 364 172"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="142" r="14" fill="#f6d083" />
    </svg>
  );
}
