# F08/F07 recent events: design documentation evidence

Date: 4 October 2026. Scope: ordinary extension of the incumbent Operate notification summary. Applied the shipped `impeccable_documenter.toml` and `reference/document.md`; the extension does not establish a new visual world or warrant regenerating DESIGN.md frontmatter or `.impeccable/design.json`. Only this evidence report is written by this pass.

## Confirmed from source

The slice contract (`docs/implementation/2026-10-04-f08-recent-events-slice.md`, UI paragraph) requires a closed native disclosure and flat semantic event list. `notification-status.tsx:217`–`244` implements that disclosure without an `open` attribute: a labeled summary, limitations before the list, bold neutral event type, textual status and optional allowlisted reason, followed by semantic creation time in Moscow time. It introduces no message text, recipient identifier, delivery assertion or processing-time inference.

The existing summary remains the first content. The new disclosure follows aggregate reasons and appears only when recent events exist. Source at `notification-status.tsx:85`–`127` applies the existing manual query, recoverable retention and revoked/hidden data handling to the entire response; this documentation pass inspected these branches but did not rerun their behavioral tests.

## Five-line incumbent system summary

1. Palette: navy ground, pale ink, muted supporting text, mint disclosure/action emphasis and gold focus inherit `apps/app/src/shared/ui/tokens.css:2`–`9`; event rows introduce no color token.
2. Type: inherited Manrope/Segoe UI body is 15 px (`globals.css:29`–`37`); supporting notes remain 13 px and aggregate counts 18 px (`notification-status.css:11`–`17`, `56`–`61`); event type uses semantic bold body text.
3. Flat-row rule: recent events use thin existing line dividers, 16 px vertical padding and 8 px paragraph separation (`notification-status.css:72`–`84`), continuing DESIGN.md's production flat-list vocabulary.
4. Native-disclosure rule: summary reuses mint text and a 44 px minimum target (`notification-status.css:65`–`71`), with the existing gold 3 px keyboard outline (`globals.css:45`–`48`). Browser disclosure markers remain native semantics.
5. Wrapping rule: event rows and supporting notes allow long content to wrap; the existing header wraps, native scope field fills its column, and no new container, shadow, asset or motion is introduced (`notification-status.css:1`–`40`, `77`–`84`).

## Checked visually

Inspected `docs/verification/assets/f08-recent-events/notification-status/status-320.png` and `status-1280.png` with `view_image`. Both show the document top, existing navy workspace, expanded reason/event disclosures and visible gold focus on the new summary. The 320 px image wraps supporting copy and event content within its column; desktop retains the centered narrow workspace. Captures show expanded review states, while closed-by-default behavior is confirmed from source. Images support these visual observations, not actual Telegram-device behavior.

The scoped reviewer report `docs/verification/2026-10-04-f08-recent-events-ui-review.md` returns `disposition: ship`; it records enlarged-text inspection and parent-reported browser/PostgreSQL checks. Those tests and its third capture were not independently rerun or inspected in this documentation pass.

## Persistence and limits

Compared with DESIGN.md's Colors, Typography, Components and Production Mini App extension, plus PRODUCT.md's existing F08/F07 summary. The new list uses already documented navy/Manrope/mint, native details, flat dividers, readable text state and gold focus. It adds surface behavior, not a reusable new token system. Parent owns the small product/design continuation facts; this pass leaves both files and the sidecar untouched.

Not canonized or repaired: the incumbent R0 frontmatter and runtime 16/18 px observations differ in scope, and PRODUCT.md's earlier F08 statement leaves detailed event inspection open; neither is treated as a new global token or a reason to repair unrelated design history. Source and capture checks found no new scoped visual defect requiring code changes.

Commands used: PowerShell `Get-Content` for the agent/reference, artifact, contract, reviewer, PRODUCT.md, DESIGN.md and token/global styles; `rg -n` for incumbent font/focus/action and F08 references. All reads returned exit code 0. `view_image` opened both named captures successfully. No code mutation, dependency installation, build or behavioral test was performed by this pass.

Physical Telegram WebView on Android/iOS, screen readers, external hosting, P-01…P-06 and complete F08/F07/R1 acceptance remain unverified or open. This report records a local synthetic UI extension and preserves those boundaries.
