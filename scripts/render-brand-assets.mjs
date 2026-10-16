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

// Упрощённый знак для favicon: морковка с характерными кольцами и зелёной ботвой.
// Чётко различим в 16–32 px.
const faviconMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#143644" />
      <stop offset="100%" stop-color="#050e14" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)" />
  <!-- Leaves -->
  <path d="M 256 195 C 248 150, 244 110, 256 75 C 268 110, 264 150, 256 195 Z" fill="#00f0b5" />
  <path d="M 248 190 C 230 155, 192 120, 156 108 C 182 142, 220 178, 242 194 Z" fill="#00f0b5" />
  <path d="M 264 190 C 282 155, 320 120, 356 108 C 330 142, 292 178, 270 194 Z" fill="#00f0b5" />
  <!-- Body -->
  <path d="M 186 198 C 186 182, 326 182, 326 198 C 326 248, 288 340, 258 406 C 257 408, 255 408, 254 406 C 224 340, 186 248, 186 198 Z" fill="#ff7700" />
  <!-- Tech rings -->
  <path d="M 204 240 C 226 248, 286 248, 308 240" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" />
  <path d="M 218 290 C 236 298, 276 298, 294 290" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" />
  <path d="M 234 340 C 246 346, 266 346, 278 340" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" />
  <!-- Spark node -->
  <circle cx="256" cy="188" r="16" fill="#ffbe3b" />
  <circle cx="256" cy="188" r="7" fill="#ffffff" />
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
