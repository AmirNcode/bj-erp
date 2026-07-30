# CLAUDE.md — Agent Onboarding

> Read first. Tells AI assistant (or human) how project organized, what decided, how to resume
> without re-asking user.

## What this is

Unified web app for **Iranian manufacturing company**. Long-term goal: **one app, one central
database** spanning every department (HR, quality control, finance, procurement, …). Built
**module by module**, starting **HR → time-off (leave) management** — client's biggest pain is
manual, paper-based time-off process.

**Status (2026-06-30): v1 built and demo-ready.** Phases 0–6 — identity/org, code+password auth,
leave core, approval flow, FR-25 reason-private calendar, role-aware home board + nav, seeded
demo, settings/password/cancel-approved — plus full **frontend overhaul** (shadcn/ui, brand
tokens, Rubik with Vazirmatn fallback) complete, merged to `main`. See `docs/CHANGELOG.md` for
what shipped, `docs/TASKS.md` for what's next (PLAN §6 modules), `docs/specs/` for frozen design
records (start with `2026-06-23-hr-timeoff-design.md`).

## Stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Mobile-first, responsive, SSR. |
| Hosting (demo) | **Vercel** | Preview + prod demo. |
| Hosting (production) | **Company's own servers** | Must stay portable. |
| Backend | **Supabase** (Postgres + Auth + RLS + Storage) | Self-hostable → same code in prod. |
| Auth | **Admin-issued username + password** | Labourers have no email. Long-lived/PWA session. |
| i18n / layout | **Farsi (fa) default, RTL** + English (en) toggle | Per-user preference. |
| Calendar | **`react-multi-date-picker`** + `react-date-object` (Persian + Gregorian) | User switches in settings. |
| PWA | Installable, persistent session | "Log in once, stays logged in." |

Versions pinned at scaffold time. **Always verify library APIs against Context7 before using
them** — no training-data API details.

## Non-negotiable conventions

1. **Dates** stored in Postgres as **Gregorian `DATE`/`timestamptz`** (calendar-agnostic).
   Jalali = *presentation* concern only — convert at UI edge. Never store Jalali strings.
2. **RLS is source of truth** for access control. UI hides forbidden data; Postgres
   Row-Level Security enforces. Every table touching employee data has policies.
3. **Roles** live in `user_roles` table (`admin | manager | employee | security`), checked via
   `has_role()` SQL helper — not single enum column. One user may hold several.
4. **Farsi-first**: default locale `fa`, default direction RTL. All user-facing strings
   translated (`fa` + `en`).
5. **Module isolation**: future modules (QC, finance…) share auth/org/roles but own their tables
   and inject own bottom-tab navigation per user's roles.

## Repository layout

```
CLAUDE.md                  ← you are here
app/[locale]/              Next.js App Router — (auth)/login + (app)/* authed screens
  (app)/                   home · request · calendar · profile · team · manage/* (RBAC layout guard)
    _components/           AppShell, MainNav, PageHeader, nav-icons
components/                shared UI — ui/* (shadcn primitives), StatusBadge, Skeletons, EmptyState
lib/                       actions/* (server actions) · supabase/* (clients + generated types)
                           leave/* (pure day-count, balances, approvals) · auth/* · home/* · nav/*
i18n/                      next-intl routing / navigation / request config
messages/                  fa.json (default, RTL) + en.json
supabase/                  migrations/* (schema, RLS, SECURITY DEFINER fns) · seed.sql · config.toml
scripts/seed-demo.mjs      `npm run seed` — demo org via guarded RPCs (no service_role)
tests/                     unit/* (Vitest) + e2e/* (Playwright)
proxy.ts                   middleware: Supabase session refresh + next-intl routing (Next 16 name)
docs/
  AGENT-LOG.md             MANDATORY session journal — every agent appends what it did, incl.
                           actions run against the client's live server. Read first, write last.
  PLAN.md                  architecture blueprint + phased roadmap (start here for the big picture)
  REQUIREMENTS.md          numbered functional (FR-*) + non-functional (NFR-*) requirements
  DATA_MODEL.md            tables, columns, enums, ledger + day-counting logic (source of truth)
  PERMISSIONS.md           roles, visibility matrix, RLS policy descriptions (source of truth)
  TASKS.md                 build checklist by phase with status
  CHANGELOG.md             what changed, per release (Keep a Changelog format)
  DEPLOY.md                demo (Vercel) + production (self-host) runbook
  specs/                   dated, frozen design records (one per module/feature)
```
Granular task + commit history: `.superpowers/sdd/progress.md`.

## Read order for a new agent

1. This file → 2. **`docs/AGENT-LOG.md`** (what the last agent did — read this before touching
anything) → 3. `docs/PLAN.md` → 4. `docs/REQUIREMENTS.md` → 5. `docs/DATA_MODEL.md` →
6. `docs/PERMISSIONS.md` → 7. current spec in `docs/specs/` → 8. `docs/TASKS.md` (what's next) →
9. `docs/CHANGELOG.md` (what's done).

## How to run

```bash
npm install
cp .env.example .env.local     # fill NEXT_PUBLIC_SUPABASE_URL + ANON_KEY (public keys only)
npm run dev                    # http://localhost:3000 → boots fa-RTL at /login
```

Other commands: `npm run build` · `npm run lint` · `npm run test:unit` (Vitest, 165 tests) ·
`npm run test:e2e` (Playwright, 26 specs — needs reachable Supabase + dev server; run serial
`--workers=1`) · `npm run seed` (demo org). Database setup, Vercel demo deploy, self-host
production: see `docs/DEPLOY.md`. Demo admin login: `admin` / `Admin!2026`.

## Working agreements

- **Log every session in `docs/AGENT-LOG.md` — mandatory, no exceptions.** Append an entry
  before you finish, using the template in that file. It is the running journal of who changed
  what, why, what was run against the client's live server, and what was left half-done. Log
  dead ends and abandoned attempts too. Multiple agents work on this repo and git alone does
  not carry the reasoning or the out-of-repo actions.
- **Plan before code.** Design → spec → plan → implement, with user review gates.
- **Commit only when user asks.**
- Keep `docs/CHANGELOG.md` (what shipped) and `docs/TASKS.md` (what's next) current as work
  lands. `docs/MEMORY.md` takes lessons that will still matter in six months. `AGENT-LOG.md` is
  always updated; these three only when they apply.
