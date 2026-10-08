// Measurable layout checks for a rendered page (Impeccable audit § Responsive):
// interactive targets under 44 px and text clipped inside its own box.
// Enabled with TEST_LAYOUT_AUDIT=1; findings are printed, not asserted.
export async function auditLayout(page, name) {
  if (process.env.TEST_LAYOUT_AUDIT !== "1") return [];
  const findings = await page.evaluate(() => {
    const out = [],
      label = (el) =>
        `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`,
      visible = (el) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
      };
    for (const el of document.querySelectorAll(
      "button,a[href],select,textarea,input:not([type=hidden]),[role=button],summary",
    )) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (el.matches("input[type=checkbox],input[type=radio]")) {
        const box = el.closest("label")?.getBoundingClientRect() ?? r;
        if (box.height < 44)
          out.push(
            `target ${Math.round(box.width)}x${Math.round(box.height)} ${label(el)}`,
          );
      } else if (r.height < 44 || r.width < 44)
        out.push(
          `target ${Math.round(r.width)}x${Math.round(r.height)} ${label(el)}`,
        );
    }
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || !el.childNodes.length) continue;
      const s = getComputedStyle(el);
      const hidesX = ["hidden", "clip"].includes(s.overflowX),
        hidesY = ["hidden", "clip"].includes(s.overflowY);
      if (
        (hidesX && el.scrollWidth > el.clientWidth + 1) ||
        (hidesY && el.scrollHeight > el.clientHeight + 1)
      )
        out.push(`clipped ${label(el)}`);
    }
    return [...new Set(out)];
  });
  if (findings.length)
    console.log(`LAYOUT-AUDIT ${name}:\n  ${findings.join("\n  ")}`);
  return findings;
}
