// Производные файлы бренда из исходников в docs/brand/: иконки приложения,
// favicon, превью ссылки и картинки для настройки бота в Telegram.
// Запуск: node scripts/render-brand-assets.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const write = (file, data) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
};

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source))
    throw new Error(`Исходник бренда изменился: не найдено «${label}»`);
  return source.replace(pattern, replacement);
}

const markSource = read("docs/brand/logo-mark.svg");
// В мелких размерах подпись «IMPULSE // R-01 CORE» нечитаема, поэтому
// в иконках и в интерфейсе используется знак без неё.
const compactMark = replaceOnce(
  markSource,
  /\s*<!-- Micro Technical Coordinates Label -->\s*<g opacity="0\.45"[\s\S]*?<\/g>/,
  "",
  "подпись знака",
).replace(' width="100%" height="100%"', "");
// Для PNG-иконок нужен квадрат без скруглений: iOS и Telegram маскируют сами.
const fullBleedMark = replaceOnce(
  compactMark,
  /<rect x="24" y="24" width="464" height="464" rx="108"[^>]*\/>/,
  '<rect width="512" height="512" fill="url(#bgGlow)" />',
  "фон знака",
);

// Упрощённый знак для favicon: без свечения и тонких линий, чтобы пульс
// оставался различим в 16–32 px. Геометрия и цвета те же, что в logo-mark.svg.
const faviconMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#163842" />
      <stop offset="100%" stop-color="#061016" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)" />
  <rect x="96" y="112" width="64" height="288" rx="18" fill="#70e1c2" />
  <rect x="352" y="112" width="64" height="288" rx="18" fill="#70e1c2" />
  <path d="M 132 352 L 196 352 L 226 392 L 256 130 L 286 322 L 316 212 L 350 212 L 392 164"
        fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="256" cy="130" r="30" fill="#f6d083" />
</svg>
`;

const bannerSource = read("docs/brand/promo-banner-landscape.svg");
// В исходном баннере подпись «НАУЧНАЯ РОТА • СЕРВИС» шире плашки; в копии
// для превью ссылки плашка расширена, исходный файл не меняется.
const banner = replaceOnce(
  replaceOnce(
    bannerSource,
    /<rect width="180" height="32" rx="8"/,
    '<rect width="232" height="32" rx="8"',
    "плашка баннера",
  ),
  /<text x="90" y="21"/,
  '<text x="116" y="21"',
  "подпись плашки",
);

const fontFace = (file, weight) =>
  `@font-face{font-family:Manrope;font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(
    path.join(root, "apps/app/src/shared/ui/fonts", file),
  ).toString("base64")})}`;
const fontCss =
  fontFace("Manrope-Regular.ttf", 400) +
  fontFace("Manrope-Bold.ttf", "600 800");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
async function png(svg, width, height, clip) {
  const page = await browser.newPage({ viewport: { width, height } });
  const sized = svg.replace(
    /<svg ([^>]*?)(?: width="100%" height="100%")?>/,
    `<svg $1 width="${width}" height="${height}">`,
  );
  await page.setContent(
    `<style>${fontCss}html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`,
  );
  await page.evaluate(() => document.fonts.ready);
  const buffer = await page.screenshot({
    omitBackground: true,
    ...(clip ? { clip } : {}),
  });
  await page.close();
  return buffer;
}

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

write("apps/app/src/app/icon.svg", faviconMark);
write("apps/app/public/brand/logo-mark.svg", compactMark);
write(
  "apps/app/src/app/favicon.ico",
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await png(faviconMark, size, size),
      })),
    ),
  ),
);
write("apps/app/src/app/apple-icon.png", await png(fullBleedMark, 180, 180));
write("apps/app/public/brand/icon-192.png", await png(compactMark, 192, 192));
write("apps/app/public/brand/icon-512.png", await png(compactMark, 512, 512));
write(
  "apps/app/public/brand/icon-maskable-512.png",
  await png(fullBleedMark, 512, 512),
);
write("apps/app/src/app/opengraph-image.png", await png(banner, 1200, 630));
write(
  "docs/brand/telegram/bot-avatar-512.png",
  await png(fullBleedMark, 512, 512),
);
// Картинка описания бота 640×360: баннер 1200×630 по высоте, края обрезаны.
write(
  "docs/brand/telegram/bot-description-picture-640x360.png",
  await png(banner, 686, 360, { x: 23, y: 0, width: 640, height: 360 }),
);
await browser.close();
