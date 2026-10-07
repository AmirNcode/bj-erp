# Clearance form (فرم تسویه حساب) — design

**Status:** Accepted and built 2026-10-07 (Amir, in chat). FR-54. Plan: `docs/plans/2026-10-07-clearance-form.md`. Paper original:
`docs/forms/leave-company-form.jpeg`. Amir asked for the spec and plan to be written and then built
without separate review gates.

## Problem

When someone leaves the company (resigns or is let go) HR fills a paper clearance form. Every unit
that may hold something of theirs (warehouse tools, maintenance, cashier advances, IT laptops, …)
signs that they owe nothing, then the finance manager certifies the settlement. Today the person's
app account also has to be deactivated by hand, and nobody remembers to.

## Decisions (from the chat)

- **D1 — HR files the form.** The leaver tells HR in writing (letter or email); HR fills the form.
  Employees never file their own. Admin may file too.
- **D2 — Reason, one of five** (the paper checkboxes): استعفاء resignation · اخراج dismissal ·
  پایان قرارداد contract end · ترک کار job abandonment · عدم نیاز redundancy.
- **D3 — Rows.** A company-wide default list of sign-off rows, edited by admin and hr; each new form
  starts from it and HR adds, removes or reassigns rows on that one form. The **HR row is always
  there and cannot be removed**. A row is a named unit with a signer: the hr role (HR row), a
  department (its manager signs), the leaver's own department (واحد مربوطه, its manager signs) or a
  named person. Seeded rows follow the paper, plus **IT**
  (equipment returns); the paper's "finance manager" row is not seeded because finance signs last.
  "Management" (مدیریت) is a regular row for now.
- **D4 — Order.** All rows sign in parallel, any order, HR included. **Finance signs last**, only
  after every row has signed.
- **D5 — Signing.** A signature (the existing canvas, pre-filled with the FR-52 saved signature,
  consent ticked per signing) plus an optional remark (شرح), e.g. "owes 2 drills". No reject: a
  unit with an open issue writes it in the remark or waits to sign until it is resolved.
- **D6 — Finance is a new role**, `finance`, granted by admin. Any finance holder may sign the
  final step: signature, remark and settlement date (default today).
- **D7 — Deactivation by date.** At 00:05 Tehran time on the day after the last working day the
  account is deactivated, whether or not the form is finished. A form filed with a last day already
  in the past deactivates at once. Deactivation also cancels the person's pending leave and errand
  requests.
- **D8 — Father's name and birth-certificate number** come from the person's FR-53 personal info.
  If missing there, HR types them on the form and they are written back to the personal info.
  The form keeps its own copy (paper evidence does not change when the profile does).
- **D9 — Place in the app:** a new section on **Profile**, not beside the request forms. May move
  later.
- **D10 — Visibility.** The leaver sees their own form read-only. Every signer sees the whole form,
  all rows and remarks. Admin, hr and finance see every form.
- **D11 — Cancel.** HR or admin may cancel a form until the account has been deactivated. After
  that, reactivating is the existing Edit Employee switch; the cancelled or finished form stays as
  history.
- **D12 — Warnings, not blocks**, when the leaver still has pending requests, has direct reports,
  manages a department or is a named approval-step approver.
- **D13 — Unused leave** is shown read-only on the form (remaining balance per type) so finance can
  settle it.
- **D14 — Printable** like the paper form, with drawn signatures.

## Decisions made while designing (open to correction)

- **A1 — Deactivation runs in Postgres via pg_cron.** A lazy "is the last day past" check inside
  `private.is_active()` does not work: the app layout, login, set-password, refresh and reports read
  `profiles.active` directly. pg_cron is already in the db image's `shared_preload_libraries`
  (checked locally); the migration only creates the extension and one job. Migrations run as
  `supabase_admin`, which may create it. The job is idempotent and also runs when a form is filed or
  edited with a past date, so a missed night is caught by the next one.
- **A2 — Not on yourself, hr not on an admin** (same as FR-51). Admin may file for another admin,
  but never for the last active admin (the existing last-admin guard would refuse the deactivation).
- **A3 — One live form per person**: a second form is refused while one is in progress, or finished
  but not yet applied. Cancelled and applied forms are history.
- **A4 — Editable while not applied.** HR may change reason and last working day until deactivation,
  and add, remove or reassign *unsigned* rows while the form is in progress. Signed rows are final.
- **A5 — The HR row** may be signed by any hr holder or an admin (a company with no hr person must
  still be able to finish a form). Other rows only by their signer.
- **A6 — Department rows** resolve to that department's manager when the form is created (a
  snapshot; changing the department manager later does not move the row — HR reassigns). A
  department without a manager makes an unassigned row that HR must assign before it can be signed.
- **A7 — Signers find work** in Profile › Clearance forms ("Awaiting your signature"), and Home shows
  a one-line card when the count is above zero.
- **A8 — The bottom "approver" box** on the paper (امضاء تایید کننده, above the finance block) has no
  step in the app; the print leaves it blank for a wet signature, with a footnote.
- **A9 — Approved future leave is left alone** on deactivation; only pending requests are cancelled.

## 1. Data model

Three migration files (a new enum value cannot be used in the transaction that adds it):

1. `20261007150001_finance_role.sql` — `app_role` + `'finance'`.
2. `20261007150002_clearance_form.sql` — tables, RLS, guard change, write RPCs, seed, pg_cron job.
3. `20261007150003_clearance_read.sql` — `app_list_separations()` and `app_get_separation(id)`:
   a signer may read a form but not the profiles on it (`profiles_select` is team-scoped and
   `get_org_chart` lists active people only), so these return names with the form. The list's
   `awaiting_me` column is what drives "Awaiting your signature" and the Home card.

### `separation_units` — the default row list

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id | uuid → companies | |
| kind | text | `hr` · `department` · `own_department` · `person` |
| name_fa, name_en | text | 1–100 chars |
| department_id | uuid → departments, null | required when `kind='department'`, on delete set null |
| signer_id | uuid → profiles, null | for `kind='person'`; null = not yet assigned |
| sort_order | int | |
| active | bool | inactive rows are not copied to new forms |

Exactly one `hr` row per company (partial unique index); it cannot be deleted or deactivated (trigger).
Seed for each company: HR, warehouses, maintenance, QC, relevant unit (`own_department`), cashier,
asset custody, IT, executive manager, management. The other seeded rows are `person` rows with no
signer yet, so they appear on new forms unassigned until admin or hr assigns signers or links
departments in Default rows. An unassigned row cannot be signed; HR assigns or removes it on the form.

### `separations` — one form

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id | uuid | |
| employee_id | uuid → profiles | |
| reason | text | `resignation` · `dismissal` · `contract_end` · `abandonment` · `redundancy` |
| last_working_day | date | تاریخ ترک کار |
| hire_date | date, null | copied from `profiles.hire_date` at filing |
| father_name | text, null | copy (D8) |
| birth_cert_no | text, null | copy (D8), `^[0-9]{1,10}$` |
| note | text, null | HR's note (e.g. "letter dated …"), ≤ 500 |
| status | text | `in_progress` → `awaiting_finance` → `completed`; or `cancelled` |
| finance_signed_by, finance_signed_at | | |
| finance_signature_data, finance_signature_consent_at | | same PNG CHECK as `leave_request_approvals` |
| finance_note | text, null | ≤ 500 |
| settlement_date | date, null | |
| deactivated_at | timestamptz, null | set when the account was switched off (A1) |
| created_by, created_at, cancelled_by, cancelled_at | | |

Partial unique index on `employee_id` where `status <> 'cancelled' and deactivated_at is null`
(A3).

### `separation_signoffs` — the rows of one form

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| separation_id | uuid → separations on delete cascade | |
| is_hr | bool | the locked row |
| name_fa, name_en | text | copied from the unit |
| department_id | uuid, null | for display |
| signer_id | uuid → profiles, null | null for the HR row; null = unassigned |
| sort_order | int | |
| signed_by, signed_at | | |
| signature_data, signature_consent_at | | same PNG CHECK |
| note | text, null | remark (شرح), ≤ 500 |

One `is_hr` row per form (partial unique index).

### Permissions

`private.has_permission` gains `separations.manage` (admin, hr: file, edit, cancel, default rows)
and `separations.view` (admin, hr, finance: read every form).

RLS: `separations` / `separation_signoffs` SELECT for `separations.view`, the leaver, and anyone who
is a signer on that form (or, for the HR row, holds hr). `separation_units` SELECT for any active
user of the company. **No INSERT/UPDATE/DELETE policies**: every write goes through the RPCs below.

### RPCs (security definer, empty `search_path`, EXECUTE to `authenticated` only)

- `app_create_separation(p_employee_id, p_reason, p_last_working_day, p_father_name,
  p_birth_cert_no, p_note, p_rows jsonb) → uuid`. Checks A2/A3. `p_rows` = `[{unit_id?, name_fa,
  name_en, department_id?, signer_id?}]` in display order; the HR row is added by the function,
  never taken from input. Writes missing father's name / birth-cert number back to
  `employee_personal_info` (only fields that are empty there). Audit `separation.create`. Calls the
  apply function (A1).
- `app_update_separation(p_id, p_reason, p_last_working_day, p_note)` — while not applied and not
  cancelled. Calls apply.
- `app_set_separation_signoffs(p_id, p_rows jsonb)` — replace the unsigned non-HR rows (add,
  remove, reassign, reorder). Signed rows must be present unchanged. Only while `in_progress`.
  Recomputes status (removing the last unsigned row can move it to `awaiting_finance`).
- `app_sign_separation_row(p_row_id, p_signature_data, p_signature_authorized, p_note)` — caller is
  the row's signer (HR row: hr or admin, A5), the caller is not the leaver, form `in_progress`,
  row unsigned. Sets status `awaiting_finance` when it was the last row.
- `app_sign_separation_finance(p_id, p_signature_data, p_signature_authorized, p_note,
  p_settlement_date)` — `has_role(finance)`, not the leaver, status `awaiting_finance`. → `completed`.
- `app_cancel_separation(p_id)` — `separations.manage`, not applied.
- `app_save_separation_units(p_units jsonb)` — `separations.manage`; replaces the non-HR default
  rows and renames the HR row.
- `app_separation_warnings(p_employee_id) → jsonb` — D12 counts (pending requests, direct reports,
  departments managed, approval steps naming them); `separations.manage` only.
- `app_separation_balances(p_id)` — remaining minutes per balance type for the leaver, for anyone
  with `separations.view` (finance cannot read the ledger directly).
- `private.apply_due_separations(p_id default null)` — runs as no user under pg_cron, so it sets the
  transaction-local GUC `bj.separation_apply = on`, which `enforce_profile_update_scope` honours for
  an `active` true→false change only; each form is applied in its own sub-block so one refusal
  (last admin) cannot stop the rest. For every form not cancelled, not applied, whose
  `last_working_day < today (Tehran)`: `profiles.active = false`, cancel the person's pending
  `leave_requests`, `deactivated_at = now()`, audit `separation.deactivate`. Returns the count.
  Scheduled by pg_cron as `bj-apply-separations`, `'35 20 * * *'` (UTC = 00:05 Tehran, no DST since
  2022).

## 2. UI

All under Profile; strings in `messages/{fa,en}.json` under `clearance`.

- **Profile page:** a "Clearance forms" card linking to `/profile/clearance`, shown
  to admin, hr, finance, anyone with a row to sign, and the leaver; it shows the "awaiting you"
  count.
- **`/profile/clearance`** — sections: *Awaiting your signature* · *My clearance form* (leaver) ·
  *All forms* (view permission; status filter). "New form" and "Default rows" buttons for manage.
- **`/profile/clearance/new`** — employee picker (active, same company, not self, hr: not admins),
  reason radios, last working day (`PersianDateField`), father's name / birth-cert no (pre-filled
  from personal info; editable only when empty there), note, rows (defaults pre-ticked, HR row
  locked, per-row signer picker, add a custom row). Warnings (D12) appear once an employee is picked.
- **`/profile/clearance/[id]`** — header facts, unused leave (D13), the rows with status, remark,
  signer, signed time and a lazy signature viewer; "Sign" for the caller's rows (dialog: remark +
  `RequestSignatureFields`); finance block (sign dialog adds settlement date); manage actions: edit
  reason / last day, edit rows, cancel; "Print".
- **`/profile/clearance/units`** — default rows editor (manage): name fa/en, kind, department or
  person, order, active. HR row: rename only.
- **`/print/clearance/[id]`** — the paper layout: title, company logo, name, father's name,
  birth-cert no, hire date, last day, reason ticks, the rows table (ردیف · نام واحد · شرح · نام و
  امضاء), the finance block. Blank boxes for anything unsigned.
- **Home:** one-line card "N clearance forms await your signature" when N > 0.
- **Employee edit:** the role checkboxes gain `finance`.

## 3. Security notes

- Signature images are only in rows the caller may already read; lists never select them (the
  viewer fetches one image on demand).
- The leaver may read but never sign their own form, including the HR row or finance if they hold
  those roles.
- Every RPC re-checks company, permission and state; the UI's hiding is convenience.

## 4. Docs touched

REQUIREMENTS (FR-54), DATA_MODEL, PERMISSIONS, CHANGELOG, TASKS, AGENT-LOG, CLAUDE.md (pg_cron
gotcha) if it proves non-obvious.

## 5. Testing

- `tests/sql/fr54-clearance.sql` — rolled-back scenarios: who may create, sign, finance-sign,
  cancel, read; HR row locked; one live form; status transitions; apply deactivates only due forms
  and cancels pending requests; reactivated person is not re-deactivated; personal-info write-back
  fills only empty fields.
- Unit tests for pure helpers (row-list building, status labels, awaiting filter).
- e2e `tests/e2e/clearance.spec.ts` with throwaway users: hr files a form with a past-due last day
  for a throwaway user → account deactivated; another with a future day → signers sign, finance
  signs, completed, print renders.

## 6. Out of scope

Employees filing their own resignation; notifications; settling money in the app; a generic
form/workflow engine (approach C, rejected as premature); moving the section out of Profile.
