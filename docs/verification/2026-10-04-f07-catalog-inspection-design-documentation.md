# F07 catalog inspection: design documentation check

Checked 4 October 2026 using the Impeccable documenter instructions and `reference/document.md`. This is an ordinary Operate extension. The runtime system, rather than the historical R0 frontmatter, is the comparison baseline. This report alone is written; `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` and implementation files are preserved.

## Evidence and result

**Matched incumbent system.** Read `PRODUCT.md`, `DESIGN.md` including its Production Mini App extension, the incumbent `.impeccable/design.json`, the catalog surface brief, implementation contract, reviewer report, catalog TSX/CSS, notification CSS, global styles and the added navigation branch. The applicable requirements are `IMPLEMENTATION_PLAN.md` § 7 (hierarchy, states and mobile accessibility), § 10 (synthetic waiting mode), F07 in § 11 and the acceptance boundary in § 12.

Source references are repository-relative, with one-based lines:

| Observed system rule                                                                                               | Evidence                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navy base/panel, pale ink, muted supporting text, mint selected navigation and disclosure, gold reward value/focus | `apps/app/src/shared/ui/tokens.css:1`; `apps/app/src/app/globals.css:33`, `:46`, `:320`; `apps/app/src/features/catalog-admin/catalog-admin.css:18`                                                            |
| Manrope and runtime type hierarchy, rather than R0 display roles                                                   | `globals.css:35` (15 px body), `:386` (20 px section title); `catalog-admin.css:11` (18 px terms title), `:29` (16 px quota heading); `notification-status.css:13` (13 px notes), `:56` (18 px tabular counts) |
| Flat divided rows and labelled, right-aligned quota numbers                                                        | `catalog-admin.css:6`; `notification-status.css:45`; `catalog-admin.tsx:198`                                                                                                                                   |
| Outlined refresh and native scope select; 44 px targets and gold keyboard focus                                    | `globals.css:46`, `:486`; `notification-status.css:29`, `:65`; `catalog-admin.tsx:121`, `:155`, `:192`                                                                                                         |
| Separate authorized work destination uses the incumbent navigation component                                       | `task-list.tsx:375`, `:397`, `:419`; `globals.css:280`, `:300`                                                                                                                                                 |
| Read-only synthetic introduction, current/future terms distinction and dated read state                            | `catalog-admin.tsx:55`, `:133`, `:172`, `:192`, `:226`                                                                                                                                                         |

Visually inspected `docs/verification/assets/f07-catalog-inspection/admin-catalog/catalog-320.png`, `catalog-1280.png` and `catalog-all-permissions-320.png` through `view_image`. The 320 px and desktop captures show the same reading order: heading/refresh, synthetic explanation, scope/time, current terms, future disclosure and quota. Long conditions and timestamps wrap. The desktop retains the existing narrow workspace. The focused expanded disclosure has the incumbent gold outline. The all-permission capture shows five work destinations in two columns, with the final destination on its own row, and the selected configuration destination remains clear. No clipped content or new ornamental depth was observed in these captures. The native narrow select abbreviates its displayed long option within the control.

## Five-line system summary

Palette: existing navy/ink/muted surfaces; mint interaction and selection; gold prices and focus.

Type ramp: inherited Manrope, 20 px section title, 18 px terms/counts, 16 px quota/select, 15 px body and 13 px notes.

Meaningful Accent Rule: reward price uses gold; state and quota meaning retain explicit text.

Flat Surface Rule: line-separated rows and tonal controls establish hierarchy without per-item elevation.

Responsive operation: incumbent 44 px controls, wrapping heading/refresh and copy, native future-terms disclosure and permission-scoped navigation.

## Documentation follow-through and limits

Add factual catalog-inspection prose to PRODUCT/DESIGN through the parent task, describing the separate read-only destination, current/nearest-future terms, quota components and protected dated snapshot. No palette, font, token, motion, dependency or sidecar regeneration is justified by this extension. Historical navigation counts in DESIGN describe earlier slices; the new entry should describe the current fifth work destination rather than rewriting those historical records.

Defects/drift not canonized or repaired: none observed in the added visual surface; the R0 sidecar remains a presentation baseline and must not be promoted to a runtime token specification.

This pass read source and inspected three supplied captures; it did not rerun UI, API or database tests. The separate UI reviewer report is contextual evidence, not independently executed verification. Physical Telegram Android/iOS, screen readers, remote PostgreSQL, writes, P-01…P-06 and complete F07/R1 acceptance remain outside this report. The scoped visual match does not authorize external deployment or full F07 approval.
