"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./select.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  // Пункты с одинаковым group идут под одним заголовком.
  group?: string;
};

// Замена нативного select: список рисует приложение, поэтому вид одинаков в Telegram на
// Android, iOS и в браузере. Клавиатура: стрелки, Home/End, Enter/Space, Escape, буквы.
export function Select({
  labelledBy,
  value,
  options,
  onValueChange,
  disabled,
  className,
}: {
  labelledBy: string;
  value: string;
  options: SelectOption[];
  onValueChange(next: string): void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const valueId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = root.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"], [role="option"]:not([aria-disabled="true"])',
    );
    first?.focus();
  }, [open]);

  function choose(next: string) {
    if (next !== value) onValueChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLLIElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ),
    );
    const current = items.indexOf(document.activeElement as HTMLLIElement);
    const focus = (item: HTMLLIElement | undefined) => {
      event.preventDefault();
      item?.focus();
    };
    if (event.key === "ArrowDown")
      return focus(items[Math.min(current + 1, items.length - 1)]);
    if (event.key === "ArrowUp") return focus(items[Math.max(current - 1, 0)]);
    if (event.key === "Home") return focus(items[0]);
    if (event.key === "End") return focus(items.at(-1));
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLLIElement).click();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key.length === 1 && event.key.trim()) {
      const query = event.key.toLocaleLowerCase("ru");
      const order = [
        ...items.slice(current + 1),
        ...items.slice(0, current + 1),
      ];
      order
        .find((item) =>
          item.textContent?.trim().toLocaleLowerCase("ru").startsWith(query),
        )
        ?.focus();
    }
  }

  // Список часто лежит внутри <label> фильтров: без preventDefault клик по пункту
  // активировал бы label и снова нажимал кнопку.
  return (
    <div
      ref={root}
      className={className ? `ui-select ${className}` : "ui-select"}
      onClick={(event) => event.preventDefault()}
    >
      <button
        ref={trigger}
        type="button"
        className="ui-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-value={selected?.value}
        aria-labelledby={`${labelledBy} ${valueId}`}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={valueId} className="ui-select__value">
          {selected?.label ?? ""}
        </span>
        <svg
          className="ui-select__chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          className="ui-select__list"
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.group && option.group !== options[index - 1]?.group ? (
                <li role="presentation" className="ui-select__group">
                  {option.group}
                </li>
              ) : null}
              <li
                role="option"
                data-value={option.value}
                tabIndex={-1}
                aria-selected={option.value === selected?.value}
                aria-disabled={option.disabled || undefined}
                className="ui-select__option"
                onClick={() => {
                  if (!option.disabled) choose(option.value);
                }}
              >
                {option.label}
              </li>
            </Fragment>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
