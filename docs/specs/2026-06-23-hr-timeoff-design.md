# Design Spec — HR / Time-Off (v1)

- **Date**: 2026-06-23
- **Status**: Approved (design). Implementation plan pending.
- **Module**: HR → Time-Off (Leave) management. First module of the unified company app.

This is a **frozen point-in-time record** of the approved design. Living detail lives in
`docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, and the roadmap in `docs/PLAN.md`.

---

## 1. Context & problem

An Iranian manufacturing company runs time-off requests **manually / on paper**. Lower-level
labourers often have **no email** and limited tech familiarity. The company wants a web app —
usable on **phone and desktop** — where staff log in once and request time off through a
**calendar**, with statuses surfaced where everyone can see them. This is the first slice of a
much larger vision: **one app, one central database** for the whole company (HR, QC, finance,
procurement, …), grown one module at a time.

## 2. Decisions (from brainstorming)

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Build vs. fork OSS HRMS | **Fresh build on Next.js + Supabase, reuse Frappe HR's leave *data model*** | Forking a PHP/Python monolith fights the "one growing custom app + central DB" vision and the chosen stack. Reusing the proven model ≠ reinventing the wheel. |
| D2 | Login for email-less labourers | **Admin-issued username (employee code) + password**; PWA persistent session | Works for everyone; SMS-OTP in Iran is operationally hard; email excludes labourers. |
| D3 | UI language / direction | **Farsi default, RTL** + English toggle | Audience is Iranian staff incl. labourers; English for owner/managers. |
| D4 | Supabase coupling | **Use Supabase fully; self-host it for production** | Supabase is open-source/self-hostable → config-only migration to company servers. |
| D5 | Approval flow | **Direct manager approves/rejects; admin override** | Matches the manager hierarchy; simplest that fits the rules. |
| D6 | Leave types & balances | **Statutory set (annual ~26d, sick, unpaid) + balance ledger**; admin can add types | Realistic for an Iranian employer; ledger = auditable balances. |
| D7 | Granularity | **Full + half day in v1; schema reserves hourly** (مرخصی ساعتی) | Half-day covers most v1 needs; hourly common in Iran but adds UI/math complexity — defer cleanly. |
| D8 | Weekends & holidays | **Weekend default `[Friday]`, configurable**; seed official Iranian (Jalali) holidays | Correct working-day counts; factories vary (Thu+Fri etc.) so make it configurable. |

## 3. Scope

See `docs/PLAN.md` §3 and `docs/REQUIREMENTS.md`. In short — v1 delivers identity/org, admin &
manager management, the full time-off request→approve→balance loop on a Persian/Gregorian
calendar with weekend/holiday-aware counting, a role-based home-page status board, visibility
enforced by RLS, Farsi/English + calendar toggles, seed data, and docs. Hourly leave,
notifications, and non-HR modules are explicitly deferred.

## 4. Architecture (summary)

- **Frontend**: Next.js App Router + TypeScript. Server Components / Server Actions for data;
  client components only where needed (calendar, toggles). Responsive + device detection (UA +
  viewport). PWA (installable, persistent session). i18n via a Farsi-default, RTL-aware setup
  with an English locale. Calendar UI via **`react-multi-date-picker`** (Persian + Gregorian in
  one component); date math via `dayjs`/`jalaali-js`.
- **Backend**: Supabase — Postgres (RLS), Auth (username/password), Storage. Shared core tables
  (company, departments, profiles, user_roles, audit_log) + HR module tables. Working-day counting
  and balance updates run **server-side** (SQL functions / Server Actions) for integrity.
- **Date storage**: Gregorian `DATE`/`timestamptz` only; Jalali is presentation. (See
  DATA_MODEL.)
- **Extensibility**: future modules reuse the core, add their own tables, and inject role-driven
  bottom-tab entries. Nothing in v1 hard-codes "HR is the only module."

Full schema → `docs/DATA_MODEL.md`. Full access rules → `docs/PERMISSIONS.md`.

## 5. Key user flows

1. **Admin onboards an employee** → sets employee code, name, team, manager, role(s), initial
   leave allocations → hands the worker their username + temporary password.
2. **Employee requests leave** → opens app on phone (already logged in) → Request tab → pick type,
   dates (Persian or Gregorian), full/half day → sees computed working-days + remaining balance →
   submits.
3. **Manager decides** → Manage/Approvals tab shows pending requests from direct reports → approve/
   reject → ledger + balance update → status flips on the employee's **home page**.
4. **Visibility** → employee's Calendar shows only their team; any manager and security see the
   whole company; admin sees + edits all.

## 6. Sample / seed data (to be finalized in implementation)

- 1 company. 3 teams + 1 Security department. Realistic Iranian names and manufacturing roles
  (e.g., Production line A/B, Quality Control bench, Maintenance; Security guards/supervisor). One
  admin (owner), a manager per team, several employees, security staff. Leave types + annual
  allocations seeded. Official Iranian public holidays for 1404–1405 seeded. Exact names/roles and
  the holiday list are filled in during Phase 5 and recorded in CHANGELOG.

## 7. Risks / open items

- **Holiday data**: Iranian official holidays include movable (lunar) dates — seed a vetted static
  list per year; admin-editable. Revisit a data source/library at implementation.
- **i18n library API** and **calendar component API**: confirm against Context7 at scaffold time.
- **Self-host parity**: validate that RLS policies + auth behave identically on self-hosted
  Supabase before the production cutover.

## 8. Next step

Produce a detailed implementation plan (writing-plans skill) covering the phases in PLAN §5, then
scaffold after user review.
