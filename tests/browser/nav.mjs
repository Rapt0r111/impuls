// Служебные разделы и «Баланс» открываются из раздела «Ещё» нижней панели.
// Помощник сам открывает «Ещё» и возвращает кнопку нужного раздела.
export async function openSection(page, name) {
  await page
    .locator(".workspace-nav-personal")
    .getByRole("button", { name: "Ещё", exact: true })
    .click();
  return page.getByRole("button", { name, exact: true });
}
