# TASKS

Build tracker. Status: ☐ todo · ◐ in progress · ☑ done · ⊘ blocked. Phases mirror `PLAN.md` §5.
The **detailed step-by-step implementation plan** (file-level, TDD) for Phases 0–2 lives at
[`docs/plans/2026-06-23-hr-timeoff-v1.md`](plans/2026-06-23-hr-timeoff-v1.md). Phases 3–5 get
their own plan files when reached.

> Current state: **Phases 0 ✅, 1 ✅, 2 ✅, 3 ✅, 4 ✅ COMPLETE and verified** (scaffold, i18n/RTL,
> PWA, Supabase + hardened RLS, code+password auth, admin CRUD, manager edits, leave schema +
> guarded write-path, Persian/Gregorian request form, approval flow [`/manage/approvals`], FR-25
> reason-private calendar [`/calendar`], role-aware home board, role-driven bottom-tab nav,
> profile settings [calendar/language toggles] + logout, responsive/device-detection). Branch
> `feat/hr-timeoff-v1`; build green, unit 54/54, e2e 14/14 (serial/CI). **Next: Phase 5 (full seed
> + deploy; + deferred FR-24, FR-7 password-change).** Vercel deploy (0.6) still deferred. Plans:
> `docs/plans/2026-06-24-hr-timeoff-phase3.md`, `…-phase4.md`. History: `.superpowers/sdd/progress.md`.

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

## Phase 5 — Seed & demo
- ☐ Seed: 1 company, 3 teams + Security dept, Iranian names/roles, admin/managers/employees/security
- ☐ Seed: leave types + annual allocations; Iranian 1404–1405 holidays
- ☐ Deploy demo; smoke-test each role end-to-end
- ☐ Update CHANGELOG + flip REQUIREMENTS statuses

## Backlog (post-v1, see PLAN §6)
- ☐ Hourly leave (مرخصی ساعتی) — schema reserved
- ☐ Notifications (push/SMS/email) once a channel is chosen
- ☐ Attendance/check-in · shift scheduling · overtime · advance/loan · payslips · announcements ·
  documents · QC / finance / procurement modules
