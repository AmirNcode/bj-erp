-- =============================================================================
-- Migration: 20260818180001_approval_steps_person.sql
-- Purpose  : An approval step may name a SPECIFIC PERSON, not only a role, and
--            HR may configure the chain alongside admin.
-- Requirement: FR-42 (extends FR-36)
-- Spec     : docs/specs/2026-08-18-holidays-weekends-approvers-design.md Part 4
-- Depends  : 20260818160001_approval_chain_schema.sql (both tables)
--            20260818160002_approval_chain_backfill.sql (real client evidence)
--
-- Schema + policies only. The engine is 20260818180002, split so a failure in
-- one leaves the other resumable — the ledger records each file separately.
--
-- ── The constraint swaps are the risky part ─────────────────────────────────
--
-- `leave_request_approvals` already holds BACKFILLED decisions for real client
-- requests (20260818160002). Its unique key changes here, so the new index must
-- be valid for every existing row. It is: those rows have a NULL `step_id` and
-- therefore key on `step_role`, exactly as before.
--
-- Idempotent throughout: add column if not exists, drop-then-create for every
-- constraint, index and policy. Safe to re-run.
-- =============================================================================

-- ── a step may name one person ───────────────────────────────────────────────

alter table public.approval_steps
  add column if not exists approver_id uuid references public.profiles(id);

comment on column public.approval_steps.approver_id is
  'FR-42: when set, ONLY this person may fill the step. NULL = filled by anyone holding `role` (the pre-FR-42 behaviour).';

-- No ON DELETE clause on purpose. Profiles are never hard-deleted here
-- (DATA_MODEL: soft state via `active`), and `on delete set null` would be
-- actively wrong — it would silently convert a step reserved for one named
-- person into a step any holder of that role could fill.

-- `role` stays NOT NULL and meaningful even for a person-step: it decides which
-- box the signature prints in (lib/leave/paperForm.ts) and is the label the
-- Settings card shows. 'employee' joins the allowed set, because a named
-- approver may be an ordinary employee — a plant manager who holds no app role.
alter table public.approval_steps
  drop constraint if exists approval_steps_role_allowed;
alter table public.approval_steps
  add constraint approval_steps_role_allowed check (
    role in ('manager','hr','security','admin','employee')
  );

-- A role-step must not name 'employee': "anyone who is an employee may approve"
-- is every colleague in the company, which is not an approval step.
alter table public.approval_steps
  drop constraint if exists approval_steps_employee_needs_person;
alter table public.approval_steps
  add constraint approval_steps_employee_needs_person check (
    role <> 'employee' or approver_id is not null
  );

-- ── unique keys ──────────────────────────────────────────────────────────────
--
-- The old `unique (company_id, role)` would have allowed only ONE named person
-- in the whole company, since every person-step still carries some role value.
-- Split in two: one role-step per role, and one step per named person.
alter table public.approval_steps
  drop constraint if exists approval_steps_company_role_uniq;

create unique index if not exists approval_steps_company_role_uniq
  on public.approval_steps (company_id, role)
  where approver_id is null;

create unique index if not exists approval_steps_company_person_uniq
  on public.approval_steps (company_id, approver_id)
  where approver_id is not null;

-- ── evidence rows must key on the STEP, not just its role ────────────────────
--
-- Two named people can share a role, so `(request_id, step_role)` would let the
-- first of them to sign block the second — the request would complete a step
-- that was never filled.
alter table public.leave_request_approvals
  add column if not exists step_id uuid;

comment on column public.leave_request_approvals.step_id is
  'FR-42: which approval_steps row this evidence fills. NULL for rows written before FR-42, which key on step_role. Deliberately NOT a foreign key — recorded evidence must survive the step being reordered or deleted.';

-- Deliberately no FK, for the same reason `step_role` never had one: config can
-- be deleted later and recorded evidence must not vanish or change with it.

alter table public.leave_request_approvals
  drop constraint if exists leave_request_approvals_uniq;

-- TWO partial indexes, not one expression index over `coalesce(step_id::text,
-- step_role::text)`. That expression is rejected: casting an ENUM to text is
-- only STABLE, not IMMUTABLE — enum labels can be renamed — and an index
-- expression must be immutable. Measured, not guessed:
--   ERROR: functions in index expression must be marked IMMUTABLE
--
-- The pair gives the same guarantee. Rows written before FR-42 have a NULL
-- step_id and keep keying on step_role, which is what makes this valid against
-- the backfilled client evidence; every new row carries a step_id and keys on
-- that, so two named people sharing a role each get their own slot.
create unique index if not exists leave_request_approvals_role_uniq
  on public.leave_request_approvals (request_id, step_role)
  where step_id is null;

create unique index if not exists leave_request_approvals_step_uniq
  on public.leave_request_approvals (request_id, step_id)
  where step_id is not null;

-- Note on the seam: a request could in principle hold one pre-FR-42 row for a
-- role AND a new row for a step with that same role, since the two indexes do
-- not see each other. The engine's own outstanding-step query is what prevents
-- it — it skips any step whose ROLE already has a decision, under either shape —
-- and these indexes are the backstop beneath that, not the primary guard.

-- ── HR may configure the chain (owner's request) ─────────────────────────────
--
-- This widens exactly ONE table. HR still cannot edit work_settings, holidays,
-- departments, leave types, or roles — all of those keep their admin-only
-- policies.
drop policy if exists "approval_steps_insert_admin" on public.approval_steps;
drop policy if exists "approval_steps_update_admin" on public.approval_steps;
drop policy if exists "approval_steps_delete_admin" on public.approval_steps;

drop policy if exists "approval_steps_insert_config" on public.approval_steps;
create policy "approval_steps_insert_config" on public.approval_steps
  for insert to authenticated
  with check (
    private.is_admin((select auth.uid()))
    or private.has_role((select auth.uid()), 'hr')
  );

drop policy if exists "approval_steps_update_config" on public.approval_steps;
create policy "approval_steps_update_config" on public.approval_steps
  for update to authenticated
  using (
    private.is_admin((select auth.uid()))
    or private.has_role((select auth.uid()), 'hr')
  )
  with check (
    private.is_admin((select auth.uid()))
    or private.has_role((select auth.uid()), 'hr')
  );

drop policy if exists "approval_steps_delete_config" on public.approval_steps;
create policy "approval_steps_delete_config" on public.approval_steps
  for delete to authenticated
  using (
    private.is_admin((select auth.uid()))
    or private.has_role((select auth.uid()), 'hr')
  );

-- ── candidate search for the person picker ───────────────────────────────────
--
-- A definer function rather than a client query, so the picker returns only what
-- it needs (id, name, personnel number) instead of whole profile rows, and so
-- the search is available to hr and admin without widening any table policy.
-- Note that `can_read_all` already grants both roles company-wide profile reads;
-- this is about narrowing the payload, not unlocking it.
create or replace function public.search_approver_candidates(p_query text)
returns table (id uuid, full_name text, personnel_no text, employee_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
  v_q text := btrim(coalesce(p_query, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not (private.is_admin(v_uid) or private.has_role(v_uid, 'hr')) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;

  select company_id into v_company from public.profiles where public.profiles.id = v_uid;

  return query
    select p.id, p.full_name, p.personnel_no, p.employee_code
      from public.profiles p
     where p.company_id = v_company
       and p.active
       and (
         v_q = ''
         or p.full_name ilike '%' || v_q || '%'
         or p.personnel_no ilike v_q || '%'
         or p.employee_code ilike v_q || '%'
       )
     order by p.full_name
     limit 20;
end;
$$;

revoke all on function public.search_approver_candidates(text) from public;
revoke all on function public.search_approver_candidates(text) from anon;
grant execute on function public.search_approver_candidates(text) to authenticated;

-- ── assert what the rest of FR-42 rests on ───────────────────────────────────
do $$
begin
  -- The engine refuses a deactivated named approver by asking has_role/is_active
  -- rather than by any new check of its own, so this must remain true.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'is_active'
  ) then
    raise exception 'FR-42: private.is_active must exist — the named-approver block depends on it';
  end if;

  -- Every pre-FR-42 evidence row must still be addressable by the new key.
  if exists (
    select 1 from public.leave_request_approvals
     where step_id is null and step_role is null
  ) then
    raise exception 'FR-42: an evidence row has neither step_id nor step_role and cannot be keyed';
  end if;
end $$;
