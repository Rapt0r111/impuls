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

The observations above describe the standalone presentation (R0). For the R1/R2 Telegram Mini App, the binding screen and token contract is `IMPLEMENTATION_PLAN.md` § 7. It keeps the navy, turquoise, gold, Manrope and flat-list vocabulary, then adds purposeful blue data and coral error accents. Production components in Next.js use Tailwind v4 tokens, adapted shadcn/ui with Radix behavior, one Phosphor icon family, and Motion only for state feedback. The presentation's role switcher, phone frame, document reading surface, and inline demo SVGs are not production UI requirements. Any production design change is made in the plan and reflected here before implementation.

The initial F01 access screen uses the production type scale from § 7: 12 px supporting text, 15–16 px body and brand, 18 px confirmed identity, and a 30–40 px access heading across phone widths. Its status line and dot carry a text label, and its single action is at least 48 px high. `apps/app/src/shared/ui/tokens.css` contains its color tokens; `apps/app/.impeccable/surfaces/apps-app-src-app-mini-page-tsx.md` records the screen direction. This documents one in-progress screen, not a completed R1 interface.

The first F03 read-only section compresses the confirmed-access heading so the task list appears in the first phone viewport. Tasks use flat rows separated by a line; turquoise marks a selected row, gold marks the XP/points fund, and the criteria open in one inset panel. Status remains text, the filter and close actions have 44 px targets, and long synthetic names wrap at 320 px. Browser screenshots at 320/360/390 px check this layout with synthetic API responses; they do not verify Telegram WebView or the task mutation flow.

The 30 September F03 extension adds a report beneath the criteria and rule version in that same panel. Its label and textarea use the production 16 px step from § 7; the full-width mint action has a 48 px minimum height. A text counter has 12 px clearance above the keyboard-focus outline. Report errors are coral, confirmed submission is mint, and the copy separates submission from accrual. Unsaved text stays in memory during recoverable errors, with a guarded exit and Telegram closing confirmation where supported. No tokens, fonts or visual-world decisions change. The four synthetic browser captures and scoped review are recorded in `docs/verification/2026-09-30-f03-ui-review.md`; physical Telegram WebView behavior remains unverified.

ADR-0002 fixes F01 session transport in Telegram Web. The existing access screen and its session retry state remain the visual contract; browser verification now includes a cross-site HTTPS iframe. No layout, token or typography changes are required by this transport fix.
