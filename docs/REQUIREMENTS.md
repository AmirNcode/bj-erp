# REQUIREMENTS

Numbered and traceable. `FR` = functional, `NFR` = non-functional. Status: ☐ todo · ◐ partial ·
☑ done. All ☐ until implementation begins.

## Functional — Identity & Org

- **FR-1** ☐ A single **admin** (the owner) can create, edit, deactivate employees.
- **FR-2** ☐ Admin can assign/change an employee's **role(s)**, **team/department**, and **manager**.
- **FR-3** ☐ Roles: **admin, manager, employee, security**. A user may hold more than one.
- **FR-4** ☐ Org model: company → departments (3 teams + 1 Security department) → employees, with
  a **manager hierarchy** (`manager_id` self-reference).
- **FR-5** ☐ **Managers** can edit employees that **directly report** to them (subset of fields).
- **FR-6** ☐ Employees can edit a limited set of their own profile fields.
- **FR-7** ☐ Login is **username (employee code) + password**, issued by admin. **No email
  required.** Self-service password change after first login.

## Functional — Time-Off

- **FR-8** ☐ Configurable **leave types** seeded with Iranian statutory defaults: paid **annual**
  (~26 working days/yr), **sick**, **unpaid**. Admin can add/edit types.
- **FR-9** ☐ Per-employee, per-type **yearly allocation** (entitlement).
- **FR-10** ☐ **Balance ledger**: every allocation/consumption/adjustment is a ledger row; balance
  is derived, auditable.
- **FR-11** ☐ Employee submits a request: type, date range, **full or half day** (am/pm). Schema
  reserves room for **hourly** leave later without migration.
- **FR-12** ☐ **Working-day count** excludes configured **weekend** days and **holidays**;
  half-day = 0.5. Computed **server-side**.
- **FR-13** ☐ Request shows **remaining balance** before submit; blocks/ warns if insufficient.
- **FR-14** ☐ **Approval**: the employee's **direct manager** approves/rejects; **admin can
  override** any decision. Ledger updates on approval.
- **FR-15** ☐ Employee can **cancel** a pending request (and request cancellation of an approved
  future one).

## Functional — Visibility (see also PERMISSIONS.md)

- **FR-16** ☐ **Employee** sees only **their own team's** time-off + their own requests.
- **FR-17** ☐ **Every manager** sees **company-wide** time-off (read), edits/approves only reports.
- **FR-18** ☐ **Security** staff see **everyone's** calendar and time-off (read-only).
- **FR-19** ☐ **Admin** sees and edits everything.

## Functional — UI / App shell

- **FR-20** ☐ **Home page = status board** (notification surrogate): employee sees own request
  statuses + balances + team time-off; manager additionally sees a pending-approval queue + reports'
  status.
- **FR-21** ☐ **Bottom tab bar**, role-driven. v1: Home · Request · Calendar · Profile/Settings;
  Admin & Manager get a Manage/Approvals tab. Future roles inject their own tabs.
- **FR-22** ☐ **Calendar view** of time-off, scoped by the viewer's visibility (FR-16–19).
- **FR-23** ☐ **Settings**: switch calendar **Persian ⇄ Gregorian**; switch language **Farsi ⇄
  English**. Persisted per user.
- **FR-24** ☐ Admin can edit **work settings** (weekend days; default `[Friday]`) and the
  **holiday list** (seeded with official Iranian 1404–1405 holidays).

## Non-functional

- **NFR-1** ☐ **Responsive** for mobile and desktop; **detect** device (UA + viewport) so future
  modules can serve mobile-optimized forms vs desktop dashboards.
- **NFR-2** ☐ **PWA**: installable to home screen; **persistent session** ("log in once").
- **NFR-3** ☐ **RTL** correctness in Farsi; clean LTR in English.
- **NFR-4** ☐ **Portability**: no proprietary cloud lock-in in data/auth; production self-hosts
  Supabase + Next.js with config-only changes.
- **NFR-5** ☐ **Security**: RLS on all employee-data tables; passwords hashed by Supabase Auth;
  **audit log** of admin/manager changes; minimize sensitive PII (avoid storing national ID unless
  required).
- **NFR-6** ☐ **Performance**: target a few hundred employees comfortably; list/calendar queries
  indexed.
- **NFR-7** ☐ **Accessibility**: keyboard-navigable, adequate contrast, labelled controls; touch
  targets sized for factory-floor phone use.
- **NFR-8** ☐ **Documentation** stays current (CLAUDE.md, this file, DATA_MODEL, PERMISSIONS,
  TASKS, CHANGELOG, specs) so any agent can resume cold.

## Out of scope (v1)

Hourly leave · push/SMS/email notifications · payroll calculation · attendance/check-in · shift
scheduling · performance · recruitment · the non-HR modules (QC/finance/procurement). All are on
the roadmap (PLAN §6) and the schema is designed not to block them.
