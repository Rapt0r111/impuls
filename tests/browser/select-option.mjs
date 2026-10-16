// Выпадающий список приложения (apps/app/src/shared/ui/select.tsx) — не нативный select:
// кнопка с подписью открывает список role=listbox, пункт выбирается по тексту или по значению.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// label: подпись поля, RegExp для подписи с переменным текстом или сам locator кнопки.
export function selectTrigger(page, label) {
  if (typeof label !== "string" && !(label instanceof RegExp)) return label;
  const name =
    typeof label === "string"
      ? new RegExp(`^${escapeRegExp(label)}(\\s|$)`)
      : label;
  return page.getByRole("button", { name });
}

export async function selectOption(page, label, choice) {
  await selectTrigger(page, label).click();
  const listbox = page.getByRole("listbox");
  const option =
    typeof choice === "string"
      ? listbox.locator(`[role="option"][data-value="${choice}"]`)
      : listbox.getByRole("option", { name: choice.label, exact: true });
  await option.click();
  await listbox.waitFor({ state: "detached" });
}

export async function optionTexts(page, label) {
  await selectTrigger(page, label).click();
  const texts = await page
    .getByRole("listbox")
    .getByRole("option")
    .allTextContents();
  await page.keyboard.press("Escape");
  return texts;
}
