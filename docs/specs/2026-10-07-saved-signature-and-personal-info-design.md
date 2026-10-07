# Saved signature and personal information — design

**Status:** Accepted 2026-10-07 (Amir, in chat). FR-52 (saved signature) and FR-53 (personal
information). Amir asked to write the spec and build in one go, so there is no separate plan
document; §8 is the build order.

## Problem

Every account signs often (each request, each approval) and must draw a fresh signature every
time, which is slow on a phone and gives uneven results. HR also keeps each person's identity, bank
and contact details on paper; the app has no place for them.

## Decisions (from the chat)

- **D1 — Pre-filled, confirmed each time.** A person may save one signature. Every signature box
  (four request forms, both approve dialogs) opens with it already drawn. The person still ticks the
  consent box on every signing, and can clear it and draw a new one for that signing. This
  deliberately relaxes the 2026-08-05 rule "a prior signature is never reused": per-signing consent
  stays, only the drawing is reused.
- **D2 — Draw or upload.** The saved signature is drawn on the canvas or uploaded as a photo. An
  upload is cropped to the ink, scaled to fill the box and compressed; no background removal (Amir
  chose "crop + compress only").
- **D3 — Personal fields, four groups**, all optional:
  - Identity: national ID (کد ملی), birth-certificate number (شماره شناسنامه), father's name, birth
    date, birth place, gender, marital status.
  - Bank: bank name, account number, Sheba (IBAN), card number.
  - Contact: mobile, home phone, address, postal code, emergency contact name and phone.
  - Employment extras: social-security (تامین اجتماعی) number, education level, military-service
    status, number of children.
- **D4 — Access.** The employee edits their own. HR and admin view and correct anyone's in their
  company (HR read-only on an admin's record, like FR-51 D2). Managers, security and peers never see
  it. Every change is audit-logged with field names only, never values.
- **D5 — Optional with nudges.** A dismissible "complete your profile" card on Home; a "personal
  info incomplete" filter on Manage › Employees for HR/admin. Nothing ever blocks a request.
- **D6 — HR bulk work.** CSV export of everyone's personal info (audit-logged) and CSV import.

## Decisions made while designing (assumptions, open to correction)

- **A1 — On Profile, not Settings.** Settings is admin-only; Profile is every account's page.
- **A2 — The saved signature is private to its owner.** No HR or admin read or write path. It is a
  personal tool, not HR data.
- **A3 — Separate import screen, not the roster import.** The roster import
  (`app_bulk_import_employees`) is admin-only and restructures departments in one big transaction.
  Personal info gets its own small import under Manage › Employees › Personal info, keyed by
  personnel number, open to HR. Same CSV reader and the same "Farsi label (key)" header style; the
  export uses the identical header so export → edit in Excel → import round-trips. An empty cell
  leaves the stored value unchanged; a cell cannot erase a value (erase in the form).
- **A4 — Checksums enforced** in the UI and in the database: national ID (Iranian 10-digit check
  digit), Sheba (`IR` + 24 digits, ISO 13616 mod-97), card number (16 digits, Luhn).
- **A5 — No column encryption.** The key would live on the same VM as the data, so it adds little.
  Consequence to know: database backups (the Mac copies too) now hold national IDs and bank
  details and belong on an encrypted disk.
- **A6 — Retires the NFR-5 clause** "avoid storing national ID unless required". It is now
  required (FR-53); NFR-5 is reworded.
- **A7 — "Complete" means the core five**: national ID, father's name, birth date, Sheba, mobile.
  The Home card also nudges when no saved signature exists.

## 1. Data model

### `user_signatures` (FR-52)

`user_id uuid PK → profiles(id) on delete cascade` · `signature_data text not null` (same bounded
PNG check as `leave_requests.signature_data`) · `source text not null check in ('drawn','upload')` ·
`updated_at timestamptz not null default now()`.

RLS: select / insert / update / delete only where `user_id = auth.uid()` and the caller is active.
No other policy, so not even admin reads it. An audit trigger logs `signature.saved` /
`signature.deleted` with `source` only, never the image.

A request or approval still stores its **own copy** of the PNG on the request row through the
existing signed RPCs (unchanged). Replacing or deleting the saved signature never touches past
evidence.

### `employee_personal_info` (FR-53)

One row per profile, created by an `after insert` trigger on `profiles` and backfilled for existing
profiles, so the employees list can join it with `!inner` and users only ever UPDATE.

`employee_id uuid PK → profiles(id) on delete cascade` · `company_id uuid not null` (copied from the
profile by trigger; immutable) · `national_id` · `birth_cert_no` · `father_name` · `birth_date date`
· `birth_place` · `gender` (`male|female`) · `marital_status` (`single|married`) · `bank_name` ·
`bank_account_no` · `sheba` · `card_no` · `mobile` · `home_phone` · `address` · `postal_code` ·
`emergency_name` · `emergency_phone` · `insurance_no` · `education`
(`below_diploma|diploma|associate|bachelor|master|doctorate`) · `military_status`
(`completed|exempt|educational_exempt|eligible|not_applicable`) · `children_count smallint 0..20` ·
`complete boolean generated always as (core five not null) stored` · `updated_at` · `updated_by`.

All text columns nullable. Format checks (digits normalised to ASCII before storage):

| Field | Rule |
|---|---|
| national_id | `^\d{10}$` and `private.is_valid_national_id` |
| birth_cert_no | `^\d{1,10}$` |
| bank_account_no | `^\d{5,20}$` |
| sheba | `^IR\d{24}$` and `private.is_valid_sheba` |
| card_no | `^\d{16}$` and `private.is_valid_card_no` (Luhn) |
| mobile | `^09\d{9}$` |
| home_phone, emergency_phone | `^0\d{10}$` |
| postal_code | `^\d{10}$` |
| insurance_no | `^\d{6,12}$` |
| names, places, bank name | 1..100 chars; address 1..500 |

RLS (permission keys go through the FR-51 seam; `has_permission` gains `personal_info.view` and
`personal_info.edit`, both "admin or hr"):

- **select:** own row, or `personal_info.view` on a row of the caller's company.
- **update:** own row, or `personal_info.edit` on a row of the caller's company whose employee is
  not an admin (an admin caller may edit anyone in the company).
- **no insert / delete policy** for `authenticated` (the profile trigger inserts; cascade deletes).
- A `before update` trigger pins `employee_id`, `company_id`, sets `updated_at` / `updated_by`.
- An `after update` trigger writes `audit_log(action 'personal_info.update', entity
  'employee_personal_info', after = {"fields": [changed column names]})`.

### RPCs (security definer, empty `search_path`, `authenticated` only)

- `app_export_personal_info()` → rows (personnel_no, full_name, every field) for the caller's
  company. Requires `personal_info.view`. Writes `audit_log` `personal_info.export` with the row
  count.
- `app_import_personal_info(p_rows jsonb)` → `{updated int}`. Requires `personal_info.edit`.
  Matches `personnel_no` in the caller's company; unknown numbers, admin targets for a non-admin,
  and duplicate numbers in the file fail the whole call. Only non-null keys are written. One
  transaction; CHECK constraints reject bad values. One audit row `personal_info.import` with the
  count (per-row field-name rows come from the update trigger).

## 2. Saved signature UI (FR-52)

- **Profile › Signature card.** Shows the saved signature (or "none yet") with Draw, Upload and
  Delete. Draw opens the existing canvas; Upload takes an image file (`accept="image/*"`, any phone
  photo). Both show a preview of the processed result and a Save button.
- **Processing (`lib/signature/process.ts`, client-side canvas):**
  1. Draw the source onto a canvas no larger than 1600 px on its long side; convert to greyscale.
  2. Trim: find the bounding box of "ink" pixels, darker than the image's background level (the
     90th-percentile brightness) minus a margin, so grey paper still crops. Pad 4%.
  3. Fit the crop into a 3:1 box (≤ 900×300), centred on white.
  4. Compress: quantise to 16 grey levels and encode PNG; if the data URL exceeds 300 000 chars,
     scale down by 0.8 and retry (floor 300×100). Drawn signatures go through steps 2–4 too, so
     they also fill the box.
  The pure parts (bounding box, quantise, fit maths) work on plain arrays and are unit-tested.
- **Pre-fill.** `RequestSignatureFields` loads the caller's saved signature once per page through a
  server action, cached at module level (cleared on save or delete). When its value is empty and the
  person has not cleared it, it fills the saved PNG and shows "Your saved signature — clear it to
  draw a new one". Clearing switches to a blank canvas plus a "Use saved signature" link. The canvas
  draws stored images aspect-fit (it used to stretch). Consent is still unticked on every open.
  No call sites and no RPCs change.

## 3. Personal info UI (FR-53)

- **Profile › Personal information** links to `/profile/personal-info`: one form, four sections,
  labelled fields with format hints; Persian digits accepted; birth date with the Persian date
  field; enum fields as selects. Save validates client-side (`lib/personal-info/fields.ts`), then
  the server action re-validates and updates through RLS.
- **Manage › Employees › Edit** shows the same form (HR/admin) below the existing card; read-only
  for HR on an admin. Not shown to managers.
- **Manage › Employees** gets an "Info incomplete" filter (HR/admin), and a "Personal info" toolbar
  link to `/manage/employees/personal-info`: Export CSV and Import CSV (template download, upload,
  per-line preview with errors, Apply).
- **Home** shows a dismissible card when the caller's row is not `complete` or they have no saved
  signature. Dismissal is per-browser (localStorage) for 14 days.

## 4. Security notes

- Personal info never enters `profiles`, so the views and policies that expose profiles to
  managers, the org chart and the team calendar cannot leak it.
- Audit rows carry field names and counts, never values or images.
- The CSV export is built on the server and streamed to the browser; it is not stored anywhere.

## 5. Docs touched

REQUIREMENTS (FR-52, FR-53, NFR-5 wording) · DATA_MODEL (two tables, RPCs) · PERMISSIONS (matrix
rows, new permission keys) · CHANGELOG · TASKS · AGENT-LOG · CLAUDE.md gotcha on backups if
warranted.

## 6. Testing

- Unit: national ID / Sheba / Luhn validators and digit normalisation; CSV header matching and row
  validation for the personal-info import; signature processing maths (bbox, quantise, fit);
  `RequestSignatureFields` pre-fill and "use saved" behaviour.
- SQL scenarios (`tests/sql/fr52-53-signature-personal-info.sql`, rolled back): owner-only
  signature access (admin denied); personal-info select/update for self, hr, admin, manager, peer;
  hr read-only on an admin; checksum CHECKs; export/import permission checks and audit rows.
- e2e: save a drawn signature on Profile → request form opens pre-filled → submit; personal info
  save on Profile; HR edits another employee's field. Uses its own `999…` users.

## 7. Out of scope

Signature for HR on someone else's behalf; images other than signatures; encrypting columns;
personal info on printed forms; payroll integration.

## 8. Build order

1. Migration A: helper validators, `user_signatures`, `employee_personal_info` + triggers +
   backfill, RLS, `has_permission` keys, RPCs. Dry-run with the SQL scenarios, apply locally,
   `schema:dump`.
2. `lib/supabase/types.ts`, `lib/personal-info/*`, `lib/signature/*` with unit tests.
3. Server actions: `lib/actions/signature.ts`, `lib/actions/personal-info.ts`.
4. Signature card + pre-fill in `RequestSignatureFields`.
5. Personal-info form (profile page + employee edit), filter, Home card.
6. Import / export screen.
7. Messages (fa + en), e2e, docs, AGENT-LOG.
