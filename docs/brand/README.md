# Фирменный стиль «Стимул»

Исходники из папки бренда: `brandbook.html` (справочная страница, не проверяется форматтером),
`logo-mark.svg`, `logo-horizontal.svg`, `logo-badge.svg`, `promo-banner-landscape.svg`, `promo-banner-post.svg`.

Производные файлы создаёт скрипт `bun run brand:assets` (`scripts/render-brand-assets.mjs`) из этих исходников:

- `apps/app/src/app/icon.svg`, `favicon.ico` — вкладка браузера (упрощённый знак «С» без подписи и тонких линий);
- `apps/app/src/app/apple-icon.png` — иконка для экрана «Домой» (180×180, полный фон без скругления);
- `apps/app/src/app/opengraph-image.png` — превью ссылки (1200×630);
- `apps/app/public/brand/` — знак для экрана доступа, иконки манифеста 192/512 и maskable 512;
- `docs/brand/telegram/` — аватар бота 512×512 и картинка описания 640×360 для @BotFather.

Цвета и шрифт (Manrope) совпадают с токенами `apps/app/src/shared/ui/tokens.css`.

Telegram-аватар бота и картинка описания меняются вручную в @BotFather; из репозитория они не загружаются.
