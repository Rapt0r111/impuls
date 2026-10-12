"use client";

import { useState } from "react";

const MAX = 2147483647;

// A whole-number field that does not fight the keyboard: an untouched zero shows as an
// empty field with a "0" hint, so typing "5" gives 5 and never "05", and leading zeros
// are dropped while typing. An empty field means 0.
export function IntInput({
  value,
  onValue,
  labelledBy,
  disabled,
}: {
  value: number;
  onValue(next: number): void;
  labelledBy: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  // An outside change (loading another draft) wins over what was typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (Number(text || 0) !== value) setText(value === 0 ? "" : String(value));
  }
  return (
    <input
      aria-labelledby={labelledBy}
      inputMode="numeric"
      autoComplete="off"
      placeholder="0"
      value={text}
      disabled={disabled}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const digits = event.target.value
          .replace(/\D/g, "")
          .replace(/^0+(?=\d)/, "")
          .slice(0, 10);
        const next = Math.min(Number(digits || 0), MAX);
        setText(digits === "" ? "" : String(next));
        setSeen(next);
        onValue(next);
      }}
    />
  );
}
