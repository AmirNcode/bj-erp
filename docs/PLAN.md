# PLAN — Architecture Blueprint & Roadmap

Living document. The big-picture map. Frozen point-in-time designs live in `docs/specs/`.

## 1. Vision

One application for the entire company, backed by **one central database**. Every department's
data — HR, quality control, finance, procurement, maintenance, etc. — is captured and stored in
the same system, so the company has a single source of truth instead of scattered spreadsheets
and paper.

We grow there **incrementally, one module at a time**, each shipped as its own spec → plan →
implementation. **HR / time-off is module #1.**

## 2. Why these choices

- **Next.js + Supabase** gives a single TypeScript codebase, Postgres with Row-Level Security for
  multi-role access, built-in auth, and storage — all **self-hostable**, which matters because
  production runs on the **company's own servers** while the demo runs on **Vercel + Supabase
  cloud**. The same code targets both; only environment variables change.
- **Module isolation over a monolith fork.** We deliberately did *not* fork an existing
  open-source HRMS (Frappe HR, OrangeHRM, …). Those are closed monoliths in foreign stacks (PHP /
  Python) and would fight the "one growing custom app" vision. Instead we **reuse the proven leave
  *data model*** from Frappe HR (leave types, allocations, balances, holiday lists, ledger) on our
  own stack. See `docs/specs/2026-06-23-hr-timeoff-design.md` §Decisions.

## 3. v1 scope (HR / Time-Off)

In: auth (admin-issued credentials, PWA persistent session) · org model (company, departments/
teams, employees, manager hierarchy) · roles (admin/manager/employee/security) · admin console
(employee CRUD, assign roles/teams/managers) · manager edits + approvals for direct reports ·
leave types + yearly allocations + balance ledger · time-off request (full/half day) on a
Persian **or** Gregorian calendar · weekend/holiday-aware working-day counting · approval flow ·
**home-page status board** (the notification surrogate) · visibility-scoped calendar views ·
Farsi/English + Persian/Gregorian toggles · RLS enforcing visibility · seed data (3 teams +
Security dept) · documentation.

Out (designed-for, deferred): hourly leave, push/email notifications, and every item in §6.

## 4. Architecture overview

```
┌──────────────────────────── Next.js (App Router, TS) ────────────────────────────┐
│  PWA shell · RTL/i18n (fa default, en) · responsive + device detection            │
│  Role-driven bottom-tab nav  →  Home · Request · Calendar · Profile  (+ Manage)   │
│  Server Components / Server Actions for data; client components for calendar UI    │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                         │  Supabase JS client (RLS-scoped)
┌────────────────────────────────────────▼──────────────────────────────────────────┐
│  Supabase: Postgres (RLS) · Auth (username/password) · Storage · Edge (later)       │
│  Shared core: companies, departments, profiles, user_roles, audit_log               │
│  HR module:   leave_types, leave_allocations, leave_requests, leave_ledger,         │
│               holidays, work_settings                                               │
│  Future modules add their own tables, reuse the shared core.                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Details: `docs/DATA_MODEL.md` (schema) and `docs/PERMISSIONS.md` (RLS).

## 5. Phased roadmap (v1)

| Phase | Goal | Done when |
|---|---|---|
| **0 — Scaffold** | Next.js + TS + Tailwind, Supabase project, env, PWA manifest, i18n/RTL shell, CI-less Vercel deploy | App boots in fa-RTL on Vercel; Supabase connected |
| **1 — Identity & org** | Schema for core + roles; admin-issued login; admin console CRUD; manager edits reports | Admin creates an employee who can log in; RLS on `profiles` |
| **2 — Leave core** | leave_types, allocations, ledger, requests; working-day counting (weekend + holidays) | A request computes correct days + remaining balance server-side |
| **3 — Flow & visibility** | Approval (manager + admin override); RLS for visibility matrix; calendar views | Manager approves; employee sees only own team; security/managers see all |
| **4 — Home board & polish** | Home-page status board per role; settings (calendar/lang); PWA install + persistent session; responsive/device passes | Labourer sees request status on home; installs to phone; stays logged in |
| **5 — Seed & demo** | Seed 3 teams + Security dept w/ Iranian names/roles; seed 1404–1405 holidays; deploy demo | Client can log in as each role and see realistic data |

## 6. Future modules / features (roadmap, not v1)

Prioritized for a manufacturer: **attendance / check-in-out** (PIN or geo) → **shift scheduling /
roster** → **overtime** (اضافه‌کاری) + **advance/loan requests** (مساعده) → **payslip viewing** &
self-service → **company announcements** → **document storage** → onboarding/offboarding,
performance reviews, asset/PPE assignment, admin analytics. Then other departments: **quality
control** (test-result entry forms, mobile-optimized), **finance** (dashboards, desktop-optimized),
**procurement**, etc. Each: own spec, own tables, role-driven nav, shared core.

## 7. Deployment

- **Demo**: Vercel (Next.js) + Supabase Cloud. Env via `vercel env` / Supabase dashboard.
- **Production**: company servers — self-hosted Supabase + Next.js (Node). No proprietary Vercel-
  only features in the data/auth layer, so the migration is config-only. Keep Vercel-specific
  niceties optional.
