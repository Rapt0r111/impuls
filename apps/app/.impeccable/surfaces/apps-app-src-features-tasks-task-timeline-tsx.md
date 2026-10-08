# F03: lifecycle history

Mode: Operate. Primary target: `apps/app/src/features/tasks/task-timeline.tsx`. Related targets: task-list.tsx, review-queue.tsx, task-management.tsx and globals.css.

Extend the existing report-history disclosure within the incumbent DESIGN.md world: navy, Manrope, flat rows, text statuses, gold funds and keyboard focus. Newest task versions first. Preserve report/review drafts; histories load only when opened. The existing report history carries report text and decision reasons, while the timeline carries transition, version, actor/time, assignee and saved funds/rules. Label migration snapshots explicitly instead of guessing unsaved past transitions.

Participant visibility comes from ownership; foreign task histories require independent task.view in the exact scope. A view-only user has a scoped list, no creation/assignment/review controls. Loading, empty, pagination, 503/offline with retained confirmed data and read time, 401/403 clearing access, and 404 hiding protected content use the incumbent pattern. No new motion, tokens or dependencies.

Verify 320/360/390/1280 px, keyboard disclosure/paging, reduced motion, long strings and increased text in a batched browser pass. Physical Telegram devices remain a separate verification.
