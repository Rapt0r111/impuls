# Сводка симуляции уведомлений

Mode: Operate. Primary target: apps/app/src/features/notifications/notification-status.tsx.

Purpose: authorised administrator checks saved processing states in one exact scope. Inherits DESIGN.md, audit/list/native disclosure vocabulary; no new identity, imagery, motion or dependency. Existing components are the sufficient reference under frontend-references; external component search is unnecessary.

First viewport: title, short simulation warning, manual refresh, exact-scope selector and timestamp, followed by divided counts. No delivered claim or decorative hero metric. Last failed-attempt reasons use native details, secondary to processing counts. Counts align right and remain neutral; no rate, progress ring or gold reward styling.

States: loading, confirmed summary, empty, offline/503 retained snapshot, disabled/denied cleared snapshot, lost-session workflow. No write form or 409; unknown/malformed responses require manual refresh. Four work destinations form two equal columns. Native Back returns through the existing workspace guard.

Verification: 320/360/390/1280, long scope name, enlarged text, reduced motion, keyboard refresh/disclosure, no overflow, cache clearing across reopening, late response after scope switch and actual API/database path. Physical Telegram and screen readers remain unverified. Contract/evidence: docs/implementation/2026-10-04-f08-status-slice.md, docs/verification/2026-10-04-f08-status.md.

Recent-event extension: a closed native disclosure follows counts/reasons; up to 20 flat ordered rows show allowlisted kind, state, last error and creation time. No identifiers or message text; creation is explicitly distinct from processing/delivery. Existing scope/refresh/error/cache states apply to the whole snapshot. Contract: docs/implementation/2026-10-04-f08-recent-events-slice.md; evidence: docs/verification/2026-10-04-f08-recent-events.md.

Paginated extension (5 October): user chose an additional closed native “Все события” disclosure. It reads ten event states lazily with own Moscow read date/refresh/next and Back-before-section-exit. Existing summary and recent20 stay; page rows inherit flat list dividers and neutral text. 503/offline retains dated confirmed page; 400 hides changed page; denied child or parent cancels parallel reads and clears both caches, including reopening. Long disclosure notes are at least14px per plan §7. Contract: docs/implementation/2026-10-05-f08-event-history-slice.md; evidence: docs/verification/2026-10-05-f08-event-history.md. No new identity/tokens/assets/motion; physical Telegram and screen readers unverified.
