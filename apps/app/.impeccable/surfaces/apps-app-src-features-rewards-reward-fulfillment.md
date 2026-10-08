# Cosmetic fulfillment

Mode: Operate. Target: reward-decisions.tsx in purpose=fulfill, reward-catalog.tsx owner history.

4 October pagination refinement: issuance uses its own reader/scope/purpose-bound cursor. A request issued between pages yields 409 with a named refresh recovery action; 404 hides saved work rows. Refresh retains the first confirmed page on recoverable errors and restarts at the beginning. No tokens/layout/motion change. Evidence: docs/verification/2026-10-04-f06-pagination.md.

## Direction contract

THESIS: An approved synthetic cosmetic request becomes an evidenced ownership record through one explicit issuance confirmation.

OWN-WORLD: Incumbent navy/Manrope, flat divided rows, gold points, mint primary action, native field/checkbox and outlined secondary actions; existing 44/48 px controls and tokens.

STORY: Scan approved requests in the exact permitted scope, choose a recipient/item, inspect saved terms and approval, enter an issuance reason, confirm and issue. Private history and the catalog then show ownership. Unknown outcomes retain the original request for manual replay.

FIRST VIEWPORT: Existing narrow workspace, title and synthetic boundary, manual refresh, scope/timestamp and flat queue rows with recipient, saved terms, original price and preparation action. Selection replaces the rows with the incumbent inline detail form; reason and checkbox precede the mint action. At mobile widths content wraps within the same workspace.

FORM: Retained compact queue and inline confirmation, extending the same RewardDecisions component with purpose=fulfill. No seed, form tournament or card is applicable: new-work § 3 excludes local extensions from the selection script. Quality bar is the incumbent form and the checks below.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Scope and evidence

Extend the incumbent compact queue and inline confirmation. Navy, Manrope, flat rows, gold financial evidence, 44/48 px controls and mint action remain. No new assets, motion, dependencies or design tokens. This is a code-led extension with no approved comp.

Task: an actor with independent exact-scope reward.fulfill issues another participant's approved synthetic cosmetic item. The form shows recipient, original terms/price, approval author/reason/time, then a required issuance reason and renewed checkbox. Issuance records ownership, adds no service privilege and spends no more points/quota. Private owner history labels actual issued ownership; the catalog prevents repurchase with “Уже в коллекции”.

States: populated list/form, loading, empty/no scope, disabled/no authority, stale/offline, pagination, 401/403, 409, unknown/503/lost response and 429. Manual replay retains the original body/key and locks editing/leaving; conflicts preserve text and require reopening. Keyboard and Telegram Back inherit the existing form guard.

Quality bar: readable terms and clear approval-versus-issuance meaning, stable field labels, visible focus, no overflow at 320/360/390/1280 px. Captures: docs/verification/assets/f06-fulfillment/reward-fulfillment. Contract: docs/implementation/2026-10-03-f06-fulfillment-slice.md; ADR-0010. Physical Telegram and device assistive technology remain unverified.
