# TASKS

Build tracker. Status: ☐ todo · ◐ in progress · ☑ done · ⊘ blocked. Phases mirror `PLAN.md` §5.
The **detailed step-by-step implementation plan** (file-level, TDD) for Phases 0–2 lives at
[`docs/plans/2026-06-23-hr-timeoff-v1.md`](plans/2026-06-23-hr-timeoff-v1.md). Phases 3–5 get
their own plan files when reached.

> Current state: **Phases 0–5 COMPLETE — v1 feature-complete & demo-ready**, except deferred FR-24
> (admin work/holiday UI) + FR-7 (self-service password change) → **Phase 6**. Identity/org,
> code+password auth, admin CRUD + manager edits, leave core (types/allocations/ledger/request),
> approval flow [`/manage/approvals`], FR-25 reason-private calendar [`/calendar`], role-aware home
> board + bottom-tab nav, settings + logout, responsive/device-detection, and a **seeded demo**
> (BJ Manufacturing — 3 teams + Security, 12 users, `Demo!2026`). Branch `feat/hr-timeoff-v1`; build
> green, unit 54/54, e2e 17/17 (serial/CI). **Deploy = runbook (`docs/DEPLOY.md`), not executed.**
> **Next: Phase 6** (FR-24, FR-7, FR-15, official holidays). History: `.superpowers/sdd/progress.md`.

## Phase 0 — Scaffold
- ☐ Init repo (git), Next.js App Router + TypeScript + Tailwind
- ☐ Add PWA (manifest, service worker, installable, persistent session)
- ☐ i18n + RTL shell (fa default / en), direction switch
- ☐ Supabase project + local CLI; env wiring (`NEXT_PUBLIC_SUPABASE_URL`, keys)
- ☐ First deploy to Vercel (boots in fa-RTL)
- ☐ Confirm `react-multi-date-picker` + date-math lib APIs via Context7, pin versions

## Phase 1 — Identity & org
- ☐ Migrations: companies, departments, profiles, user_roles, audit_log (+ enums)
- ☐ RLS + helper functions (`has_role`, `is_manager_of`, `same_team`, `can_read_all`)
- ☐ Username/password auth (admin-issued); first-login password change
- ☐ Admin console: employee CRUD, assign role(s)/team/manager
- ☐ Manager: edit direct reports (subset)

## Phase 2 — Leave core
- ☐ Migrations: work_settings, holidays, leave_types, leave_allocations, leave_requests, leave_ledger
- ☐ Server-side working-day counting function (weekend + holidays, half-day)
- ☐ Allocation → ledger; balance derivation
- ☐ Request form (type, dates via Persian/Gregorian picker, full/half), shows remaining balance

## Phase 3 — Flow & visibility ✅
- ☑ Approval (manager approve/reject; admin override); ledger consumption on approval
- ☑ Cancel pending request *(shipped in Phase 2)*
- ☑ RLS for visibility matrix (employee=team, manager/security=all read) + FR-25 reason privacy
- ☑ Calendar view scoped by viewer

## Phase 4 — Home board & polish ✅
- ☑ Home status board per role (employee statuses+balances+team; manager queue+reports)
- ☑ Role-driven bottom-tab nav (Home · Request · Calendar · Profile [+ Manage])
- ☑ Settings: calendar (Persian/Gregorian) + language (fa/en) toggles, persisted
- ☑ Responsive + device detection pass; accessibility/touch-target pass

## Phase 5 — Seed & demo ✅ (deploy = runbook)
- ☑ Seed: 1 company, 3 teams + Security dept, Iranian names/roles, admin/managers/employees/security
- ☑ Seed: leave types + annual allocations; Iranian holidays (minimal placeholders, admin-editable)
- ◐ Deploy demo (runbook `docs/DEPLOY.md`; not executed); smoke-test each role e2e ☑ (`seed-roles.spec`)
- ☑ Update CHANGELOG + flip REQUIREMENTS statuses

## Backlog (post-v1, see PLAN §6)
- ☐ Hourly leave (مرخصی ساعتی) — schema reserved
- ☐ Notifications (push/SMS/email) once a channel is chosen
- ☐ Attendance/check-in · shift scheduling · overtime · advance/loan · payslips · announcements ·
  documents · QC / finance / procurement modules
