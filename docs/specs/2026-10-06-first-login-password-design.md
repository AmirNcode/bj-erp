# First-login password and login slips — design

**Status:** Accepted 2026-10-06 (Amir, in chat). FR-50.

## Problem

Admins issue every password: one by one, through the bulk import, or by regenerating a lost
credentials file. Whoever printed the CSV knows all of them. Nothing asked people to replace
theirs, and signed approvals mean less while someone else knows the password.

## Decisions

- **D1 — Flag on the profile.** `profiles.must_change_password`. The column default is `true`, so
  every insert path (single create, bulk import, installer admin) flags new accounts without
  changes. Rows that existed when the migration ran got `false`.
- **D2 — Admin resets flag again.** `app_set_employee_password` and
  `app_bulk_set_employee_passwords` set it. An admin resetting their own password is not flagged.
- **D3 — New password only.** The person typed the issued password seconds earlier, so the screen
  asks only for the new one twice. `app_set_initial_password` refuses the issued password itself.
- **D4 — UI gate, not RLS.** The `(app)` and `(print)` layouts redirect a flagged account to
  `/set-password`, which offers sign-out and nothing else. Data access is unchanged. The flag stops
  the account being used through the app, not through the API.
- **D5 — The flag is not self-writable.** The profile-scope trigger refuses changes to it unless the
  transaction carries `bj.password_flag_write = on`. Only the two password RPCs set that, and PostgREST
  clients can set only `request.*` settings.
- **D6 — Login slips.** The credentials screen prints one cut-out slip per person: name, login
  code, temporary password, the site host, and a note that the first login asks for a new password.
  Printing happens in the browser from memory, like the CSV. Nothing is stored.

## Out of scope

- Password expiry or complexity rules beyond the existing 8–72 latin characters.
- A limited "helpdesk admin" who can only reset passwords (`docs/TASKS.md`, before expanding).
