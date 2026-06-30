# BJ — Behsazan Jonoob ERP

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)
![Tests](https://img.shields.io/badge/tests-73%20unit%20%C2%B7%2020%20e2e-success)
![Status](https://img.shields.io/badge/v1-feature--complete-2E3C92)

A unified, mobile-first web application for a manufacturing company (Behsazan Jonoob). The
long-term goal is **one app, one central database** spanning every department — HR, quality
control, finance, procurement, and more — built **module by module**.

**Module #1 — HR / Time-Off (leave) management — is built and demo-ready.** It replaces the
company's manual, paper-based leave process: employees request time off, managers approve, and
balances stay auditable, all on a **Farsi-first, right-to-left** interface with a Persian (Jalali)
or Gregorian calendar.

---

## ✨ Features (v1)

- **Admin-issued login** — username (employee code) + password. No email required (factory-floor
  workers don't have one). Persistent PWA session: *log in once, stays logged in.*
- **Identity & org** — company → departments (teams + Security) → employees, with a manager
  hierarchy. Admin CRUD for employees; managers edit their direct reports.
- **Roles** — `admin · manager · employee · security`; a user can hold several. Enforced by
  Postgres Row-Level Security, not just the UI.
- **Leave core** — configurable leave types, per-employee yearly allocations, and an auditable
  **balance ledger** (every allocation / consumption / reversal is a row).
- **Requests** — pick a type and date range (full or half day) on a Persian **or** Gregorian
  picker; working days are counted **server-side**, excluding configured weekends + holidays, with
  a live remaining-balance preview.
- **Approval flow** — the direct manager approves/rejects; admin can override. Approval atomically
  debits the ledger (guarded against double-debit).
- **Cancellation** — cancel a pending request, or an **approved future** request (balance restored
  via a `reversal` ledger row).
- **Reason privacy (FR-25)** — a request's free-text reason is visible only to the requester, their
  manager, security, and admin — never to teammates. The shared calendar shows dates + status only.
- **Home status board** — a role-aware dashboard (the notification surrogate): balances, recent
  requests, team time-off, and — for managers/admins — a pending-approval queue.
- **Admin settings** — edit weekend days and the holiday list in-app.
- **Self-service** — change your own password; switch language (فارسی ⇄ English) and calendar
  (Jalali ⇄ Gregorian), persisted per user.
- **Responsive + accessible** — bottom tab bar on mobile, side rail on desktop; RTL-correct; touch
  targets sized for factory phones.

## 🧱 Tech stack

| Concern | Choice |
|---|---|
| Framework | **Next.js 16** (App Router) + **React 19** + TypeScript |
| Backend | **Supabase** — Postgres + Auth + Row-Level Security + Storage (self-hostable) |
| Auth | Admin-issued employee code + password (synthetic-email mapping; no `service_role` in app) |
| i18n / layout | **next-intl** — Farsi (`fa`) default + RTL, English (`en`) toggle |
| UI | **Tailwind CSS v4** + **shadcn/ui** (new-york), brand OKLCH tokens (`#2E3C92`), Vazirmatn font |
| Calendar | `react-multi-date-picker` + `react-date-object` (Persian + Gregorian) |
| PWA | Installable, persistent session, brand theme color |
| Testing | **Vitest** (73 unit) + **Playwright** (20 e2e) |
| Hosting | Demo: Vercel + Supabase Cloud · Production: company's own servers (self-hosted) |

## 🏛️ Architecture principles

- **RLS is the source of truth.** The UI hides forbidden data; Postgres Row-Level Security enforces
  it. Every employee-data table has policies.
- **Privileged writes go through guarded `SECURITY DEFINER` functions** (submit/approve/cancel/
  allocate, password change) — there is **no `service_role` secret** in the app. Working-day counts
  and balance math run in the database, never trusting the client.
- **Dates are stored Gregorian** (`date` / `timestamptz`); Jalali is a presentation concern,
  converted at the UI edge. Never store Jalali strings.
- **Portable by design.** No proprietary cloud lock-in in the data/auth layer — the same code runs
  on Vercel + Supabase Cloud (demo) or self-hosted on company servers (production); only env vars
  change.
- **Module isolation.** Future modules (QC, finance, …) share the auth/org/roles core but own their
  tables and inject their own role-driven navigation.

## 🚀 Quick start

**Prerequisites:** Node.js 20+ and a Supabase project (cloud or local).

```bash
npm install
cp .env.example .env.local     # fill in the two public Supabase keys
npm run dev                    # http://localhost:3000 → boots fa-RTL at /login
```

`.env.local` needs only public, client-safe keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx_or_legacy_anon_jwt
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest unit suite (73 tests) |
| `npm run test:e2e` | Playwright e2e (20 specs; needs a reachable Supabase + dev server — run serial with `--workers=1`) |
| `npm run seed` | Seed the demo org (BJ Manufacturing) via guarded RPCs |

### Database & deployment

Apply `supabase/migrations/*` (schema, RLS, functions) and `supabase/seed.sql` (config baseline),
then `npm run seed` for the demo org. Full runbook for the Vercel demo and self-hosted production
is in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

**Demo login:** `admin` / `Admin!2026`. Seeded role accounts (`m-prod`, `e-prod-1`, `s-sup`, …) use
`Demo!2026` — full roster in [docs/DEPLOY.md](docs/DEPLOY.md).

## 📁 Project structure

```
app/[locale]/        Next.js App Router — (auth)/login + (app)/* authed screens
  (app)/             home · request · calendar · profile · team · manage/* (RBAC layout guard)
components/          shared UI — ui/* (shadcn primitives), StatusBadge, Skeletons, EmptyState
lib/                 actions/* (server actions) · supabase/* (clients + types) · leave/* (pure
                     day-count, balances, approvals) · auth/* · home/* · nav/*
i18n/  messages/     next-intl config + fa/en translations
supabase/            migrations/* (schema, RLS, SECURITY DEFINER fns) · seed.sql
scripts/             seed-demo.mjs (demo org)
tests/               unit/* (Vitest) + e2e/* (Playwright)
proxy.ts             middleware: Supabase session refresh + next-intl routing
docs/                PLAN · REQUIREMENTS · DATA_MODEL · PERMISSIONS · TASKS · CHANGELOG · DEPLOY · specs/
```

## 📚 Documentation

Start with **[CLAUDE.md](CLAUDE.md)** (agent/human onboarding), then:

| Doc | Purpose |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Architecture blueprint + phased roadmap |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Numbered functional (FR-*) + non-functional (NFR-*) requirements |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Tables, columns, enums, ledger + day-counting logic |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Roles, visibility matrix, RLS policies |
| [docs/TASKS.md](docs/TASKS.md) | Build checklist by phase with status |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | What shipped, per release |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Demo (Vercel) + production (self-host) runbook |
| [docs/specs/](docs/specs/) | Dated, frozen design records |

## 🗺️ Roadmap

v1 (HR / Time-Off) is complete. Next, prioritized for a manufacturer: **attendance / check-in →
shift scheduling → overtime + advance/loan requests → payslip viewing → announcements → document
storage**, then other departments (quality control, finance, procurement). Each ships as its own
spec → plan → implementation, reusing the shared core. See [docs/PLAN.md](docs/PLAN.md) §6.

## 📄 License

Private / internal project for Behsazan Jonoob. Not licensed for redistribution.
