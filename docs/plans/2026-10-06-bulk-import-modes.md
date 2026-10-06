# Bulk import modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add new only / Add & update / Replace for the employee bulk import, with missing-people
choices, conflict resolution, department overwrite and clean-up.

**Architecture:** A pure **plan builder** (`lib/csv/import-plan.ts`) turns the validator's result
plus the app's current state plus the uploader's choices into an explicit plan: creates, updates,
deactivations, manager reassignments, department upserts and deletions, conflicts. The wizard
renders it; one SECURITY DEFINER RPC executes it in a single transaction, re-checking every
invariant.

**Spec:** `docs/specs/2026-10-06-bulk-import-modes-design.md`

## Global Constraints
- Add new only is the default; Add & update and Replace are admin-only (UI + SQL).
- Admin accounts are never deactivated or listed as missing.
- `admin` / `hr` / `security` roles are never changed by an import.
- One transaction; audited; migration idempotent; `lib/supabase/types.ts` hand-edited.
- No upload of the client CSV by the agent.

## Review Focus
1. Cascading conflict: deactivating a supervisor makes their kept reports conflict → plan builder
   test `cascade`.
2. Department deletion with only inactive members → kept, listed "not deleted" → SQL + unit.
3. Inactive department manager in Add new only → replaced by the file's manager → unit
   `inactive manager counts as none`.
4. Role downgrade of someone who still has reports outside the file → preview warning `stillHasReports`.
5. Re-running the same Replace file twice → second run is a no-op (idempotent plan) → unit.

### Task 1: Validator — inactive department manager counts as none (all modes)
- `ImportContext.departments[].managerActive: boolean`; when false, treat as no manager.
- Test in `tests/unit/csv-import-rows.test.ts`; page passes `manager.active`.

### Task 2: Validator mode awareness
- `validateImportRows(rows, ctx, mode)`: `dupExisting` only in Add new only; otherwise mark
  `ImportRow.existing = true`. Department overwrite: in Add & update / Replace the file's names and
  manager win (`ImportDepartment.rename`, `managerChange`).
- `ImportContext.existingEmployees` gains `id, active, isAdmin, departmentCode, managerPersonnelNo`.

### Task 3: Plan builder (`lib/csv/import-plan.ts`, pure, TDD)
- `buildImportPlan({ result, ctx, mode, choices })` →
  `{ creates, updates, reactivations, missing[], deactivations, managerReassign[], deptUpserts,
  deptDeletes, deptKept, conflicts[], pendingSignerChanges }`.
- `choices = { missingDefault: 'deactivate'|'keep', overrides: Record<id,'deactivate'|'keep'>,
  resolutions: Record<conflictId, option> , overwriteBalances: boolean }`.
- Conflicts: `sameName`, `managerDeactivated`, `deptManagerReplaced` with options per spec §4;
  recomputed to a fixed point (cascade).
- Tests: every row of spec §1, each conflict + each option, cascade, idempotent re-run.

### Task 4: SQL `app_bulk_import_employees(p_company_id, p_mode, p_plan jsonb, p_balance_as_of, p_overwrite_balances)`
- Migration `20261006120001_bulk_import_modes.sql`. Re-validates: mode allowed for caller;
  personnel numbers; references; never deactivates admins; deletes a department only if it has no
  profiles; role changes limited to `manager`.
- Order: departments upsert → creates (manager-first) → updates → manager reassignments →
  deactivations → department managers → department deletions → audit.
- `app_bulk_create_employees` stays (Add new only path) or delegates — decide in implementation;
  keep its signature for compatibility.
- Rolled-back SQL test covering every operation.

### Task 5: Wizard UI
- Mode selector (radio, Add new only default; others hidden for HR).
- "Also overwrite balances" checkbox (modes 2–3).
- Preview sections: counts; creates/updates/reactivations; departments (new / renamed / manager
  changed / deleted / not deleted); missing people (default + per-person switch); conflicts with
  required radio options; pending-requests signer-change count.
- Replace: final AlertDialog with counts. Submit disabled until conflicts resolved.
- fa/en strings.

### Task 6: Tests, docs
- e2e: Add & update re-import; Replace with deactivation + confirm.
- DATA_MODEL, PERMISSIONS, REQUIREMENTS (FR-49), CHANGELOG, AGENT-LOG; `npm run schema:dump`.
