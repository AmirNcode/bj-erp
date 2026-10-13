-- FR-55 (3/4): every catalog-area gate moves from hard-coded roles to permissions.
-- Spec: docs/specs/2026-10-07-configurable-roles-design.md ("Policies and gates that change").
-- Only the guards change; bodies are copied from supabase/schema.sql at 6240e3c
-- (checked equal to the live definitions). Presets keep today's behaviour, apart
-- from D7 (no self-appointment) and D4 (nobody acts on someone who holds more).
-- Reconciled with main's 20261012120001..20261013120001: of the bodies copied here
-- main changed only app_import_personal_info (FR-63 own-row refusal, kept below);
-- the settings policies follow main's *_editor names; the personal-info update
-- policy follows FR-63 (own row only with personal_info_own); and
-- request_approval_progress (FR-64) gets the same reader set as leave_requests_select.
-- approve_leave_request, reject_leave_request and the approval_steps_role_allowed
-- CHECK are main's and are not touched by FR-55.
-- private.can_read_all stays for the deploy window; nothing calls it after this.

-- ── broad reads ─────────────────────────────────────────────────────────────
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((id = (select auth.uid()))
         or (private.is_active((select auth.uid()))
             and (private.same_team((select auth.uid()), id) or private.reads_people((select auth.uid())))));

drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((user_id = (select auth.uid())) or private.reads_people((select auth.uid()))));

drop policy leave_ledger_select on public.leave_ledger;
create policy leave_ledger_select on public.leave_ledger for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid()))
              or private.is_manager_of((select auth.uid()), employee_id)
              or private.reads_balances((select auth.uid()))));

drop policy leave_allocations_select on public.leave_allocations;
create policy leave_allocations_select on public.leave_allocations for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid()))
              or private.is_manager_of((select auth.uid()), employee_id)
              or private.reads_balances((select auth.uid()))));

drop policy employee_leave_policies_select on public.employee_leave_policies;
create policy employee_leave_policies_select on public.employee_leave_policies for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid()))
              or private.is_manager_of((select auth.uid()), employee_id)
              or private.reads_balances((select auth.uid()))));

create or replace view public.team_leave_calendar as
 SELECT lr.id,
    lr.employee_id,
    p.full_name AS employee_name,
    p.department_id,
    lr.kind,
    lr.leave_type_id,
    lt.name_fa AS leave_type_name_fa,
    lt.name_en AS leave_type_name_en,
    lt.color AS leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    lr.requested_minutes,
    lr.status
   FROM ((public.leave_requests lr
     JOIN public.profiles p ON ((p.id = lr.employee_id)))
     LEFT JOIN public.leave_types lt ON ((lt.id = lr.leave_type_id)))
  WHERE (private.is_active(auth.uid()) AND (lr.status = ANY (ARRAY['pending'::public.leave_status, 'approved'::public.leave_status])) AND ((lr.employee_id = auth.uid()) OR private.same_team(auth.uid(), lr.employee_id) OR private.reads_calendar(auth.uid())));

-- ── leave_requests reads: leave_requests read replaces the literal security / admin / hr ──
drop policy leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid()))
              or private.is_manager_of((select auth.uid()), employee_id)
              or private.has_perm((select auth.uid()), 'leave_requests', 'read')));
comment on policy leave_requests_select on public.leave_requests is
  'Full base row: own, direct manager, or leave_requests read (admin; the hr and security presets) (FR-38, FR-55). Teammates read the reason-less team_leave_calendar view instead — FR-25.';

drop policy leave_request_approvals_select on public.leave_request_approvals;
create policy leave_request_approvals_select on public.leave_request_approvals for select to authenticated
  using (private.is_active((select auth.uid()))
         and exists (select 1 from public.leave_requests r
                      where r.id = leave_request_approvals.request_id
                        and ((r.employee_id = (select auth.uid()))
                             or private.is_manager_of((select auth.uid()), r.employee_id)
                             or private.has_perm((select auth.uid()), 'leave_requests', 'read'))));

-- ── profiles and departments writes (were the employees.edit / departments.edit aliases) ──
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (private.is_active((select auth.uid()))
         and (private.is_admin((select auth.uid()))
              or private.has_perm((select auth.uid()), 'people', 'edit')
              or private.is_manager_of((select auth.uid()), id)
              or (id = (select auth.uid()))))
  with check (private.is_active((select auth.uid()))
         and (private.is_admin((select auth.uid()))
              or private.has_perm((select auth.uid()), 'people', 'edit')
              or private.is_manager_of((select auth.uid()), id)
              or (id = (select auth.uid()))));

drop policy departments_insert_editor on public.departments;
create policy departments_insert_editor on public.departments for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'departments', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));

drop policy departments_update_editor on public.departments;
create policy departments_update_editor on public.departments for update to authenticated
  using (private.has_perm((select auth.uid()), 'departments', 'edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
  with check (private.has_perm((select auth.uid()), 'departments', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));

-- ── approval chain, work settings, holidays ─────────────────────────────────
drop policy approval_steps_insert_config on public.approval_steps;
create policy approval_steps_insert_config on public.approval_steps for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit'));
drop policy approval_steps_update_config on public.approval_steps;
create policy approval_steps_update_config on public.approval_steps for update to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit'))
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit'));
drop policy approval_steps_delete_config on public.approval_steps;
create policy approval_steps_delete_config on public.approval_steps for delete to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit'));

-- work_settings / holidays: main (20261012120004) replaced the *_admin policies
-- with *_editor ones on the legacy key settings.edit + the caller's company. The
-- same policies now key on the catalog items, company scope kept. Unchanged:
-- work_settings_delete_admin (admin only) and the work_settings_enforce_scope
-- trigger, which keeps approval_order_enforced and hours_per_day admin-only
-- whatever work_settings level a role holds.
drop policy work_settings_insert_editor on public.work_settings;
create policy work_settings_insert_editor on public.work_settings for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'work_settings', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
drop policy work_settings_update_editor on public.work_settings;
create policy work_settings_update_editor on public.work_settings for update to authenticated
  using (private.has_perm((select auth.uid()), 'work_settings', 'edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
  with check (private.has_perm((select auth.uid()), 'work_settings', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));

drop policy holidays_insert_editor on public.holidays;
create policy holidays_insert_editor on public.holidays for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'holidays', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
drop policy holidays_update_editor on public.holidays;
create policy holidays_update_editor on public.holidays for update to authenticated
  using (private.has_perm((select auth.uid()), 'holidays', 'edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
  with check (private.has_perm((select auth.uid()), 'holidays', 'edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
drop policy holidays_delete_editor on public.holidays;
create policy holidays_delete_editor on public.holidays for delete to authenticated
  using (private.has_perm((select auth.uid()), 'holidays', 'edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));

-- ── personal information ────────────────────────────────────────────────────
drop policy employee_personal_info_select on public.employee_personal_info;
create policy employee_personal_info_select on public.employee_personal_info for select to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid()))
              or (private.has_perm((select auth.uid()), 'personal_info', 'read')
                  and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))));

-- FR-63 (main, 20261012130001) + FR-55: one's own row only with personal_info_own
-- (the admin holds it implicitly); anyone else's with personal_info edit, in the
-- caller's company, and can_act_on (D4: never the admin, nobody who holds more).
-- The admin skips can_act_on but keeps the company scope.
-- employee_id is pinned by private.personal_info_before_update, so WITH CHECK only
-- needs the caller's side.
drop policy employee_personal_info_update on public.employee_personal_info;
create policy employee_personal_info_update on public.employee_personal_info for update to authenticated
  using (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid())
               and private.has_perm((select auth.uid()), 'personal_info_own', 'edit'))
              or (employee_id <> (select auth.uid())
                  and private.has_perm((select auth.uid()), 'personal_info', 'edit')
                  and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
                  and (private.is_admin((select auth.uid()))
                       or private.can_act_on((select auth.uid()), employee_id)))))
  with check (private.is_active((select auth.uid()))
         and ((employee_id = (select auth.uid())
               and private.has_perm((select auth.uid()), 'personal_info_own', 'edit'))
              or (employee_id <> (select auth.uid())
                  and private.has_perm((select auth.uid()), 'personal_info', 'edit')
                  and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))));

-- ── functions ───────────────────────────────────────────────────────────────
-- editor branch: people edit + can_act_on (was employees.edit + same company + no admin row); new passwords branch
CREATE OR REPLACE FUNCTION private.enforce_profile_update_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if coalesce(current_setting('bj.separation_apply', true), '') = 'on'
     and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
  elsif private.has_perm(v_uid, 'passwords', 'edit') and private.can_act_on(v_uid, old.id) then
    -- FR-55: a password reset only flips must_change_password, which the check
    -- below admits under bj.password_flag_write. No other column.
    v_allowed := '{}'::text[];
  else
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.personnel_no  is distinct from old.personnel_no)
     or (new.created_at    is distinct from old.created_at)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.department_id is distinct from old.department_id and not ('department_id' = any (v_allowed)))
     or (new.manager_id    is distinct from old.manager_id    and not ('manager_id'    = any (v_allowed)))
     or (new.job_title     is distinct from old.job_title     and not ('job_title'     = any (v_allowed)))
     or (new.active        is distinct from old.active        and not ('active'        = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

-- adds D7
CREATE OR REPLACE FUNCTION private.enforce_department_update_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and not exists (
       select 1 from public.profiles where id = new.manager_id and company_id = new.company_id
     )
  then
    raise exception 'department manager must belong to the same company' using errcode = '22023';
  end if;

  -- FR-55 D7: a non-admin never appoints themselves (any department, insert or update).
  if not private.is_admin(v_uid) and new.manager_id = v_uid
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id) then
    raise exception 'you cannot appoint yourself department manager' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or private.is_admin(v_uid) then
    return new;
  end if;

  if (new.id         is distinct from old.id)
     or (new.company_id is distinct from old.company_id)
     or (new.code       is distinct from old.code)
     or (new.kind       is distinct from old.kind)
     or (new.created_at is distinct from old.created_at)
  then
    raise exception 'not permitted to modify restricted department fields' using errcode = '42501';
  end if;

  if new.manager_id is distinct from old.manager_id
     and exists (select 1 from public.profiles where id = v_uid and department_id = old.id)
  then
    raise exception 'you cannot change the manager of your own department' using errcode = '42501';
  end if;

  return new;
end; $$;

-- leave_balances edit + can_act_on (was admin or hr, not self)
CREATE OR REPLACE FUNCTION public.allocate_leave(p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can allocate leave' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_act_on(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  return private.allocate_leave_impl(auth.uid(), p_employee_id, p_leave_type_id,
                                     p_period_start, p_period_end, p_minutes);
end; $$;

-- leave_balances edit + can_act_on (was admin or hr, not self)
CREATE OR REPLACE FUNCTION public.set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_current int;
  v_ledger uuid;
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_act_on(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;

  -- FR-48: a balance may be negative (leave taken in advance). Bounded at one
  -- year of workdays below zero so a typo cannot post an absurd debit.
  if p_target_minutes is null
     or p_target_minutes < -366 * private.company_minutes_per_day(
          (select company_id from public.profiles where id = p_employee_id)) then
    raise exception 'target balance is out of range' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $$;

-- leave_balances edit + can_act_on (was admin or hr, not self)
CREATE OR REPLACE FUNCTION public.set_employee_leave_policy(p_employee_id uuid, p_leave_type_id uuid, p_accrual_minutes_per_month integer, p_annual_cap_minutes integer, p_carryover_cap_minutes integer, p_accrual_start_month date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_id uuid;
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set a leave policy' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_act_on(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  if p_accrual_minutes_per_month is null or p_accrual_minutes_per_month < 0 then
    raise exception 'accrual per month must be 0 or more' using errcode = '22023';
  end if;
  if p_carryover_cap_minutes is null or p_carryover_cap_minutes < 0 then
    raise exception 'carryover cap must be 0 or more' using errcode = '22023';
  end if;
  if p_annual_cap_minutes is not null and p_annual_cap_minutes < 0 then
    raise exception 'annual cap must be 0 or more' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jalali_months where gregorian_start = p_accrual_start_month) then
    raise exception 'accrual start month must be a jalali month start' using errcode = '22023';
  end if;

  insert into public.employee_leave_policies as elp (
    employee_id, leave_type_id, accrual_minutes_per_month,
    annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
  ) values (
    p_employee_id, p_leave_type_id, p_accrual_minutes_per_month,
    p_annual_cap_minutes, p_carryover_cap_minutes, p_accrual_start_month, auth.uid()
  )
  on conflict (employee_id, leave_type_id) do update
     set accrual_minutes_per_month = excluded.accrual_minutes_per_month,
         annual_cap_minutes        = excluded.annual_cap_minutes,
         carryover_cap_minutes     = excluded.carryover_cap_minutes,
         accrual_start_month       = excluded.accrual_start_month
  returning elp.id into v_id;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_employee_leave_policy', 'employee_leave_policies', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'accrual_minutes_per_month', p_accrual_minutes_per_month,
                             'annual_cap_minutes', p_annual_cap_minutes,
                             'carryover_cap_minutes', p_carryover_cap_minutes,
                             'accrual_start_month', p_accrual_start_month));
  return v_id;
end; $$;

-- is_manager_of or leave_balances read (was manager-of, admin or hr)
CREATE OR REPLACE FUNCTION public.accrue_employee_leave(p_employee_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := auth.uid(); v_type uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- FR-43: hr joins manager-of and admin. This posts only months the policy has
  -- ALREADY earned — it credits nothing that was not due — and it runs lazily on
  -- every balance read. Without hr here, the balances HR now reads on the Edit
  -- Employee screen would silently lag behind the accrual policy HR just set.
  if not (private.is_manager_of(v_uid, p_employee_id)
          or private.has_perm(v_uid, 'leave_balances', 'read')) then
    raise exception 'not allowed to accrue for this employee' using errcode = '42501';
  end if;

  for v_type in
    select leave_type_id from public.employee_leave_policies where employee_id = p_employee_id
  loop
    perform public.accrue_leave(p_employee_id, v_type);
  end loop;
end; $$;

-- leave_accrual (was accruals.run)
CREATE OR REPLACE FUNCTION public.accrue_all_leave() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_p            record;
  v_employees    int := 0;
  v_rows_before  int;
  v_rows_after   int;
  v_last_emp     uuid;
begin
  if not private.has_perm(auth.uid(), 'leave_accrual', 'edit') then
    raise exception 'not allowed to post accruals' using errcode = '42501';
  end if;

  select count(*) into v_rows_before from public.leave_ledger where period_month is not null;

  for v_p in
    select p.employee_id, p.leave_type_id
      from public.employee_leave_policies p
      join public.profiles pr on pr.id = p.employee_id
     where pr.active
       and p.accrual_minutes_per_month > 0
     order by p.employee_id
  loop
    perform public.accrue_leave(v_p.employee_id, v_p.leave_type_id);
    if v_last_emp is null or v_last_emp <> v_p.employee_id then
      v_employees := v_employees + 1;
      v_last_emp := v_p.employee_id;
    end if;
  end loop;

  select count(*) into v_rows_after from public.leave_ledger where period_month is not null;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'accrue_all_leave', 'leave_ledger', null,
          jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before));

  return jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before);
end; $$;

-- approval_steps edit (was admin or hr)
CREATE OR REPLACE FUNCTION public.search_approver_candidates(p_query text) RETURNS TABLE(id uuid, full_name text, personnel_no text, employee_code text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
  v_q text := btrim(coalesce(p_query, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.has_perm(v_uid, 'approval_steps', 'edit') then
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

-- personal_info read (was the personal_info.view alias)
CREATE OR REPLACE FUNCTION public.app_export_personal_info() RETURNS TABLE(personnel_no text, employee_code text, full_name text, active boolean, national_id text, birth_cert_no text, father_name text, birth_date date, birth_place text, gender text, marital_status text, bank_name text, bank_account_no text, sheba text, card_no text, mobile text, home_phone text, address text, postal_code text, emergency_name text, emergency_phone text, insurance_no text, education text, military_status text, children_count smallint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_count   int;
begin
  if not private.has_perm(v_uid, 'personal_info', 'read') then
    raise exception 'not permitted to export personal info' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  select count(*) into v_count from public.employee_personal_info where company_id = v_company;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.export', 'employee_personal_info', null,
          jsonb_build_object('rows', v_count));

  return query
    select p.personnel_no, p.employee_code, p.full_name, p.active,
           i.national_id, i.birth_cert_no, i.father_name, i.birth_date, i.birth_place,
           i.gender, i.marital_status, i.bank_name, i.bank_account_no, i.sheba,
           i.card_no, i.mobile, i.home_phone, i.address, i.postal_code,
           i.emergency_name, i.emergency_phone, i.insurance_no, i.education,
           i.military_status, i.children_count
      from public.employee_personal_info i
      join public.profiles p on p.id = i.employee_id
     where i.company_id = v_company
     order by p.active desc, p.personnel_no nulls last, p.full_name;
end; $$;

-- personal_info edit; per row can_act_on (was: not an admin row). Body from main's
-- 20261012130001: one's own row follows personal_info_own (FR-63), every other row
-- can_act_on for a non-admin (which also refuses the admin's row).
CREATE OR REPLACE FUNCTION public.app_import_personal_info(p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_is_admin boolean := private.is_admin(auth.uid());
  v_row      jsonb;
  v_pno      text;
  v_target   uuid;
  v_updated  int := 0;
  v_fields   constant text[] := array[
    'national_id','birth_cert_no','father_name','birth_date','birth_place','gender',
    'marital_status','bank_name','bank_account_no','sheba','card_no','mobile','home_phone',
    'address','postal_code','emergency_name','emergency_phone','insurance_no','education',
    'military_status','children_count'];
  v_key      text;
begin
  if not private.has_perm(v_uid, 'personal_info', 'edit') then
    raise exception 'not permitted to import personal info' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (max 2000)' using errcode = '22023';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  if (select count(distinct r->>'personnel_no') <> count(*) from jsonb_array_elements(p_rows) r) then
    raise exception 'duplicate personnel number in file' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_pno := v_row->>'personnel_no';
    select id into v_target from public.profiles
     where company_id = v_company and personnel_no = v_pno;
    if v_target is null then
      raise exception 'unknown personnel number: %', coalesce(v_pno, '(empty)') using errcode = '22023';
    end if;
    -- FR-63: one's own row follows personal_info_own, not the import.
    if v_target = v_uid then
      if not private.has_perm(v_uid, 'personal_info_own', 'edit') then
        raise exception 'not permitted to edit your own personal info: %', v_pno using errcode = '42501';
      end if;
    elsif not v_is_admin and not private.can_act_on(v_uid, v_target) then
      raise exception 'not permitted to edit this person''s personal info: %', v_pno using errcode = '42501';
    end if;
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key <> 'personnel_no' and not (v_key = any (v_fields)) then
        raise exception 'unknown field: %', v_key using errcode = '22023';
      end if;
    end loop;

    update public.employee_personal_info i set
      national_id     = coalesce(v_row->>'national_id', i.national_id),
      birth_cert_no   = coalesce(v_row->>'birth_cert_no', i.birth_cert_no),
      father_name     = coalesce(v_row->>'father_name', i.father_name),
      birth_date      = coalesce((v_row->>'birth_date')::date, i.birth_date),
      birth_place     = coalesce(v_row->>'birth_place', i.birth_place),
      gender          = coalesce(v_row->>'gender', i.gender),
      marital_status  = coalesce(v_row->>'marital_status', i.marital_status),
      bank_name       = coalesce(v_row->>'bank_name', i.bank_name),
      bank_account_no = coalesce(v_row->>'bank_account_no', i.bank_account_no),
      sheba           = coalesce(v_row->>'sheba', i.sheba),
      card_no         = coalesce(v_row->>'card_no', i.card_no),
      mobile          = coalesce(v_row->>'mobile', i.mobile),
      home_phone      = coalesce(v_row->>'home_phone', i.home_phone),
      address         = coalesce(v_row->>'address', i.address),
      postal_code     = coalesce(v_row->>'postal_code', i.postal_code),
      emergency_name  = coalesce(v_row->>'emergency_name', i.emergency_name),
      emergency_phone = coalesce(v_row->>'emergency_phone', i.emergency_phone),
      insurance_no    = coalesce(v_row->>'insurance_no', i.insurance_no),
      education       = coalesce(v_row->>'education', i.education),
      military_status = coalesce(v_row->>'military_status', i.military_status),
      children_count  = coalesce((v_row->>'children_count')::smallint, i.children_count)
     where i.employee_id = v_target;
    v_updated := v_updated + 1;
  end loop;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.import', 'employee_personal_info', null,
          jsonb_build_object('rows', v_updated));

  return jsonb_build_object('updated', v_updated);
end; $$;

-- clearance edit; leaver must pass can_act_on (was: not an admin row)
CREATE OR REPLACE FUNCTION private.separation_manageable(p_uid uuid, p_company uuid, p_employee uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.has_perm(p_uid, 'clearance', 'edit') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee and company_id = p_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  if not private.is_admin(p_uid) and not private.can_act_on(p_uid, p_employee) then
    raise exception 'not allowed to file a clearance form for this employee' using errcode = '42501';
  end if;
end; $$;

-- clearance read (was separations.view)
CREATE OR REPLACE FUNCTION private.can_read_separation(uid uuid, p_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_active(uid)
     and exists (
       select 1
         from public.separations s
         join public.profiles c on c.id = uid and c.company_id = s.company_id
        where s.id = p_id
          and (private.has_perm(uid, 'clearance', 'read')
               or s.employee_id = uid
               or exists (select 1 from public.separation_signoffs o
                           where o.separation_id = s.id and o.signer_id = uid))
     );
$$;

-- clearance edit (was separations.manage)
CREATE OR REPLACE FUNCTION public.app_save_separation_units(p_units jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_unit    jsonb;
  v_id      uuid;
  v_kind    text;
  v_dept    uuid;
  v_signer  uuid;
  v_keep    uuid[] := '{}';
  v_i       integer := 0;
begin
  if not private.has_perm(v_uid, 'clearance', 'edit') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  insert into public.separation_units (company_id, kind, name_fa, name_en, sort_order)
  values (v_company, 'hr', 'مدیر اداری و منابع انسانی', 'HR & administration', 0)
  on conflict (company_id) where kind = 'hr' do nothing;

  for v_unit in select value from jsonb_array_elements(p_units) loop
    v_kind := v_unit->>'kind';
    if jsonb_typeof(v_unit) <> 'object'
       or coalesce(char_length(btrim(v_unit->>'name_fa')), 0) not between 1 and 100
       or coalesce(char_length(btrim(v_unit->>'name_en')), 0) not between 1 and 100 then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_kind = 'hr' then
      update public.separation_units
         set name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en')
       where company_id = v_company and kind = 'hr';
      continue;
    end if;
    if v_kind is null or v_kind not in ('department', 'own_department', 'person') then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_i := v_i + 1;
    v_dept   := case when v_kind = 'department' then nullif(v_unit->>'department_id', '')::uuid end;
    v_signer := case when v_kind = 'person' then nullif(v_unit->>'signer_id', '')::uuid end;
    if v_kind = 'department' and (v_dept is null or not exists (
         select 1 from public.departments where id = v_dept and company_id = v_company)) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_signer is not null and not exists (
         select 1 from public.profiles where id = v_signer and company_id = v_company and active) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_id := nullif(v_unit->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.separation_units
                                     where id = v_id and company_id = v_company and kind <> 'hr') then
      update public.separation_units
         set kind = v_kind, name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en'),
             department_id = v_dept, signer_id = v_signer, sort_order = v_i,
             active = coalesce((v_unit->>'active')::boolean, true)
       where id = v_id;
    else
      insert into public.separation_units (company_id, kind, name_fa, name_en, department_id, signer_id, sort_order, active)
      values (v_company, v_kind, btrim(v_unit->>'name_fa'), btrim(v_unit->>'name_en'), v_dept, v_signer, v_i,
              coalesce((v_unit->>'active')::boolean, true))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.separation_units
   where company_id = v_company and kind <> 'hr' and not (id = any (v_keep));
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.units', 'separation_units', null, jsonb_build_object('units', v_i + 1));
end; $$;

-- clearance edit (was separations.manage)
CREATE OR REPLACE FUNCTION public.app_separation_warnings(p_employee_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
begin
  if not private.has_perm(v_uid, 'clearance', 'edit') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee_id and company_id = v_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending_requests', (select count(*) from public.leave_requests
                          where employee_id = p_employee_id and status = 'pending'),
    'direct_reports', (select count(*) from public.profiles
                        where manager_id = p_employee_id and active),
    'departments_managed', (select count(*) from public.departments
                             where manager_id = p_employee_id),
    'approval_steps', (select count(*) from public.approval_steps
                        where approver_id = p_employee_id and active));
end; $$;

-- admin, or passwords + can_act_on (was admin only)
CREATE OR REPLACE FUNCTION public.app_set_employee_password(p_user_id uuid, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rows int;
begin
  if not (private.is_admin(auth.uid())
          or (private.has_perm(auth.uid(), 'passwords', 'edit')
              and private.can_act_on(auth.uid(), p_user_id))) then
    raise exception 'not allowed to reset this password' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_password, '')) > 72 then
    raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  -- An admin resetting their own password chose it themselves.
  -- A non-admin caller passes the profile guard only with this flag (FR-55).
  perform set_config('bj.password_flag_write', 'on', true);
  update public.profiles
     set must_change_password = (p_user_id <> auth.uid())
   where id = p_user_id;
  perform set_config('bj.password_flag_write', '', true);

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
end;
$$;

-- admin, or passwords + can_act_on per target (was admin only)
CREATE OR REPLACE FUNCTION public.app_bulk_set_employee_passwords(p_resets jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_row   record;
  v_count int;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'passwords', 'edit')) then
    raise exception 'not allowed to reset passwords' using errcode = '42501';
  end if;
  if jsonb_typeof(p_resets) <> 'array' then
    raise exception 'password resets must be an array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_resets);
  if v_count < 1 or v_count > 100 then
    raise exception 'select between 1 and 100 employees' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct item->>'user_id')
      from jsonb_array_elements(p_resets) item
  ) then
    raise exception 'duplicate employee in password reset' using errcode = '22023';
  end if;

  -- Validate the complete payload before changing the first credential.
  for v_row in
    select (item->>'user_id')::uuid as user_id, item->>'password' as password
      from jsonb_array_elements(p_resets) item
  loop
    if v_row.user_id = v_uid then
      raise exception 'cannot bulk-reset your own password' using errcode = '22023';
    end if;
    if length(coalesce(v_row.password, '')) < 8 then
      raise exception 'new password must be at least 8 characters' using errcode = '22023';
    end if;
    if octet_length(coalesce(v_row.password, '')) > 72 then
      raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
    end if;
    if not exists (
      select 1
        from auth.users u
        join public.profiles p on p.id = u.id
       where u.id = v_row.user_id
    ) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    -- FR-55 D4: every target, before the first credential changes.
    if not private.is_admin(v_uid) and not private.can_act_on(v_uid, v_row.user_id) then
      raise exception 'not allowed on %',
        (select personnel_no from public.profiles where id = v_row.user_id) using errcode = '42501';
    end if;
  end loop;

  for v_row in
    select (item->>'user_id')::uuid as user_id, item->>'password' as password
      from jsonb_array_elements(p_resets) item
  loop
    update auth.users
       set encrypted_password = extensions.crypt(v_row.password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_row.user_id;

    -- A non-admin caller passes the profile guard only with this flag (FR-55).
    perform set_config('bj.password_flag_write', 'on', true);
    update public.profiles
       set must_change_password = true
     where id = v_row.user_id;
    perform set_config('bj.password_flag_write', '', true);

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'reset_password', 'auth.users', v_row.user_id);
  end loop;
end;
$$;

-- admin or people_create (was admin or hr); non-admin clamps kept
CREATE OR REPLACE FUNCTION public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb, p_departments jsonb, p_balance_as_of date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_caller        uuid := auth.uid();
  v_bulk_hr       boolean;
  v_today         date := (now() at time zone 'Asia/Tehran')::date;
  v_dep           jsonb;
  v_row           jsonb;
  v_i             integer := 0;
  v_dept          uuid;
  v_mgr_pno       text;
  v_mgr           uuid;
  v_role          text;
  v_uid           uuid;
  v_code          text;
  v_minutes       int;
  v_prev          int;
  v_ledger        uuid;
  v_annual_type   uuid;
  v_rate          int;
  v_cap           int;
  v_carry         int;
  v_accrual_start date;
  v_dm            uuid;
  v_result        jsonb := '[]'::jsonb;
begin
  -- FR-55: the non-admin branch keys on people_create; its clamps are unchanged.
  v_bulk_hr := private.has_perm(v_caller, 'people_create', 'edit') and not private.is_admin(v_caller);
  if not (private.is_admin(v_caller) or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  -- Tenant binding: the company comes from the request, so it must be the
  -- caller's own. Without this an admin of one company could import into another.
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if p_departments is null or jsonb_typeof(p_departments) <> 'array' then
    raise exception 'departments must be an array' using errcode = '22023';
  end if;
  if p_balance_as_of is null then
    raise exception 'balance date is required' using errcode = '22023';
  end if;
  if p_balance_as_of > v_today then
    raise exception 'balance date cannot be in the future' using errcode = '22023';
  end if;

  -- First Jalali month after the one containing the balance date. Raises
  -- through the join if the date is outside the seeded calendar.
  select n.gregorian_start into v_accrual_start
    from public.jalali_months m
    join public.jalali_months n on n.gregorian_start = m.gregorian_end + 1
   where p_balance_as_of between m.gregorian_start and m.gregorian_end;
  if v_accrual_start is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  select id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes
    into v_annual_type, v_rate, v_cap, v_carry
    from public.leave_types
   where company_id = p_company_id and name_en = 'Annual Leave' and affects_balance;

  -- 1. Departments.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    v_code := upper(btrim(coalesce(v_dep->>'code', '')));
    if v_code !~ '^[A-Z0-9]{2,4}$' then
      raise exception 'invalid department code "%"', v_code using errcode = '22023';
    end if;
    if coalesce((v_dep->>'create')::boolean, false) then
      if v_bulk_hr then
        raise exception 'only admins can create departments' using errcode = '42501';
      end if;
      if exists (select 1 from public.departments where company_id = p_company_id and code = v_code) then
        raise exception 'department code "%" already exists', v_code using errcode = '23505';
      end if;
      if coalesce(btrim(v_dep->>'name_fa'), '') = '' or coalesce(btrim(v_dep->>'name_en'), '') = '' then
        raise exception 'department "%" needs a Farsi and an English name', v_code using errcode = '22023';
      end if;
      insert into public.departments (company_id, name_fa, name_en, kind, code)
      values (p_company_id, btrim(v_dep->>'name_fa'), btrim(v_dep->>'name_en'), 'team', v_code);
    end if;
  end loop;

  -- 2–4. Employees, opening balances, accrual policies.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    v_role := coalesce(v_row->>'role', 'employee');
    -- FR-35 / spec D4: HR may bulk-onboard, but only ordinary employees.
    if v_bulk_hr then
      v_role := 'employee';
    end if;
    if v_role not in ('manager', 'employee') then
      raise exception 'row %: role must be manager or employee', v_i using errcode = '22023';
    end if;

    select id into v_dept from public.departments
     where company_id = p_company_id and code = upper(btrim(coalesce(v_row->>'department_code', '')));
    if v_dept is null then
      raise exception 'row %: unknown department code "%"', v_i, v_row->>'department_code' using errcode = '22023';
    end if;

    v_mgr := null;
    v_mgr_pno := coalesce(nullif(btrim(coalesce(v_row->>'supervisor_personnel_no', '')), ''),
                          nullif(btrim(coalesce(v_row->>'manager_personnel_no', '')), ''));
    if v_mgr_pno is not null then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = v_mgr_pno;
      if v_mgr is null then
        raise exception 'row %: manager with personnel number % not found (list managers before their team)',
          v_i, v_mgr_pno using errcode = '22023';
      end if;
    end if;

    v_uid := private.create_employee_impl(
      v_caller, case when v_bulk_hr then 'bulk_hr' else 'bulk' end, p_company_id, v_dept, v_mgr,
      v_row->>'personnel_no', v_row->>'full_name', v_row->>'password',
      (case when v_role = 'manager' then array['manager','employee'] else array['employee'] end)::public.app_role[],
      nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title');

    v_minutes := coalesce(nullif(v_row->>'balance_minutes', ''), '0')::int;
    if v_minutes < -366 * private.company_minutes_per_day(p_company_id)
       or v_minutes > 366 * private.company_minutes_per_day(p_company_id) then
      raise exception 'row %: opening balance is out of range', v_i using errcode = '22023';
    end if;
    if v_minutes <> 0 then
      if v_annual_type is null then
        raise exception 'row %: leave type "Annual Leave" not found', v_i using errcode = '22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
      v_prev := public.current_leave_balance(v_uid, v_annual_type);
      insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
      values (v_uid, v_annual_type, 'adjustment', v_minutes, v_prev + v_minutes,
              'opening balance as of ' || p_balance_as_of::text)
      returning id into v_ledger;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
              jsonb_build_object('employee_id', v_uid, 'leave_type_id', v_annual_type,
                                 'minutes', v_minutes, 'as_of', p_balance_as_of));
    end if;

    if v_annual_type is not null and coalesce(v_rate, 0) > 0 then
      insert into public.employee_leave_policies (
        employee_id, leave_type_id, accrual_minutes_per_month,
        annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
      ) values (
        v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller
      )
      on conflict (employee_id, leave_type_id) do nothing;
    end if;

    select employee_code into v_code from public.profiles where id = v_uid;
    v_result := v_result || jsonb_build_object(
      'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
  end loop;

  -- 5. Department managers — only where the department has none yet.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') = '' then
      continue;
    end if;
    if v_bulk_hr then
      raise exception 'only admins can assign department managers' using errcode = '42501';
    end if;
    select id into v_dm from public.profiles
     where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
    if v_dm is null then
      raise exception 'department manager with personnel number % not found',
        v_dep->>'manager_personnel_no' using errcode = '22023';
    end if;
    update public.departments
       set manager_id = v_dm
     where company_id = p_company_id
       and code = upper(btrim(v_dep->>'code'))
       and manager_id is null;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_create_employees', 'profiles', null,
          jsonb_build_object('count', jsonb_array_length(p_rows),
                             'departments_created',
                             (select count(*) from jsonb_array_elements(p_departments) d
                               where coalesce((d->>'create')::boolean, false)),
                             'balance_as_of', p_balance_as_of));

  return v_result;
end;
$_$;

-- admin or people_create in add mode (was admin or hr); update/replace stay admin (D2)
CREATE OR REPLACE FUNCTION public.app_bulk_import_employees(p_company_id uuid, p_mode text, p_rows jsonb, p_departments jsonb, p_balance_as_of date, p_overwrite_balances boolean, p_deactivate uuid[], p_reassign jsonb, p_delete_departments text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_caller        uuid := auth.uid();
  v_is_admin      boolean;
  v_bulk_hr       boolean;
  v_today         date := (now() at time zone 'Asia/Tehran')::date;
  v_dep           jsonb;
  v_row           jsonb;
  v_i             integer := 0;
  v_dept          uuid;
  v_mgr_pno       text;
  v_mgr           uuid;
  v_role          text;
  v_uid           uuid;
  v_existing      uuid;
  v_code          text;
  v_minutes       int;
  v_prev          int;
  v_ledger        uuid;
  v_annual_type   uuid;
  v_rate          int;
  v_cap           int;
  v_carry         int;
  v_accrual_start date;
  v_dm            uuid;
  v_id            uuid;
  v_created       jsonb := '[]'::jsonb;
  v_updated       int := 0;
  v_deactivated   int := 0;
  v_deleted       text[] := '{}';
  v_not_deleted   text[] := '{}';
  v_mpd           int;
begin
  v_is_admin := private.is_admin(v_caller);
  -- FR-55: the non-admin branch keys on people_create; its clamps are unchanged.
  v_bulk_hr  := private.has_perm(v_caller, 'people_create', 'edit') and not v_is_admin;
  if not (v_is_admin or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  -- Tenant binding: the company comes from the request, so it must be the
  -- caller's own. Without this an admin of one company could import into another.
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('add', 'update', 'replace') then
    raise exception 'import mode must be add, update or replace' using errcode = '22023';
  end if;
  if p_mode <> 'add' and not v_is_admin then
    raise exception 'only admins can update or replace employees by import' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if p_departments is null or jsonb_typeof(p_departments) <> 'array' then
    raise exception 'departments must be an array' using errcode = '22023';
  end if;
  if p_mode <> 'replace' and (coalesce(cardinality(p_deactivate), 0) > 0
       or coalesce(cardinality(p_delete_departments), 0) > 0
       or coalesce(jsonb_array_length(p_reassign), 0) > 0) then
    raise exception 'deactivation and department deletion need replace mode' using errcode = '22023';
  end if;
  if p_balance_as_of is null then
    raise exception 'balance date is required' using errcode = '22023';
  end if;
  if p_balance_as_of > v_today then
    raise exception 'balance date cannot be in the future' using errcode = '22023';
  end if;

  select n.gregorian_start into v_accrual_start
    from public.jalali_months m
    join public.jalali_months n on n.gregorian_start = m.gregorian_end + 1
   where p_balance_as_of between m.gregorian_start and m.gregorian_end;
  if v_accrual_start is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  select id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes
    into v_annual_type, v_rate, v_cap, v_carry
    from public.leave_types
   where company_id = p_company_id and name_en = 'Annual Leave' and affects_balance;
  v_mpd := private.company_minutes_per_day(p_company_id);

  -- 1. Departments: create, or (update/replace) take the file's names.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    v_code := upper(btrim(coalesce(v_dep->>'code', '')));
    if v_code !~ '^[A-Z0-9]{2,4}$' then
      raise exception 'invalid department code "%"', v_code using errcode = '22023';
    end if;
    if coalesce((v_dep->>'create')::boolean, false) then
      if v_bulk_hr then
        raise exception 'only admins can create departments' using errcode = '42501';
      end if;
      if exists (select 1 from public.departments where company_id = p_company_id and code = v_code) then
        raise exception 'department code "%" already exists', v_code using errcode = '23505';
      end if;
      if coalesce(btrim(v_dep->>'name_fa'), '') = '' or coalesce(btrim(v_dep->>'name_en'), '') = '' then
        raise exception 'department "%" needs a Farsi and an English name', v_code using errcode = '22023';
      end if;
      insert into public.departments (company_id, name_fa, name_en, kind, code)
      values (p_company_id, btrim(v_dep->>'name_fa'), btrim(v_dep->>'name_en'), 'team', v_code);
    elsif p_mode <> 'add' and coalesce((v_dep->>'rename')::boolean, false) then
      update public.departments
         set name_fa = btrim(v_dep->>'name_fa'), name_en = btrim(v_dep->>'name_en')
       where company_id = p_company_id and code = v_code
         and coalesce(btrim(v_dep->>'name_fa'), '') <> '' and coalesce(btrim(v_dep->>'name_en'), '') <> '';
    end if;
  end loop;

  -- 2. Employees: create or update.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    v_role := coalesce(v_row->>'role', 'employee');
    if v_bulk_hr then
      v_role := 'employee';
    end if;
    if v_role not in ('manager', 'employee') then
      raise exception 'row %: role must be manager or employee', v_i using errcode = '22023';
    end if;

    select id into v_dept from public.departments
     where company_id = p_company_id and code = upper(btrim(coalesce(v_row->>'department_code', '')));
    if v_dept is null then
      raise exception 'row %: unknown department code "%"', v_i, v_row->>'department_code' using errcode = '22023';
    end if;

    v_mgr := null;
    v_mgr_pno := coalesce(nullif(btrim(coalesce(v_row->>'supervisor_personnel_no', '')), ''),
                          nullif(btrim(coalesce(v_row->>'manager_personnel_no', '')), ''));
    if v_mgr_pno is not null then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = v_mgr_pno;
      if v_mgr is null then
        raise exception 'row %: manager with personnel number % not found (list managers before their team)',
          v_i, v_mgr_pno using errcode = '22023';
      end if;
    end if;

    v_minutes := coalesce(nullif(v_row->>'balance_minutes', ''), '0')::int;
    if v_minutes < -366 * v_mpd or v_minutes > 366 * v_mpd then
      raise exception 'row %: opening balance is out of range', v_i using errcode = '22023';
    end if;

    select id into v_existing from public.profiles
     where company_id = p_company_id and personnel_no = btrim(coalesce(v_row->>'personnel_no', ''));

    if v_existing is not null then
      if p_mode = 'add' then
        raise exception 'personnel number already exists' using errcode = '23505';
      end if;
      v_uid := v_existing;

      update public.profiles
         set full_name     = btrim(v_row->>'full_name'),
             job_title     = nullif(btrim(coalesce(v_row->>'job_title', '')), ''),
             department_id = v_dept,
             manager_id    = v_mgr,
             hire_date     = coalesce(nullif(v_row->>'hire_date', '')::date, hire_date),
             active        = true
       where id = v_uid;

      -- Only the manager role follows the file; admin/hr/security are untouched.
      if v_role = 'manager' then
        insert into public.user_roles (user_id, role) values (v_uid, 'manager') on conflict do nothing;
      else
        delete from public.user_roles where user_id = v_uid and role = 'manager';
      end if;

      if coalesce(p_overwrite_balances, false) and v_annual_type is not null then
        perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
        v_prev := public.current_leave_balance(v_uid, v_annual_type);
        if v_prev <> v_minutes then
          insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
          values (v_uid, v_annual_type, 'adjustment', v_minutes - v_prev, v_minutes,
                  'opening balance as of ' || p_balance_as_of::text)
          returning id into v_ledger;
          insert into public.audit_log (actor_id, action, entity, entity_id, after)
          values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
                  jsonb_build_object('employee_id', v_uid, 'previous_minutes', v_prev,
                                     'minutes', v_minutes, 'as_of', p_balance_as_of));
        end if;
        if coalesce(v_rate, 0) > 0 then
          insert into public.employee_leave_policies (
            employee_id, leave_type_id, accrual_minutes_per_month,
            annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
          ) values (v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller)
          on conflict (employee_id, leave_type_id) do update
             set accrual_start_month = excluded.accrual_start_month;
        end if;
      end if;

      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_update_employee', 'profiles', v_uid,
              jsonb_build_object('personnel_no', v_row->>'personnel_no', 'mode', p_mode,
                                 'department_code', v_row->>'department_code', 'role', v_role));
      v_updated := v_updated + 1;
    else
      v_uid := private.create_employee_impl(
        v_caller, case when v_bulk_hr then 'bulk_hr' else 'bulk' end, p_company_id, v_dept, v_mgr,
        v_row->>'personnel_no', v_row->>'full_name', v_row->>'password',
        (case when v_role = 'manager' then array['manager','employee'] else array['employee'] end)::public.app_role[],
        nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title');

      if v_minutes <> 0 then
        if v_annual_type is null then
          raise exception 'row %: leave type "Annual Leave" not found', v_i using errcode = '22023';
        end if;
        perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
        v_prev := public.current_leave_balance(v_uid, v_annual_type);
        insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
        values (v_uid, v_annual_type, 'adjustment', v_minutes, v_prev + v_minutes,
                'opening balance as of ' || p_balance_as_of::text)
        returning id into v_ledger;
        insert into public.audit_log (actor_id, action, entity, entity_id, after)
        values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
                jsonb_build_object('employee_id', v_uid, 'leave_type_id', v_annual_type,
                                   'minutes', v_minutes, 'as_of', p_balance_as_of));
      end if;

      if v_annual_type is not null and coalesce(v_rate, 0) > 0 then
        insert into public.employee_leave_policies (
          employee_id, leave_type_id, accrual_minutes_per_month,
          annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
        ) values (v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller)
        on conflict (employee_id, leave_type_id) do nothing;
      end if;

      select employee_code into v_code from public.profiles where id = v_uid;
      v_created := v_created || jsonb_build_object(
        'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
    end if;
  end loop;

  -- 3. Kept people whose manager changes (replace).
  for v_dep in select * from jsonb_array_elements(coalesce(p_reassign, '[]'::jsonb)) loop
    v_id := (v_dep->>'id')::uuid;
    if not exists (select 1 from public.profiles where id = v_id and company_id = p_company_id) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    v_mgr := null;
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') <> '' then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
      if v_mgr is null then
        raise exception 'manager with personnel number % not found', v_dep->>'manager_personnel_no' using errcode = '22023';
      end if;
    end if;
    update public.profiles set manager_id = v_mgr where id = v_id;
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_caller, 'bulk_reassign_manager', 'profiles', v_id, jsonb_build_object('manager_id', v_mgr));
  end loop;

  -- 4. Deactivations (replace). Never an admin, never the caller.
  foreach v_id in array coalesce(p_deactivate, '{}'::uuid[]) loop
    if not exists (select 1 from public.profiles where id = v_id and company_id = p_company_id) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    if v_id = v_caller or exists (select 1 from public.user_roles where user_id = v_id and role = 'admin') then
      raise exception 'an import cannot deactivate an admin account' using errcode = '42501';
    end if;
    update public.profiles set active = false where id = v_id and active;
    if found then
      v_deactivated := v_deactivated + 1;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_deactivate', 'profiles', v_id, jsonb_build_object('mode', p_mode));
    end if;
  end loop;

  -- 5. Department managers.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') = '' then
      continue;
    end if;
    if v_bulk_hr then
      raise exception 'only admins can assign department managers' using errcode = '42501';
    end if;
    select id into v_dm from public.profiles
     where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
    if v_dm is null then
      raise exception 'department manager with personnel number % not found',
        v_dep->>'manager_personnel_no' using errcode = '22023';
    end if;
    update public.departments d
       set manager_id = v_dm
     where d.company_id = p_company_id
       and d.code = upper(btrim(v_dep->>'code'))
       and (p_mode <> 'add'
            or d.manager_id is null
            or not exists (select 1 from public.profiles m where m.id = d.manager_id and m.active));
  end loop;

  -- 6. Unused departments (replace): delete only if nobody, active or not, is in them.
  foreach v_code in array coalesce(p_delete_departments, '{}'::text[]) loop
    select id into v_dept from public.departments where company_id = p_company_id and code = upper(btrim(v_code));
    if v_dept is null then
      continue;
    end if;
    if exists (select 1 from public.profiles where department_id = v_dept) then
      v_not_deleted := v_not_deleted || upper(btrim(v_code));
    else
      delete from public.departments where id = v_dept;
      v_deleted := v_deleted || upper(btrim(v_code));
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_delete_department', 'departments', v_dept, jsonb_build_object('code', upper(btrim(v_code))));
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_import', 'profiles', null,
          jsonb_build_object('mode', p_mode, 'rows', jsonb_array_length(p_rows),
                             'created', jsonb_array_length(v_created), 'updated', v_updated,
                             'deactivated', v_deactivated, 'departments_deleted', to_jsonb(v_deleted),
                             'overwrite_balances', coalesce(p_overwrite_balances, false),
                             'balance_as_of', p_balance_as_of));

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'deactivated', v_deactivated,
    'deleted_departments', to_jsonb(v_deleted),
    'not_deleted_departments', to_jsonb(v_not_deleted)
  );
end;
$_$;

-- owner, admin, or leave_requests edit in the company and not on the admin (was owner or admin)
CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status public.leave_status;
  v_start date;
  v_type uuid;
  v_kind public.request_kind;
  v_minutes int;
  v_unpaid int;
  v_paid int;
  v_affects boolean;
  v_prev int;
  v_rows int;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          -- FR-55 D8: leave_requests at Allowed covers the company, apart from the admin.
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id = o.company_id and c.id = v_uid
                           where o.id = v_owner)
              and not exists (select 1 from public.user_roles where user_id = v_owner and role = 'admin'))) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, unpaid_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_unpaid, v_kind
    from public.leave_requests where id = p_id;
  v_paid := greatest(v_minutes - coalesce(v_unpaid, 0), 0);

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today))
  then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects and v_paid > 0 then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      ) values (
        v_owner, v_type, p_id, 'reversal',
        v_paid, v_prev + v_paid, 'paid portion reversed on cancel'
      );
    end if;
  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'requested_minutes', v_minutes,
      'paid_minutes_reversed', case when v_status = 'approved' then v_paid else 0 end,
      'unpaid_minutes', v_unpaid,
      'kind', v_kind,
      'reversed', (
        v_status = 'approved' and coalesce(v_affects, false) and v_paid > 0
      )
    )
  );
end;
$$;

-- FR-64 (main, 20261013120001): the progress of a request is readable by whoever
-- reads the request. Same reader set as leave_requests_select above: own, direct
-- manager, or leave_requests read (admin; the hr and security presets) instead of
-- the literal security / admin / hr. Body unchanged apart from that guard.
create or replace function public.request_approval_progress(p_id uuid)
returns table(
  step_order int,
  step_role public.app_role,
  manager_scope text,
  named boolean,
  expected_name text,
  decision public.leave_status,
  signer_name text,
  signed_at timestamptz
)
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_company uuid;
  v_kind    public.request_kind;
  v_status  public.leave_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select r.employee_id, r.company_id, r.kind, r.status
    into v_emp, v_company, v_kind, v_status
    from public.leave_requests r where r.id = p_id;
  if v_emp is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if not (private.is_active(v_uid)
          and (v_emp = v_uid
               or private.is_manager_of(v_uid, v_emp)
               or private.has_perm(v_uid, 'leave_requests', 'read'))) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  return query
  with decided as (
    select coalesce(s.step_order, 1) as step_order,
           a.step_role,
           coalesce(s.manager_scope, 'direct') as manager_scope,
           s.approver_id,
           a.decision,
           sp.full_name as signer_name,
           a.created_at as signed_at,
           a.step_id
      from public.leave_request_approvals a
      left join public.approval_steps s on s.id = a.step_id
      left join public.profiles sp on sp.id = a.approver_id
     where a.request_id = p_id
  ),
  outstanding as (
    select s.step_order, s.role as step_role, s.manager_scope, s.approver_id
      from public.approval_steps s
     where v_status = 'pending'
       and s.company_id = v_company
       and s.active
       and v_kind = any(s.applies_to)
       and private.step_applies(s.manager_scope, v_emp)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id or (a.step_id is null and a.step_role = s.role)))
  ),
  -- No chain configured at all: a pending request waits on the direct manager
  -- (the FR-36 degrade branch of approve_leave_request).
  fallback as (
    select 1 as step_order, 'manager'::public.app_role as step_role,
           'direct'::text as manager_scope, null::uuid as approver_id
     where v_status = 'pending'
       and not exists (select 1 from outstanding)
       and not exists (select 1 from decided)
       and not exists (
             select 1 from public.approval_steps s
              where s.company_id = v_company and s.active
                and v_kind = any(s.applies_to)
                and private.step_applies(s.manager_scope, v_emp))
  ),
  waiting as (
    select * from outstanding
    union all
    select * from fallback
  )
  select d.step_order, d.step_role, d.manager_scope, d.approver_id is not null,
         -- A named step keeps its person's name even when an admin override signed it.
         (select np.full_name from public.profiles np where np.id = d.approver_id),
         d.decision, d.signer_name, d.signed_at
    from decided d
  union all
  select w.step_order, w.step_role, w.manager_scope, w.approver_id is not null,
         (select ep.full_name from public.profiles ep
           where ep.id = case
                           when w.approver_id is not null then w.approver_id
                           when w.step_role = 'manager' and w.manager_scope = 'department'
                             then private.department_manager_for(v_emp)
                           when w.step_role = 'manager'
                             then (select pm.manager_id from public.profiles pm where pm.id = v_emp)
                         end),
         null::public.leave_status, null::text, null::timestamptz
    from waiting w
  order by 1, 8 nulls last, 2;
end; $$;

revoke all on function public.request_approval_progress(uuid) from public;
grant execute on function public.request_approval_progress(uuid) to authenticated;
