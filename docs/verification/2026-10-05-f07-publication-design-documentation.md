# F07 publication: design documentation

5 October 2026. Scope: immediate terms publication for an existing synthetic cosmetic identity in the incumbent Operate catalog. This ordinary extension follows the parent's fresh scoped finish review (`ship`, no material fixes); it changes no visual world or normative token. The shipped Impeccable documenter role was delegated explicitly. Only this report and one appended Production Mini App extension paragraph in `DESIGN.md` were written by this pass.

## Evidence checked

- Read the full shipped `agents/impeccable_documenter.toml` and `reference/document.md`. Compared PRODUCT.md's synthetic-publication entry, IMPLEMENTATION_PLAN.md § 7, DESIGN.md's historical R0 system and production extensions, the immediate-publication direction in `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`, [implementation contract](../implementation/2026-10-05-f07-publication-slice.md) and [verification evidence](2026-10-05-f07-publication.md). No qualitative workshop or replacement identity is required for the authorized ordinary extension.
- Inspected `apps/app/src/features/catalog-admin/catalog-admin.tsx:226`, `catalog-publish.tsx:194`, `catalog-terms.tsx:21` and `apps/app/src/features/audit/audit-log.tsx`. One scoped form extends the existing item, future terms block its affordance, and source distinguishes intended server-effective terms from the immutable published audit snapshot. Required reason, explicit preview/confirmation, identical frozen retry, blocked conflict, dirty closure and denied-cache removal match the local contract. These source observations do not independently prove the recorded interactive test outcomes.
- Compared `apps/app/src/features/catalog-admin/catalog-admin.css:11`, `:47`, `:64`, `:82`, shared `apps/app/src/shared/ui/tokens.css:2` and `apps/app/src/app/globals.css:35`, `:45`, `:485`. The form inherits Manrope, navy/ink/muted/mint/gold, soft control corners, flat dividers and gold focus. New fields reuse incumbent 16 px text, 8 px radius, 12 px padding and 44 px minimum height; the heading reuses the observed 18 px step. Shared action buttons retain their panel treatment rather than acquiring a new primary variant. Price remains gold and tabular; quota counts remain neutral. There are no new primitive colors or motion rules.
- Opened ten existing PNGs: `assets/f07-publication/catalog-publication/form-320.png`, `form-360.png`, `form-390.png`, `form-1280.png`, `preview-320.png`, `preview-390.png`, `retry-503.png`, `conflict-320.png`, `text-scale-320.png`, and `assets/f07-publication/audit/catalog-publication-320.png`. Forms and preview remain vertically ordered beneath current terms/quota. Long conditions wrap; enlarged text grows by height. Gold field focus remains visible. Unknown-result copy preserves the intended snapshot and identical retry; conflict disables retry and names close/refresh. Audit identifies previous/new versions, saved terms and reason using the incumbent hierarchy. Tall rasters were resized by the image display tool, so this is visual inspection rather than pixel-level measurement.
- Read `tests/browser/catalog-publication.mjs:29` and `:216`: fixture contexts use 320/360/390/1280 widths with reduced motion, capture full-page PNGs, assert no document overflow and reject page errors. Inspected PNG metadata on `form-320.png` with `ReadAllBytes`/UTF-8 matching: its `impeccable:prompt` identifies a local Playwright synthetic fixture dated 2026-10-05 and source test scripts. This spot check confirms the origin text's presence, not the metadata of every raster; the parent reports full capture provenance and a 14-capture finish review.
- Read [detector output](assets/f07-publication/detector.json): exactly four advisory `design-system-font-size` findings, at CSS lines 14/43/58/76 for 18/16/18/16 px. First two concern preexisting catalog headings; later two reuse those incumbent R1 sizes. The detector was not rerun by this documenter.
- Read [the independent five-section finish review](2026-10-05-f07-publication-ui-review.md) after it was recorded: `ship`, no material fixes, all 14 required captures inspected. Its hierarchy/material/type/source comparison agrees with this pass; its observations remain the reviewer's evidence rather than additional captures inspected here.

## System match and preservation

DESIGN.md retains all previous bytes as a byte-identical prefix; the append check returned `Original DESIGN.md byte-identical prefix: True`. Its frontmatter, structure and historical prose are preserved. Root `.impeccable/design.json` is the incumbent R0 sidecar; `apps/app/.impeccable/design.json` does not exist. An ordinary extension does not justify regenerating either token record.

SHA-256 preservation targets checked before and after the append; all values match. `git diff --check -- DESIGN.md docs/verification/2026-10-05-f07-publication-design-documentation.md` returned exit 0, with only Git's existing CRLF-to-LF notice for DESIGN.md:

| Source                                                                                      | Preserved SHA-256                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| DESIGN.md UTF-8 frontmatter, delimiters included, no trailing newline after final delimiter | `2A727458179A72550924F90BD5F113DF2CF72DE7EBF051DC3D6DCC6A52A5D8F0` |
| `apps/app/src/shared/ui/tokens.css`                                                         | `F33E145C6E6C25ECC67C71849CA5E5E1F57AC002FE45A6C15B091162EED60C06` |
| `.impeccable/design.json`                                                                   | `71BBDAC9A4A746FCF1B873CD6305056933A3D0FFFFB513E699E6D7177080AA65` |

Palette: navy ground/panel, pale ink, muted dates, mint navigation/native checkbox and gold price/focus.

Type: Manrope; incumbent 15 px body, 16 px fields and 18 px terms, without new normative ramp values.

Layout: current terms/quota retain priority, followed by one vertical inline form or complete preview, then separate native histories.

Named rules: Meaningful Accent and Flat Surface remain; disabled/current/intended/published meanings use explicit text.

Interaction: existing 44 px controls, gold focus, required reason, explicit confirmation, dirty guard and manual identical retry; no added motion.

## Drift and limitations

Not canonized or repaired: runtime R1 16/18 px versus the historical R0 frontmatter ramp, already documented in previous production extensions. The root sidecar describes R0, while appended evidence describes local R1; this pass preserves that distinction. The four detector advisories are reported without rewriting the old ramp to silence findings. No new craft-floor refusal was observed in the inspected source or captures.

No browser session, rendering, new screenshot, detector run, test suite or remote operation was performed here. Test results in [publication verification](2026-10-05-f07-publication.md) are attributed to that run, including local PostgreSQL/HTTP/Playwright, restore, build, lint and type checking. The parent's fresh scoped `ship` applies only to this publication extension. Source and rasters do not establish physical Telegram Android/iOS, real keyboard behavior, OS text scaling, screen readers, measured contrast, remote PostgreSQL CI, external release, load/performance or the required security scan before a pilot. P-01…P-06, identity creation, scheduling, quota publication and full F07/R1 acceptance remain open.
