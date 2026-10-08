# Конфигурация каталога

Mode: Operate. Primary target: apps/app/src/features/catalog-admin/catalog-admin.tsx.

Extends the existing navy/Manrope/mint/gold workspace, native disclosure and flat lists. Existing project patterns satisfy frontend-references; no external assets, component dependencies or replacement visual world. admin.catalog alone opens a separate work destination; participant catalog remains separate.

First viewport: title, manual refresh, read-only synthetic explanation, exact scope and read timestamp. Each identity presents current terms (including disabled), price/conditions/reservation duration, nearest scheduled terms in closed details, then current quota components. No creation/edit buttons until the write contract exists. Missing current terms/quota/expiry are explicit, enabled does not imply purchase access.

States: loading, empty, configured, only future terms, no quota, unavailable retained dated snapshot, disabled/denied protected-cache clearing, session loss, first-page refresh/next page, late scope response. Fixed layouts reuse 44 px controls; long text wraps, conditions preserve newlines, no new motion.

The subsequent F07 history extension adds a closed native disclosure beneath each identity, at the user's explicit choice. It reads all immutable terms only on opening, keeps a separate dated page and refresh/next actions, labels current/future/superseded in text, and separates the current quota from terms history. Keyboard and Telegram Back close the disclosure; protected caches are cleared on denied/disabled access. Existing flat rows, title/price hierarchy, tokens, type and motion remain. Direction contract: docs/implementation/2026-10-04-f07-catalog-history-slice.md.

Evidence: docs/implementation/2026-10-04-f07-catalog-inspection-slice.md and docs/verification/2026-10-04-f07-catalog-inspection.md. Physical Telegram/screens readers/remote PG, writes, P-decisions and full F07/R1 remain open.

## Direction contract — quota periods, 5 October

THESIS: inspect saved quota periods and remaining old reserves in the existing configuration flow. Each period is a flat textual row; no dashboard metrics or new navigation surface.

OWN-WORLD: inherit navy/Manrope, mint native disclosure/actions, neutral aligned tabular counts, incumbent 16/18 px R1 steps, 44 px controls and gold focus. No new token, font, asset or motion.

STORY: the operator opens «Все периоды квоты» beneath one catalog item, understands past/current/future and live capacity/reserved/used/unoccupied counts, then refreshes or reads older periods. Dates and counter versions do not claim frozen history; old reserves do not vanish at period end.

FIRST VIEWPORT: preserve current terms/quota and closed terms history. Add one closed disclosure beneath them; expanded content begins with its explanation, refresh and timestamp, followed by divided period rows. Loading/error/empty are inline.

FORM: native details and ordered flat list; local extension, no concept seed. Required scope/item key, abort and denial cleanup preserve protected state; Back closes the open disclosure before workspace navigation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Direction contract — immediate publication, 5 October

Extend the same flat catalog row with one explicit inline form for an existing synthetic cosmetic identity. Preserve incumbent tokens, native labels, 44 px actions and restrained hierarchy. No new visual world, asset, motion or navigation surface. Only an exact scoped publication capability and enabled flag expose the action. Future terms block immediate publication.

The form edits title, conditions, price, enabled state and reservation duration, requires a reason and previews the complete intended snapshot before a second explicit confirmation. Explain that existing requests retain their saved terms and quotas stay unchanged. Server confirmation closes the form and manually refreshes saved data. Unknown transport results freeze the intent/key and permit only a manual identical retry. Conflict requires closing and re-reading; access denial clears protected caches. Dirty navigation, keyboard and Telegram Back use the incumbent confirmation mechanism. Direction/contract: docs/implementation/2026-10-05-f07-publication-slice.md.

## Direction contract — future quota publication, 5 October

THESIS: append one explicit future quota period from the existing catalog identity. The user selected a closed form beneath the item, retaining the two independent history disclosures.

OWN-WORLD: incumbent navy/Manrope/mint/gold, flat rows, 44 px controls, separate native labelled date and time inputs and existing catalog-publication CSS. No tokens, assets, dependencies or motion added.

STORY: an exact authorized operator enters start/end in explicitly labelled UTC, capacity and reason, checks the intended snapshot, then confirms. Past reserves remain in their original period; a new quota is not an approval. Unknown results freeze the intent/key, denial clears protected caches, conflict calls for a fresh reading.

FIRST VIEWPORT: preserve scope, read time and current terms/quota. The action follows closed quota history; the expanded form explains the interval and retained reserves before fields, then preview/confirm/close.

FORM: local Operate extension, no concept seed or replacement world. One open form and incumbent dirty/Back guard. Separate publication capability, independently of terms-publication capability.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Direction contract — identity creation, 5 October

THESIS: create one synthetic cosmetic identity before enabling requests; a local extension of the configuration task.

OWN-WORLD: inherit navy/Manrope/mint/gold, flat lists and catalog-publication fields/44px actions; no new tokens, assets, dependencies or motion.

STORY: enter title, conditions, price, optional duration and reason; preview, confirm, receive server confirmation of disabled version 1 without quota. Unknown results freeze one intent; denial clears protected data.

FIRST VIEWPORT: retain title/refresh, scope/read time and list. One closed creation action above the list also serves the empty state. Its inline form explains disabled state before the fields; preview reuses CatalogTerms and a separate confirmation.

FORM: existing Operate inline form, local extension, no concept seed. One open form, incumbent dirty/Telegram Back guard and request abort on scope change. No system replacement.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Direction contract — scheduled terms, 5 October

THESIS: plan one future synthetic cosmetic version while keeping current terms understandable and preserved.

OWN-WORLD: incumbent navy/Manrope/mint/gold, flat configuration rows and inline publication form, existing 16px fields/18px headings/44px actions. No system, asset or motion replacement.

STORY: choose the independent scheduling action, enter UTC start time and terms/reason, inspect the future version with MСК date, confirm; unknown result retains date/body/key. Existing requests keep their terms; future cancellation is explicitly unavailable.

FIRST VIEWPORT: preserve scope/read time, current terms and current quota. Scheduling sits beside immediate publication only when its own capability is allowed. The date field is inside the expanded form, and preview replaces fields before confirmation. A saved scheduled version uses the existing closed disclosure.

FORM: local Operate extension of the incumbent inline form; no concept roll or new world. One open form, guarded dirty/Telegram Back, dated confirmation and protected-cache denial.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Direction contract — future cancellation, 6 October

THESIS: withdraw one scheduled synthetic cosmetic version before its server date, preserving readable evidence and resources.

OWN-WORLD: incumbent navy/Manrope/mint/gold, flat catalog rows and existing catalog-publication form/44px controls. No tokens, assets or motion changes.

STORY: inspect the target and Moscow date, enter a reason, preview, confirm, receive server evidence. Unknown results retain one intent; denied authority clears protected data.

FIRST VIEWPORT: preserve heading/refresh, scope/read time, current terms, future disclosure and quota. The cancellation action sits beneath the scheduled disclosure; the expanded form repeats the target before its reason.

FORM: local Operate inline extension, no concept seed/world replacement. One guarded form, existing dirty/Telegram Back behavior, bounded request abort and late-response suppression.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
