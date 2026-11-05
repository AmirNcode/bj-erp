# Employee first and last names, sortable Employees table (FR-83)

**Status:** approved by Amir 2026-11-04; built, not merged, not deployed. Amended once, §7.
**Branch:** `claude/employee-name-fields`, from `origin/main` @ 03f8b07 (PR #19 included).
**Names in this file are invented examples.** Real names never go in specs, tests, migrations or logs.

## 1. Intent

Names are stored as one text today, so the list cannot sort by surname and the data is messy for
anything that needs parts. This change stores first and last name separately, and turns
Manage › Employees into a table with sortable First name, Last name, ID and Hire Date columns.

Nothing else in the app changes for its users: every other screen keeps reading `full_name`.

## 2. Decisions (Gate 1 answers, all from Amir)

| Topic | Decision |
|---|---|
| Existing names | Split by rule in the migration; people fix the rest by hand |
| 2-word names | First word = first name, second = last name |
| 3+ word names | All treated as uncertain. No guessing: whole name in First name, Last name blank |
| One-word names | Whole name in First name, Last name blank |
| Review | No new page, tab or flag. A blank Last name is the only marker. Amir or HR sort by Last name, see the blanks, open the normal Edit form and fix them |
| Until fixed | App works normally. `full_name` shows as it does today |
| `docs/files/` | Not used again. Counts were enough: 137–142 people; 2 words 83–87, 3 words 45–46, 4 words 7, 5 words 2, 1 word 0. Expect about 54 blanks on Liara |
| Required | Add form and bulk import: both required. Edit form: First required, Last may stay blank |
| `full_name` | Stays a stored column, kept correct by a database trigger |
| Who edits | Admin and `people` edit holders with today's limits. Self-edit closed for plain employees and managers. A `people` edit holder may change their own name |
| ID column | `personnel_no`; «—» when empty |
| Column order | Checkbox (admin), First name with avatar in the cell, Last name, ID, Hire Date, Department, Roles, Upcoming, Edit |
| Number under the name | Removed on desktop |
| Default sort | Last name, A→Z |
| Empties | Last name: end on A→Z, top on Z→A. ID and Hire Date: always at the end |
| Text IDs | Numbers first, then text, then «—», in both directions. Persian digits count as numbers |
| Ties | Inside a sort, ties go to the other name, then `id` |
| First click | Ascending on every column, then each click flips direction |
| Mobile | Same card, its number becomes `personnel_no`, plus a Sort control above the cards |
| Import template | `first_name` + `last_name` replace `full_name` |
| Old import files | Rejected with a clear error |
| Import rows | Every row needs both names, for new and existing people |
| Personal-info export | First and last only; the `full_name` column leaves the file |
| Search | No change: still `full_name`, `employee_code`, `personnel_no` |
| Other screens | None |

## 3. Data model

New columns on `public.profiles`:

| Column | Type | Rules |
|---|---|---|
| `first_name` | `text COLLATE "fa-IR-x-icu" NOT NULL` | trimmed, not empty |
| `last_name` | `text COLLATE "fa-IR-x-icu"`, nullable | NULL when blank; trimmed, not empty when set |

- **Invariant:** `full_name` = `first_name` + one space + `last_name`, or `first_name` alone when
  Last name is blank. This holds for blank-Last people too, because First name holds the whole name.
- **Why the collation:** the default DB collation swaps و and ه; `fa-IR-x-icu` gets the whole alphabet
  right. Checked on the local image, which is the same image version as Liara
  (`supabase/postgres:15.8.1.085`): it also folds ي/ی and ك/ک, ignores ZWNJ, and `ilike` works.
  PostgREST sorts a column by its own collation, so no sort-key column is needed for names.
- `first_name` and `last_name` are added to `lib/supabase/types.ts` by hand.

### ID sort key

PostgREST cannot cast in `order`, so the sort needs a numeric key:

```sql
create function public.personnel_sort_key(p public.profiles) returns numeric
  language sql immutable set search_path to '' as $$
  select case when d ~ '^[0-9]+$' then d::numeric end
  from (select translate(p.personnel_no, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') as d) x
$$;
```

This is a PostgREST computed field, so the query orders by it like a column. The PostgREST docs
confirm ordering on computed fields; the local `v12.2.3` still has to prove it in the dry run.

**Rejected: a stored generated column.** Tested in a rolled-back temp table: stored generated columns
are NULL inside BEFORE triggers. `enforce_profile_update_scope` compares whole rows
(`to_jsonb(new) - 'active' = to_jsonb(old) - 'active'`) to let the nightly `bj-apply-separations` job
through, so that comparison would turn false and the job would fail. If the computed field fails
on `v12.2.3`, the fallback is a generated column plus excluding it from that comparison, and I will
stop and report first.

Tested order (temp table): low→high `007 9 10 ۱۱ SUB-1 —`, high→low `۱۱ 10 9 007 SUB-1 —`.

## 4. Migration

One new file, timestamp after `20261105120000_profile_photos.sql`, add-only, in this order:

1. Add both columns, nullable.
2. Create `private.split_full_name(text)`: split on whitespace after trimming; exactly 2 words gives
   first + last; anything else gives the trimmed whole name as first and NULL as last. A ZWNJ does
   not split a word, so «علی‌پور» is one word.
3. Backfill every row. `enforce_profile_update_scope` refuses a write with no signed-in user, so
   disable that one trigger for the update and enable it straight after, in the same transaction.
4. `first_name` becomes `NOT NULL`; add the trim and not-empty CHECKs.
5. Create the sync trigger (§5), then replace `enforce_profile_update_scope` (§6).
6. Add `personnel_sort_key` and the function changes (§7), grants, `notify pgrst, 'reload schema'`.

The backfill does not touch `full_name`. Audit rows are skipped, as for any write with no user.

## 5. Sync trigger

`profiles_sync_names`, BEFORE INSERT OR UPDATE. Trigger names fire alphabetically, so
`profiles_enforce_update_scope` checks what the caller actually sent first.

| Write | Result |
|---|---|
| First or Last sent | Parts win; `full_name` is rebuilt from them |
| Only `full_name` changed (old app) | Split with the migration's rule; 3+ words gives a blank Last name |
| Insert with parts | `full_name` is built from them |
| Insert with only `full_name` (old app) | Split with the same rule |
| Other columns only | Names untouched |

Empty or spaces-only parts become NULL first; an empty First name then fails `NOT NULL`.

## 6. Permissions

`enforce_profile_update_scope` lists protected columns one by one, so an unlisted column is writable
by the user themself. Both new columns must be added.

| Caller | Name fields |
|---|---|
| Admin | Anyone, as today |
| `people` edit, on someone they may act on | Allowed, as today |
| `people` edit, on themselves | Allowed (names only) |
| Anyone else, on themselves | Refused. **New:** closes the direct-API `full_name` self-rename |
| Managers | Nothing, as today |

"Names" means `first_name`, `last_name` and `full_name`. RLS policies do not change.

**UI impact:** today `caps.profile` is false for HR on their own record, and the save also sends
`hire_date`, which the trigger refuses on self. `lib/employees/editCapabilities.ts` gets a new
`name` capability (true where `profile` is true, or for a `people` edit holder on themselves), and
the form sends only the two name fields in that case.

## 7. Write paths

- **`app_create_employee`:** gains trailing `p_first_name` and `p_last_name`, rejecting a blank in
  either when sent. `p_full_name` stays, because the old app calls it during deploy. *(Amended during
  the dry run: an overload made positional calls ambiguous.)*
- **`private.create_employee_impl`:** takes the parts.
- **`app_bulk_create_employees`, `app_bulk_import_employees`:** rows with `first_name` require both
  parts. Rows with only `full_name` keep working, for the old app during deploy.
- **`app_export_personal_info`:** returns `first_name` and `last_name` as well. It keeps returning
  `full_name` so the old app's export works during deploy; the new CSV does not use it. A changed
  return type means drop and recreate inside the migration.
- **`updateEmployee` / `allowedProfileFields`:** `first_name` and `last_name` replace `full_name`.
- **`scripts/seed-demo.mjs`, `supabase/seed.sql`:** use parts.

## 8. Employees table

`lib/employees/list.ts` gains `sort` (`first | last | id | hire`, default `last`) and `dir`
(`asc | desc`, default `asc`). Unknown values fall back to the defaults. `employeesHref` drops
defaults, so URLs stay short. Because both live in `EmployeesQuery`, search, department, tabs and
paging carry them with the existing `{ ...query }` spreads.

Header links go to `page: 1`. A click on another column gives ascending; a click on the active
column flips. Active headers show an up or down arrow, with `aria-sort`. No new dependency.

| Sort | Query order (`id` is always last) |
|---|---|
| `last` | `last_name` (asc nulls last, desc nulls first), `first_name`, `id` |
| `first` | `first_name`, `last_name` nulls last, `id` |
| `id` | `personnel_sort_key` nulls last, `personnel_no` nulls last, `last_name` nulls last, `first_name`, `id` |
| `hire` | `hire_date` nulls last, `last_name` nulls last, `first_name`, `id` |

Secondary keys follow the chosen direction; nulls stay as shown. Search stays on `full_name`.

Cells: First name holds the avatar, as the name cell does today. Last name, ID and Hire Date show
«—» when empty. `employee_code` leaves the visible row and stays as the checkbox label and test id.
The table already scrolls sideways when it does not fit.

**Mobile:** same card, with `personnel_no` (or «—») beside the department. A Sort control above the
cards, hidden from `md` up, picks the column and direction through the same URL state. It is a
native `<select>` styled like the toolbar's department filter (`components/ui` has no select).

## 9. Forms

- **Add:** separate required First name and Last name fields.
- **Edit:** separate fields; First required, Last optional. A blank-Last person opens with the whole
  name in First name, and the fixer moves the surname across. Other edits are never blocked.
- Messages for a blank field are added in `fa` and `en`, as are all new labels.

## 10. CSV

- **Import:** `IMPORT_COLUMNS` replaces `full_name` with `first_name` («نام») and `last_name`
  («نام خانوادگی»), both required, in every mode.
- **Old files:** a file without `first_name` or `last_name` stops at the column check; when it has
  `full_name`, the message says to download the new template. Nothing is written.
- **Same-name check:** `lib/csv/import-plan.ts` joins the parts before `normalizeFaName`. The preview
  shows the joined name.
- **Personal info:** `lib/personal-info/csv.ts` replaces `full_name` with `first_name` and `last_name`.
  Import matches on personnel number only and ignores name columns, so older exports still import.

## 11. Deploy

Migrations run just before the app swap, so the old app briefly runs on the new schema. It keeps
working: reads see `full_name`, its writes go through the trigger, and it keeps its
`app_create_employee` call, bulk row shape and export columns. Rollback restores the pre-deploy
dump, as for any release.

**Follow-up after release:** remove `p_full_name` from `app_create_employee` and the `full_name` branch
of the bulk functions. Goes in `docs/TASKS.md`.

## 12. Proof

- **Dry run on a clone** (CLAUDE.md procedure). The local `postgres` DB lags `main`, so the clone gets
  the missing migrations first. Before and after: a hash of all `full_name` values is identical; every
  row satisfies the invariant after whitespace normalising; a count of rows by word count and blank
  Last name. Counts only, no names. The local DB has about 19 people, so `tests/sql/` adds invented
  1- to 5-word names.
- **`tests/sql/employee-names.sql`:** split rule; sync trigger cases; old `app_create_employee` calls; role
  rules (self refused, HR on self allowed, HR on the admin refused, manager refused); separation job
  still passes; Persian order; `personnel_sort_key` values; both-required rejections.
- **Unit:** URL parse and href (sort survives search, filter, tab, page; sort change resets page),
  import rows and old-file rejection, personal-info CSV, `name` capability, order building.
- **Existing tests:** SQL tests that change `full_name` as self are updated to the new rule.
- **Browser:** sort in both directions across pages, in Farsi RTL, with a screenshot.
- `tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`, with actual output reported.

## 13. Docs

`docs/REQUIREMENTS.md` (FR-83), `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, `docs/CHANGELOG.md`,
`docs/TASKS.md` (HR cleanup of blanks, follow-up above), `docs/AGENT-LOG.md`.

## 14. Not doing

- No review tab, page or flag; no count of blanks anywhere.
- No change to `full_name` search, or to any screen outside Manage › Employees.
- Other `full_name` sorts in pickers and reports keep the default collation, so و/ه stay swapped
  there. Only the two new columns get Persian order.
- No sort on Department, Roles or Upcoming.
- No database rule forcing Last name for everyone.

## 15. Stop points during implementation

- **Before applying the migration anywhere:** the dry run needs Amir's go-ahead.
- **`npm run schema:dump`** reads the local `postgres` DB, which lacks recent migrations. It needs
  those plus this migration applied there, so Amir chooses: apply locally, or dump from the clone with
  `pg_dump -d <clone>` as the PR #19 session did (CHECK-noise hunks left out).
- **Commit and push:** only when asked. Anything touching Liara: only when asked.
