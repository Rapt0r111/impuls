---
name: "Импульс"
description: "Technological research centre: interactive Mini App demonstration and readable project documentation."
colors:
  bg: "#08151c"
  panel: "#11262f"
  line: "#29404a"
  ink: "#edf5f2"
  muted: "#acc0c6"
  mint: "#70e1c2"
  gold: "#f0ca7a"
  paper: "#f1f3ee"
  paperink: "#182c32"
  screen: "#0a1921"
  button-hover: "#203c47"
  mint-hover: "#a1efd9"
  field-border: "#45616b"
  badge-bg: "#1c403b"
  badge-ink: "#99eacf"
  badge-amber-bg: "#3b3323"
  badge-muted-bg: "#233944"
  mission-bg: "#17332f"
  reading-muted: "#50636a"
  error: "#ffb9a9"
typography:
  display:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "clamp(54px, 5.6vw, 80px)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  reading:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.65
  button:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.65
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  badge: "5px"
  filter: "7px"
  field: "8px"
  button: "9px"
  status: "10px"
  card: "12px"
  dialog: "16px"
  phone-mobile: "21px"
  phone: "28px"
spacing:
  icon-gap: "8px"
  action-gap: "10px"
  row-gap: "12px"
  card-padding: "14px"
  mission-padding: "15px"
  section-gap: "24px"
  desktop-gutter: "36px"
components:
  button-primary:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.bg}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.mint-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
  report-field:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px"
    width: "100%"
  status-badge:
    backgroundColor: "{colors.badge-bg}"
    textColor: "{colors.badge-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  request-card:
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px"
  team-progress:
    backgroundColor: "{colors.mission-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "15px"
---

# Design System: Импульс

Локальный эксплуатационный срез от 05.10.2026 (000028/ADR-0020) добавляет только worker CLI aggregate, heartbeat, stop helper и runbook. Новых пользовательских экранов/HTTP API, визуальных или motion изменений нет. Worker status доступен отдельной service role и не заменяет exact-scope UI уведомлений или подтверждённую историю возврата. Контракт: docs/implementation/2026-10-05-worker-observability-slice.md; результаты: docs/verification/2026-10-05-worker-observability.md.

Локальное продолжение F06 от 05.10.2026 меняет только пояснения существующей истории/подтверждения: возврат подтверждает серверный expired, automatic source обозначен «Обработчик» с фиксированным именем, человеческое решение сохраняет «Автор (текущее имя)». Нет нового экрана, CSS, шрифтов, токенов, motion или композиции. Контракт: docs/implementation/2026-10-05-f06-automatic-expiry-slice.md; измеренные свидетельства: docs/verification/2026-10-05-f06-automatic-expiry.md. Физический Telegram и системное масштабирование этим срезом не проверены.

## Overview

**Creative North Star: "Technological research centre"**

The user-selected direction is a technological research centre with dark navy surfaces and turquoise accents. The implemented presentation uses a precise, calm console treatment: compact task rows, outlined controls, line icons and visible numerical progress. Warm gold distinguishes rewards and balances.

A mineral-white reading area gives the detailed proposal a separate, comfortable reading surface. This document records the implemented offline presentation, not an official identity or an approved production design system. It was extracted from `outputs/impuls-presentation.html`, `work/presentation.html` and `work/app.js` after the visual direction was approved.

**Key Characteristics:**

- Navy surfaces, turquoise actions and warm gold reward values.
- Embedded Manrope with compact interface labels and generous reading leading.
- Thin dividers and tonal layers rather than raised cards.
- A working phone-shaped demonstration beside the presentation narrative.
- Readable light documentation, responsive navigation and reduced-motion support.

## Colors

Cool navy and turquoise establish the console; gold gives reward information a distinct visual role, while the reading area uses mineral-white and dark ink.

### Primary

- **Turquoise (`mint`)** identifies primary actions, active controls, progress, icons and selected navigation. Its lighter hover sibling is used on primary buttons.

### Secondary

- **Warm gold (`gold`)** marks balances, reward amounts, achievements and keyboard focus. It is also used for pending-status text.
- **Soft coral (`error`)** identifies inline form errors.

### Neutral

- **Navy base (`bg`)** carries the presentation background; **navy panel (`panel`)** carries secondary controls.
- **Deep screen (`screen`)** is the phone canvas and form-field fill. **Slate line (`line`)** separates rows and defines control boundaries.
- **Pale ink (`ink`)** is primary text on dark surfaces; **mist text (`muted`)** is supporting information.
- **Mineral paper (`paper`)** and **reading ink (`paperink`)** carry the long-form specification. **Reading muted (`reading-muted`)** is supporting prose and the contents list.
- Status backgrounds distinguish ordinary, pending and muted labels. Team progress uses a restrained green-navy surface.

**The Meaningful Accent Rule.** Use turquoise for action or progress and gold for reward information; keep text labels alongside state colors.

## Typography

**Display and Body Font:** Manrope, with Segoe UI and sans-serif fallbacks. The shipped HTML embeds the font for offline use. **Code Font:** Consolas with a monospace fallback.

The hierarchy is defined by role rather than a mathematical ratio. Tight display spacing establishes the presentation title; compact app text and a loose reading line-height support the two densities.

- **Display:** hero statement; the desktop clamp is overridden at the observed responsive breakpoints.
- **Headline:** specification title. The smaller overview heading is 27px.
- **Title:** app screen headings. Task details use 22px; app section headings use 16px.
- **Body:** general page text. The introductory paragraph uses 17px with 1.8 leading; app paragraphs use 13px.
- **Reading:** chapter prose, limited to 78ch. On small screens it becomes 13px.
- **Label:** app navigation, metadata and badges. Buttons use the dedicated button role.
- **Numerals:** balances use 26px at weight 650 with tabular numerals; the level value uses 42px at weight 650.

## Layout

The centered page container has a maximum width of 1260px and desktop side gutters of 36px. The hero uses a flexible narrative column, a 422px demonstration column and a 76px gap. The phone's scrollable screen is 558px high with 21px 20px 24px padding. Its header and bottom navigation remain outside that scrolling region.

The specification uses a sticky 245px contents column and a flexible reading column, separated by 48px. Chapters use native expandable details; tables scroll horizontally when needed.

- At **1050px and below**, the demo becomes 390px wide, hero gap 36px, gutters 26px, and contents column 200px.
- At **780px and below**, the hero stacks, the demo is capped at 440px, the four-step flow becomes two columns, and the contents list becomes a select control. The desktop walkthrough is hidden.
- At **420px and below**, gutters become 18px, phone corners become 21px, and the app screen uses 18px 15px padding and 530px height.
- Presentation mode hides the reading area, flow and footer; on small screens it also hides the pitch and caps the app screen at `min(62vh, 558px)`.
- Print uses A4 with 17mm margins, white paper, expanded chapters and a cover with demo screenshots. Interactive page chrome is omitted.

The recurring rhythm uses 8–14px control gaps, 12–18px row padding and larger 24–36px section spacing. These are observed values, not a new universal spacing scale.

## Elevation & Depth

The main interface uses tonal layering, thin borders and dividers. Resting cards and the phone have no box shadow. The confirmation dialog uses a dark backdrop; the reward overlay uses an almost opaque navy fill. Only transient toast feedback uses a diffuse shadow (`0 8px 30px #0003`).

**The Flat Surface Rule.** Preserve flat resting surfaces and use borders or tone to establish grouping; reserve the observed shadow treatment for toast feedback.

## Shapes

Controls use softly squared corners: badge, filter, field and button radii are distinct in the frontmatter. Status containers and achievements use the status radius; requests, avatars and the team-progress block use the card radius. The phone silhouette is substantially rounder, and the reward emblem is circular.

Icons are inline outline SVGs, normally 20px square, with 1.7px strokes and rounded caps and joins. Larger achievement and reward icons preserve that line-based vocabulary. Task and reward lists rely on horizontal dividers instead of individually boxed cards.

## Components

Local F07 extension, 6 October: a closed “Отменить будущие условия” action appears only for a saved scheduled version and its independent capability. The incumbent inline form shows the immutable target with Moscow date, a required reason, preview and a separate confirmation; unknown/429/503 results retain one intent, 409/422 require rereading, denial clears protected caches and Back uses the existing dirty guard. Cancellation confirmation is server evidence; no client clock decides eligibility. Terms history labels cancelled future versions and the audit shows their original conditions. Publication preview defers the new number to the server because cancelled numbers remain consumed. Existing catalog-publication CSS, 44px controls, navy/Manrope/mint/gold and reduced-motion behavior are retained; no tokens/assets/motion are added. Evidence: docs/verification/2026-10-06-f07-schedule-cancellation.md.

### Buttons

Compact, explicit actions with a minimum standard height of 44px. Primary buttons use turquoise and navy; secondary buttons use navy panel and pale ink; quiet buttons use transparent fill and the shared border. Small buttons use 8px 11px padding and 12px type. Hover changes fill over 180ms. Disabled buttons use 0.5 opacity and the not-allowed cursor.

Buttons, links, summaries, inputs and textareas receive a 3px gold focus-visible outline with a 3px offset. The existing native select retains its browser focus treatment.

### Chips & Priority Badges

Status badges pair text with green, amber or muted tones. Priority tags use dedicated subtle tones:

- **`priority-tag.critical`** (`#3d1e1e` fill with `#ffb9a9` coral text) for urgent tasks requiring immediate attention;
- **`priority-tag.high`** (`#382d1c` fill with `var(--gold)` text) for high-priority projects;
- **`priority-tag.normal`** (`#182e38` fill with `var(--muted)` text) for standard routine tasks.
  Task filters are separate 34px-minimum-height buttons; selected filters use turquoise and navy.

### Cards / Containers

Request containers have a thin slate border and card radius. Task rows remain flat with 15px vertical padding and a lower divider. Proposal cards (`.prop-card`) use an elevated panel fill with clear approval/rejection actions.
Achievement tiles use a compact three-column grid; locked tiles have reduced opacity (52%).

### Competency Matrix & Recognition

- **Skill Matrix (`.skills-box`):** A compact slate panel with individual progress bars showing percentage mastery across key disciplines (Web Development, Research & Analysis, Regulations).
- **Kudos Box (`.kudos-box`):** Horizontal peer appreciation container highlighting received/sent counts and providing a direct button to send appreciation to teammates.
- **Multi-Module Grid (`.modules-grid`):** A three-column status strip inside the team mission block showing real-time task completion across the three scientific company branches.
- **Season Tabs (`.season-tabs`):** Bordered segmented control switching between active monthly season and archived Hall of Fame.

### Operational Flexibility

- **Reward Inputs (`.reward-inputs`):** Two-column numerical grid allowing commanders to directly edit base XP and Coins during task review or upon new task creation.
- **Available Badge (`.badge.available`):** Cyan badge identifying open voluntary pool tasks that any soldier can take into work directly.
- **Task Assignment Dialog (`#create-task-dialog`):** Modular dialog enabling commanders to set custom titles, categories, priorities, deadlines, and arbitrary reward funds (XP/Coins).

### Inputs / Fields

Labels use muted 11px text above dark fields with a 1px border and field radius. Textareas have an 83px minimum height and vertical resizing; selects have a 42px minimum height. Turquoise marks the text caret. Validation messages use coral text and alert semantics.

### Navigation

Role selection uses a bordered segmented control with turquoise selected state and `aria-pressed`. The phone has five equal icon-and-label destinations; the active item changes to turquoise and adds a short underline. The documentation uses a sticky contents list on wide screens and a labeled select on narrow screens.

### Confirmed-result feedback

A focused overlay reports the awarded XP and points after acceptance. Entry animates for 650ms using `cubic-bezier(.16, 1, .3, 1)`, rising 22px from scale 0.93 with a 3px blur. Progress width transitions over 700ms with the same easing. The operating-system reduced-motion preference and the visible effects switch disable animations, transitions and smooth scrolling.

## Do's and Don'ts

### Do:

- **Do** preserve the approved navy and turquoise research-centre direction.
- **Do** use gold to distinguish rewards and keep labels beside status colors.
- **Do** retain flat rows, thin dividers and softly squared controls.
- **Do** preserve embedded typography and self-contained assets for offline viewing.
- **Do** retain keyboard focus, responsive reading navigation and reduced-motion behavior.

### Don't:

- **Don't** treat the presentation styling as an official military identity or production approval.
- **Don't** add elevation to every list item; the implemented hierarchy depends on tone and dividers.
- **Don't** make color or animation the only way to understand progress or state.
- **Don't** remove the light reading surface or constrain long tables inside the phone demo.

## Production Mini App extension

The 5 October future quota publication extension inherits the catalog's existing flat rows, navy/Manrope/mint/gold tokens and native 44 px controls. The user selected a closed inline form beneath a catalog identity: separately labelled UTC date and time fields, capacity, mandatory reason, snapshot preview and separate confirmation. Existing terms/quota/history retain their positions; a new period does not rewrite old reserves. Contract/evidence: docs/implementation/2026-10-05-f07-quota-publication-slice.md and docs/verification/2026-10-05-f07-quota-publication.md. This records the local extension without changing the visual system.

The 4 October F08/F07 summary inherits the Operate workspace and existing audit/list vocabulary: navy, Manrope, neutral tabular counts, mint actions, flat dividers, a native exact-scope select and optional reason disclosure. The heading and refresh wrap at narrow widths; four authorized work destinations form two equal columns with incumbent 44 px targets. The first content explains simulation without Telegram sending; a dated confirmed snapshot survives recoverable errors, while revoked/disabled access removes cached counts. No tokens, font, assets, decorative animation or dependencies change. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-notifications-notification-status-tsx.md`; contract/evidence: `docs/implementation/2026-10-04-f08-status-slice.md`, `docs/verification/2026-10-04-f08-status.md`. Physical Telegram and full F08/R1 acceptance remain unverified; prior paragraphs describe their historical slices.

The 4 October F06 expiry continuation preserves the incumbent Operate lists and inline confirmation. Confirmation states the explicitly configured duration in seconds; saved request/history/decision/audit evidence shows the immutable deadline in Moscow time or explicitly says it is unset. A pending deadline never claims completed return: the copy names the required manual decision and absence of automatic processing. The existing decision selector gains “Истечение срока” only when a deadline exists; server-confirmed expiry names the returned points/place. Known 409 messages distinguish a deadline not reached from approval past it. No tokens, CSS, layout world, assets or motion change. Contract: `docs/implementation/2026-10-04-f06-expiry-slice.md`; verification: `docs/verification/2026-10-04-f06-expiry.md`. Devices and complete F06/R1 acceptance remain unverified.

The 4 October F06 catalog pagination continuation preserves the incumbent Operate list, navy/Manrope, mint controls, gold points and flat dividers. The existing inline alert names an outdated catalog/request page and the existing refresh action. Refresh trims to the first confirmed page and preserves it during recoverable failure; missing catalog access removes cached rows while the independent personal request section remains. Further paging and fresh reservations are disabled until a successful refresh. No CSS, tokens, type, assets or motion change. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-rewards-reward-catalog-tsx.md`; contract and evidence: `docs/implementation/2026-10-04-f06-catalog-pagination-slice.md`, `docs/verification/2026-10-04-f06-catalog-pagination.md`. Physical Telegram and complete F06/R1 acceptance remain unverified.

The 4 October F06 pagination refinement retains the incumbent Operate lists, navy/Manrope, mint actions, gold points and existing target sizes. An inline alert names a changed or outdated page and points to the existing refresh action. Refresh keeps the first confirmed page during recoverable failures, discards older paging anchors and returns to the start; unavailable work authority hides cached rows. Draft forms, unknown mutation outcomes and navigation guards retain their behavior. No CSS, tokens, imagery, dependencies or motion change. Contract and browser evidence: `docs/implementation/2026-10-04-f06-pagination-slice.md`, `docs/verification/2026-10-04-f06-pagination.md`.

The 4 October F06/F07 reward audit extends the incumbent Operate list and native evidence disclosure. Five textual action labels distinguish reservation, cancellation, approval, rejection and issuance. Each reward row names the saved item and explicitly current recipient; the disclosure shows historical conditions/price/version/quota period, the recorded status/movements and request/item/ownership identifiers. Task titles remain labelled current. Version labels distinguish tasks from requests; issuance shows no invented financial delta. The existing navy/Manrope/mint/gold, flat dividers, filters, keyboard focus and 44 px controls remain, with long names/conditions wrapping at 320 px. No CSS, tokens, fonts, assets, motion or dependencies change. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-audit-audit-log-tsx.md`; contract and evidence: `docs/implementation/2026-10-04-f06-reward-audit-slice.md`, `docs/verification/2026-10-04-f06-reward-audit.md`. Physical Telegram and complete F06/F07/R1 acceptance remain outside this evidence.

The 2 October F07 audit reader uses the existing navy/Manrope world, native exact-scope/action selects, flat divided decisions and inline saved evidence, with current names distinguished from historical values. In response to the user's screenshot of uneven buttons, the authorized workspace now groups four equally sized personal destinations and one to three authorized work destinations in a compact navigation surface; concise visible labels, a single selected mint state, 44 px targets and the incumbent gold focus preserve familiar operation. Confirmed access is supporting text, the identity remains legible, full permissions disclose through native details, and guarded logout is quiet in the header. Audit refresh sits beside its title as a short action. No tokens, fonts, assets, icon library or decorative motion change; the R0 frontmatter and sidecar remain intact. Direction and evidence: `apps/app/.impeccable/surfaces/apps-app-src-features-tasks-workspace-navigation.md`, `docs/implementation/2026-10-02-workspace-navigation-refinement.md`, `docs/verification/2026-10-02-f07-audit.md`. This is a local synthetic extension, not remote release or physical Telegram acceptance.

The 2 October Telegram bridge refinement preserves the existing navy tokens and product layout. Native header/background/bottom bar are reapplied from `--color-bg` on Telegram theme changes, while browser controls declare the existing dark color scheme. The shell consumes validated device and content safe areas on all four sides and stable viewport height, with standard env/100dvh fallbacks. Native Back closes forms/details before expanded panels and workspace sections, using the existing unsaved-text confirmation. No replacement theme, visual asset, animation or dependency is introduced. Browser checks cover 320/360/390/1280 px, theme/viewport changes, scrolling and navigation; physical keyboard/fullscreen/safe-area behavior on Android/iOS remains unverified. Contract: `docs/implementation/2026-10-02-telegram-bridge-slice.md`; evidence: `docs/verification/2026-10-02-telegram-bridge.md`.

The 2 October task edit/cancel extension preserves the existing Operate surface. An inline form beneath one selected row uses the incumbent labels, native UTC date/time input, fields, mint confirmation and outlined close action. It shows task version, assignee and separate synthetic funds; each change needs a reason. Pending or unknown results freeze fields and navigation, manual replay keeps its body/key, and a conflict requires explicit adoption of the current version after comparison. The timeline shows edit/cancel labels, reason and saved edited conditions. No tokens, fonts, motion or external components change. Surface direction: `apps/app/.impeccable/surfaces/apps-app-src-features-task-management-task-change-form.md`; verification: `docs/verification/2026-10-02-f03-edit-cancel.md`.

The observations above describe the standalone presentation (R0). For the R1/R2 Telegram Mini App, the binding screen and token contract is `IMPLEMENTATION_PLAN.md` § 7. It keeps the navy, turquoise, gold, Manrope and flat-list vocabulary, then adds purposeful blue data and coral error accents. Production components in Next.js use Tailwind v4 tokens, adapted shadcn/ui with Radix behavior, one Phosphor icon family, and Motion only for state feedback. The presentation's role switcher, phone frame, document reading surface, and inline demo SVGs are not production UI requirements. Any production design change is made in the plan and reflected here before implementation.

The initial F01 access screen uses the production type scale from § 7: 12 px supporting text, 15–16 px body and brand, 18 px confirmed identity, and a 30–40 px access heading across phone widths. Its status line and dot carry a text label, and its single action is at least 48 px high. `apps/app/src/shared/ui/tokens.css` contains its color tokens; `apps/app/.impeccable/surfaces/apps-app-src-app-mini-page-tsx.md` records the screen direction. This documents one in-progress screen, not a completed R1 interface.

The first F03 read-only section compresses the confirmed-access heading so the task list appears in the first phone viewport. Tasks use flat rows separated by a line; turquoise marks a selected row, gold marks the XP/points fund, and the criteria open in one inset panel. Status remains text, the filter and close actions have 44 px targets, and long synthetic names wrap at 320 px. Browser screenshots at 320/360/390 px check this layout with synthetic API responses; they do not verify Telegram WebView or the task mutation flow.

The 30 September F03 extension adds a report beneath the criteria and rule version in that same panel. Its label and textarea use the production 16 px step from § 7; the full-width mint action has a 48 px minimum height. A text counter has 12 px clearance above the keyboard-focus outline. Report errors are coral, confirmed submission is mint, and the copy separates submission from accrual. Unsaved text stays in memory during recoverable errors, with a guarded exit and Telegram closing confirmation where supported. No tokens, fonts or visual-world decisions change. The four synthetic browser captures and scoped review are recorded in `docs/verification/2026-09-30-f03-ui-review.md`; physical Telegram WebView behavior remains unverified.

ADR-0002 fixes F01 session transport in Telegram Web. The existing access screen and its session retry state remain the visual contract; browser verification now includes a cross-site HTTPS iframe. No layout, token or typography changes are required by this transport fix.

The subsequent local F03/F04 extension keeps the same flat queue and inset report panel. Synthetic acceptance shows the recipient, separate XP/points funds and task/rule versions before a checkbox, required reason and 48 px confirmation action. Unknown results freeze the decision and replay the same request; guarded navigation protects the draft. The participant's journal shows confirmed lifetime XP, available/reserved points and timestamp above immutable currency rows with task, date, rule, season and reason. Gold marks XP, points retain the neutral text color; balances inherit the existing runtime 18 px step. Loading, empty, unavailable and revoked-session states use the incumbent text feedback. No system tokens, R0 observations or visual-world decisions change; `.impeccable/design.json` remains the incumbent baseline. This documents local synthetic behavior, not approved economics, deployment or Telegram device acceptance. Evidence: `docs/verification/2026-09-30-f03-acceptance.md` and `2026-09-30-f03-acceptance-ui-review.md` in that directory.

The local F02/F03 task-management screen extends the same navy surface with a compact creation form, exact-scope selector, synthetic rule selector, title, criteria, category code, priority, UTC deadline and separate integer XP/points funds. A flat task list shows status, scope, rule version and funds; each draft offers a separate assignee selection and assignment action. Permission options come from the server, and retry after an uncertain response preserves the same request body and idempotency key. Field labels and controls follow the existing 16 px input text and 44 px action target; text messages cover loading, empty, unavailable, conflict, disabled rules and revoked access. The screen carries no new tokens or policy meaning for categories or funds. Local browser verification passed at 320/360/390/1280 px with reduced motion, keyboard activation and synthetic large text; the slice has not been deployed or checked in physical Telegram WebView. Evidence: `docs/verification/2026-09-30-f03-task-management.md`.

The next F03 extension adds an inline report/review history below the existing report form, collapsed initially so submission remains the primary task. The disclosure uses the existing outlined control and keyboard focus. Flat rows show attempt number and textual decision, report in ink, reviewer/reason/time in muted text, and separate accepted funds in gold. Older attempts load on demand; refresh and paging preserve the report draft. Unavailable/offline feedback retains confirmed records and read time, while 401/403/404 hide protected history. No tokens, fonts, motion or external components change. The surface brief is `apps/app/.impeccable/surfaces/apps-app-src-features-tasks-task-history-tsx.md`; evidence and device limits are in `docs/verification/2026-09-30-f03-report-history.md`.

The subsequent F03 mutation-limit extension uses the existing inline alert in the participant report, reviewer decision and management forms. HTTP 429 displays the server's Retry-After in seconds, retains the text, immutable request body and key, and offers the existing manual repeat control. A throttled replay after a lost response keeps the same intent until its result is confirmed. There is no new surface, timer, automatic retry, token, typography or motion change. Local browser scenarios cover this feedback and preservation; physical Telegram devices remain unverified. Evidence: `docs/verification/2026-09-30-f03-mutation-limit.md`.

The 1 October lifecycle extension reuses that inline disclosure, flat event rows and existing 44 px controls. Event headings name the transition and task version; dates and actors are supporting text, separate XP/points remain gold. The migration snapshot explicitly states that earlier transitions were not recorded. Task timeline and report history remain separate disclosures, preserving the report or review draft during paging and refresh. A view-only user reaches the scoped list through “Задачи и история”; creation/assignment controls still require their own permissions. Loading, empty, offline/unavailable and revoked/hidden states follow the existing feedback. No visual-world, font, token, dependency or motion change. Surface direction and verification: `apps/app/.impeccable/surfaces/apps-app-src-features-tasks-task-timeline-tsx.md` and `docs/verification/2026-10-01-f03-lifecycle.md`; physical Telegram devices remain unverified.

The 2 October local F04 correction extension preserves the journal's navy surface, Manrope, flat rows, outlined disclosure and inset review form. Separate exact-scope `ledger.correct` authority exposes the synthetic correction flow, whose server flag is off by default. Selecting an award replaces the list with one inline form showing the recipient, inverse XP/points, resulting balance, original month, rule/balance versions, required reason and confirmation checkbox before the existing 48 px mint action. Insufficient funds disable a fresh correction; both initial and refreshed previews explain insufficiency without negative projections. Guarded drafts retain the reason; a conflict requires explicit adoption of the refreshed balance and renewed confirmation, while an unknown outcome retains its immutable request for manual replay. The personal journal shows signed amounts, correction reason, actor and original-entry reference. No tokens, fonts, motion, assets or dependencies change. Six browser captures cover the form at 320/360/390/1280 px and both insufficient-balance previews at 320 px. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-ledger-ledger-corrections-tsx.md`; evidence: [F04 correction verification](docs/verification/2026-10-02-f04-corrections.md). Physical Telegram, external deployment, published season snapshots and P-04 remain outside this evidence; F04/R1 are incomplete.

The 2 October local F05 ranking extends the same authorized workspace with native scope/month controls on the existing navy background (`--color-bg`, 16 px text, 44 px minimum height), an inline own-XP result and a semantic rank/name/XP table. Navy, Manrope, mint selection, gold XP and flat divided rows remain; long synthetic aliases wrap while numerical columns stay aligned. The own row carries a text label and panel tone, equal XP shares a place, and zero XP appears only in the private result. Loading, unavailable/offline, changed-page, disabled and revoked-access feedback reuse the existing controls and text states; refresh restarts changed pagination. The timestamp labels all months as current journal calculations. Eight browser captures cover populated 320/360/390/1280 px and changed, empty, no-scope and disabled 320 px states; the scoped finish review returned ship, and the subsequent field-background correction was confirmed resolved after recapture. No visual-world, token, font, motion, asset or dependency change is introduced; the incumbent design sidecar is preserved. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-ranking-leaderboard-tsx.md`; evidence: [F05 ranking verification](docs/verification/2026-10-02-f05-ranking.md). Physical Telegram and screen readers remain unverified; published season snapshots, P-05 and F05/R1 completion remain open.

The 2 October local F05 profile extends the same Operate workspace with manual refresh, gold lifetime XP and server timestamp, a level with labeled native progress and remaining XP, then the source of First Result. Manrope, navy/ink/mint/gold, flat divided sections and existing 44 px controls remain; section subheads use the observed runtime 18 px step without changing the R0 token ramp. Long synthetic titles wrap, while empty, disabled, unconfigured and corrected-source states explain their meaning in text. Corrected historical evidence does not claim an active achievement; the cosmetic award adds no XP or points. Eight captures at 320/360/390/1280 px and four alternate 320 px states support the scoped review's ship disposition. No tokens, fonts, motion, assets or dependencies change; the incumbent sidecar is preserved. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-profile-participant-profile-tsx.md`; evidence: [F05 profile UI review](docs/verification/2026-10-02-f05-profile-ui-review.md). Physical Telegram, screen readers, real pilot, remote release and P-04/P-05 policy remain unverified or unresolved; F05/R1 completion is not established.

The 4 October F08 slice changes only server processing and a local operator CLI. It adds no user screen or notification settings. Existing task/reward UI continues to show saved domain results; a simulation receipt does not imply a Telegram message or automatic reservation expiry. Worker output contains aggregate counts and a simulation label, without recipient IDs, titles or reasons. Administrator delivery UI needs a separate state specification and review before implementation. Contract: docs/implementation/2026-10-04-f08-simulation-worker-slice.md; evidence: docs/verification/2026-10-04-f08-simulation-worker.md.

The subsequent F08 watch continuation preserves this UI boundary. Its operator lifecycle output is limited to watching/stopped, nonempty batch counts and neutral failure codes; idle polling is silent. No delivery badge, notification preference or automatic expiry is implied. Contract: docs/implementation/2026-10-04-f08-watch-slice.md; ADR-0013; evidence: docs/verification/2026-10-04-f08-watch.md.

The 4 October F08/F07 recent-event extension adds a closed native disclosure after the existing counts and reasons, with flat ordered rows for kind, textual simulation state/error and creation time. It reuses Manrope, navy, mint disclosure and existing focus styling; no palette, ramp, motion or dependency changes. The bounded list explicitly distinguishes creation from delivery and shares the existing retained-error/protected-cache behavior. Contract: docs/implementation/2026-10-04-f08-recent-events-slice.md; evidence: docs/verification/2026-10-04-f08-recent-events.md. Physical Telegram and full F08/F07/R1 remain unverified.

The 4 October F07 catalog inspection extends the Operate workspace with a separate admin.catalog destination. Effective cosmetic terms use flat rows, gold price and ink conditions, with nearest future terms in the incumbent native disclosure. Current capacity/reserved/used/available reuse aligned counts; missing terms, duration or quota are explicit. Scope, manual refresh, first-page restart and dated error retention preserve existing patterns. Navy/Manrope/mint/gold, 16/18 px runtime steps and 44 px controls are unchanged; no motion, tokens, assets or dependencies added. Evidence: docs/verification/2026-10-04-f07-catalog-inspection.md. This is inspection only, not catalog mutation or full F07 acceptance.

The subsequent 4 October F07 terms-history extension keeps the user's chosen closed native disclosure beneath each catalog identity, after current terms and the separate current quota. Opening loads flat saved-version rows with textual current/future/superseded states, ink conditions, gold tabular price and muted Moscow dates; history has its own read timestamp, manual refresh and next-version action. Recoverable failure retains dated confirmed rows, while changed or denied pages hide protected content; the existing Back hook closes the disclosure. The seven browser captures cover 320/360/390/1280 px, enlarged text, retained 503 and empty history. Navy/Manrope/mint/gold, runtime type steps, focus and 44 px controls remain; no tokens, fonts, assets, motion or dependencies change, and the incumbent sidecar is preserved. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`; contract: `docs/implementation/2026-10-04-f07-catalog-history-slice.md`; evidence: `docs/verification/2026-10-04-f07-catalog-history.md`, `docs/verification/2026-10-04-f07-catalog-history-ui-review.md`, `docs/verification/2026-10-04-f07-catalog-history-design-documentation.md`. This is conditions history, not quota history or catalog publication; physical Telegram, screen readers and full F07/R1 acceptance remain unverified.

The 5 October F07 quota-period extension keeps the incumbent Operate configuration, current quota and separate terms history, adding a closed native disclosure beneath them. Opening reads flat period rows with textual past/current/future states, muted Moscow boundaries and neutral tabular capacity/reserved/used/unoccupied counts. Its explanation and separate read timestamp state that counters remain live, old reserves can survive period end and unoccupied places do not establish new-request eligibility. Manual refresh returns to the first page; recoverable failure retains dated confirmed rows, changed/denied pages hide protected content, and the existing Back hook closes the disclosure. Eight captures cover 320/360/390/1280 px, enlarged text, a past reserve, retained 503 and empty periods; the scoped review returns ship. Navy/Manrope/mint/gold, incumbent runtime 16/18 px steps, 44 px controls, focus and flat dividers remain; the CSS only shares existing list rules with period rows. No token, font, asset, motion or dependency changes, and the incumbent frontmatter and sidecar are preserved. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`; contract: `docs/implementation/2026-10-05-f07-quota-history-slice.md`; evidence: `docs/verification/2026-10-05-f07-quota-history.md`, `docs/verification/2026-10-05-f07-quota-history-ui-review.md`, `docs/verification/2026-10-05-f07-quota-history-design-documentation.md`. Physical Telegram, screen readers, measured contrast, catalog publication/writes, P-decisions and complete F07/R1 acceptance remain open.

The 5 October F07 immediate-publication extension preserves the incumbent Operate catalog and adds one inline form for an existing synthetic cosmetic identity, followed by the complete intended terms and reason before explicit confirmation. It reuses navy/Manrope, gold tabular price, muted Moscow dates, 16 px fields, 18 px term headings, native checkbox, flat dividers, 44 px actions and gold focus. The form explains that existing requests retain their saved terms and quotas stay unchanged; unknown outcomes freeze the intent for identical manual retry, conflicts require closing and re-reading, and denial clears protected catalog caches. The central audit reuses the saved-terms component with explicit previous/new versions and publication reason. No new world, token, font, asset, motion or dependency is introduced; the R0 frontmatter and root sidecar remain intact. Ten supplied captures were compared in the documentation pass, alongside the parent's fresh scoped finish review with ship disposition. Direction: `apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md`; contract: `docs/implementation/2026-10-05-f07-publication-slice.md`; evidence: `docs/verification/2026-10-05-f07-publication.md`, `docs/verification/2026-10-05-f07-publication-design-documentation.md`. Physical Telegram, screen readers, measured contrast, owner P-decisions, scheduling/quota writes and full F07/R1 acceptance remain open.

## Локальная адаптация рабочего UI, 6 октября 2026

Адаптация рабочего UI от 6 октября сохраняет Operate/navy/Manrope/mint/gold и пять личных разделов с отдельными служебными действиями. При крупном тексте личные кнопки переносятся, служебные получают отдельные строки по содержимому, фонд задачи переходит ниже читаемого названия. Header, detail-values, ledger-values и заголовки управления допускают перенос; длинные имена наследуют overflow-wrap. Авторские размеры, тексты, права, handlers, dirty/Back, токены и sidecar сохраняются. Локальная матрица normal/24 px/double проверяет 138 сочетаний на 320/360/390/1280 px, inset формы и lateral safe areas, плюс 52 прежних UI-сценария; review ограничен этим срезом. Контракт: docs/implementation/2026-10-06-workspace-reflow-slice.md; evidence: docs/verification/2026-10-06-workspace-reflow.md. Физический Telegram, системный текст/zoom, screen reader, OS picker, полный contrast/state audit и приёмка R1 остаются непроверенными. Ниже сохранены исторические записи F07.

## Локальное продолжение F07: создание позиции, 5 октября 2026

Существующий рабочий каталог дополняется закрытой формой над списком, доступной при canCreate также в пустой области. Название, условия, цена, необязательный срок и основание используют прежний catalog-publication паттерн; preview показывает выключенную версию 1 и требует отдельного подтверждения. Пояснение отделяет создание от включения условий и квоты. Unknown результат сохраняет intent/key; отказ доступа очищает protected данные, смена области/Back используют существующую dirty guard. Длинные неразрывные строки preview переносятся. Журнал действий показывает первоначальные условия, не текущие. Токены/типографика/палитра/motion и R0 сохраняются. Контракт: docs/implementation/2026-10-05-f07-creation-slice.md; evidence: docs/verification/2026-10-05-f07-creation.md. Физический Telegram, OS scaling/screen reader и полная приёмка F07/R1 не подтверждены.

Локальное расширение F07 от 5 октября для будущих условий синтетической косметики использует прежнюю inline форму: отдельное действие планирования, подписанный UTC ввод и полный preview с датой МСК перед подтверждением. Текущие условия/квота остаются выше формы, сохранённая будущая версия — в закрытом native disclosure; текст объясняет сохранение условий существующих заявок и недоступную отмену. Navy/Manrope/mint/gold, плоские строки, 16 px поля, 18 px заголовки, 44 px действия и gold focus сохраняются без новых токенов, ассетов или motion; frontmatter и incumbent sidecar не меняются. Сопоставлены только авторитетные form-320 и preview-1280 captures. Direction: apps/app/.impeccable/surfaces/apps-app-src-features-catalog-admin-catalog-admin-tsx.md; evidence: docs/verification/2026-10-05-f07-scheduling-design-documentation.md. Предсуществующие различия R0 и runtime не нормализованы; физический Telegram, screen reader, P-решения и полная приёмка F07/R1 этим проходом не подтверждены.

## Обновление визуального слоя Mini App, 9 октября 2026

По запросу пользователя («практично, читаемо, удобно для телефона», затем «современно и живо, цвета можно менять») мобильный интерфейс получил единый визуальный слой. Макет из шести экранов (Главная, Задачи, Задача и отчёт, Рейтинг, Поощрения, Ещё) пользователь одобрил как направление; в код перенесены токены и поведение, а не структура экранов.

**Подтверждено файлами:** `apps/app/src/shared/ui/tokens.css`, `apps/app/src/app/globals.css`, `features/home/home.{tsx,css}`, `features/ranking/leaderboard.css`, `features/rewards/rewards.css`, `features/tasks/task-list.tsx` (оболочка значка во вкладке).

- **Цвет.** Навигация и базовые токены сохранены (`--color-bg` без изменений, поэтому цвета нативной шапки и фона Telegram прежние). `--color-gold` светлее (`#f6d083`), `--color-muted` светлее (`#b2c6cc`) ради контраста. Добавлены `--color-mint-deep`, прозрачные тона (`--color-*-tint`), `--color-edge`, `--color-glass`, кривые `--ease-out`/`--ease-pop`.
- **Поверхности.** Карточки — слой света поверх панели с мягкой границей вместо плоских строк с разделителями; задачи, баллы, поощрения и записи журнала — отдельные карточки. Фон — два мягких свечения и точечная сетка (`body::before/::after`, фиксированы, не перехватывают ввод).
- **Читаемость.** Основной текст 16 px; подписи не меньше 14 px (были 11–13 px), исключение — подписи нижней панели 12/11/10 px при ширине ≥441/≤440/≤359 px. Зоны нажатия не меньше 44 px прежнего правила. Начертания Manrope — только 400 и 700 (встроены два файла), поэтому макетные 800 заменены на 700.
- **Навигация.** Пять личных разделов остаются, но в виде плавающей капсулы с размытием; у активного значок на подсвеченной «таблетке». Служебные разделы по-прежнему чипы над содержимым и переносятся по строкам; перенос их в отдельный раздел «Ещё», как в макете, не выполнялся: это изменило бы доступность служебных действий и сценарии проверки.
- **Движение.** Содержимое разделов, карточки задач и рейтинг появляются по очереди (`rise`), у кольца уровня, пьедестала и кнопок есть заполнение/пружина/блик, вокруг ближайшей задачи медленно вращается орбита. Всё отключается `prefers-reduced-motion: reduce`. Анимации используют только `transform` и `opacity`.
- **Главная.** Уровень показан кольцом (декоративным, `aria-hidden`); нативный `<progress>` остался для скринридеров и скрыт визуально. Доступные баллы выделены золотой плиткой.

**Не проверено:** физические Telegram Android/iOS; производительность `backdrop-filter`, фиксированных градиентов и анимаций на слабых Android WebView (замеров нет — если кадры просядут, первыми отключаются `body::before` и размытие капсулы); контраст новых пар цветов инструментом WCAG; экраны за флагами, которые не открывались в браузерных сценариях.

**Правка 9 октября 2026 (по снимкам с телефона владельца):** на авторизованных экранах убраны шапка с логотипом и кнопка «Выйти»; экран начинается с приветствия и кнопки «Полномочия». Экраны входа и ошибок сохранили шапку с логотипом. Выход из сессии теперь только серверным маршрутом `POST /api/v1/auth/logout` (в интерфейсе вызова нет); защита от потери несохранённого отчёта при выходе больше не нужна. Главная приведена к макету: ближайшая задача, кольцо уровня и плитка баллов рядом, строка с резервом и XP месяца, список «Ещё в работе».

**Правка 9 октября 2026 (ленты разделов):** служебные разделы (Баланс, Проверка, Постановка, Конфигурация, Доступ, Журнал, Уведомления) теперь одна строка с горизонтальной прокруткой вместо блока, переносимого на 3–4 строки. Это заменяет правило переноса из адаптации 6 октября; требование «не шире экрана» относится к самой ленте.

**Правка 10 октября 2026 (переработка по концепту; заменяет записи 9 октября о ленте служебных разделов и об отсутствии «Ещё»):**

- **Навигация.** Нижняя капсула: Главная · Задачи · Рейтинг · Поощрения · Ещё. Служебные разделы (баланс и журнал, проверка отчётов, постановка задач, каталог, доступ, журнал действий, состояние уведомлений) и «Мой профиль» лежат в экране «Ещё» (`features/more`), «Полномочия» — раскрывающийся блок там же. Из подраздела «Назад» (кнопка Telegram и значок «‹ Ещё») ведёт в «Ещё», оттуда — на корневой экран: «Главная», а у проверяющего очередь отчётов (`rootView` в `task-list.tsx`). Защита `confirmLeave` действует при каждом переходе.
- **Задачи.** Сегменты «Активные / Проверка / Готово» вместо фильтра; счётчики показываются, только когда список загружен полностью; по умолчанию открыт первый непустой сегмент. Задача открывается отдельным экраном с кнопкой «Задачи» и карточкой-героем; Telegram BackButton имеет приоритет 30 (выше подраздела «Ещё»).
- **Рейтинг.** Месяц переключается стрелками (следующий отключён на текущем московском месяце); выбор области — только при нескольких областях; первые три строки таблицы остаются для скринридеров.
- **Служебные экраны** (`app/service.css`): стеклянные карточки вместо линий, поля 48 px с радиусом 14 px и шевроном у `select`, фокус мятным кольцом, `details` как карточка с поворотным шевроном и появлением содержимого; карточка внутри карточки теряет рамку.
- **Осталось отличием от концепта:** нет счётчика непроверенных отчётов на «Проверке отчётов» и комментария командира в карточке задачи (в API нет таких полей — значения не выдумываются); строка «XP за сезон» на главной добавлена сверх макета; тексты действий («Оформить заявку» и т. п.) сохранены из-за тестов и доступности; формы служебных экранов и состояния ошибок в концепте не нарисованы — оформлены по тому же языку.
- **Не проверено:** физические Telegram Android/iOS, замер плавности на слабых WebView.
