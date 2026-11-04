-- FR-82 profile photos (spec docs/specs/2026-11-04-profile-photos-design.md).
--
-- One 256x256 JPEG per person, stored as a data URL (no Storage service on this stack, same as the
-- FR-52 signatures). The client crops and compresses; the CHECK caps the size so a 48-megapixel
-- original can never land here.
--
-- The table lives in schema private: PostgREST never exposes it. Every read and write goes through
-- the four public.app_* functions below.
--
-- Who writes: the person (unless HR locked the photo), the admin, or a `people` edit holder of the
-- same company on anyone but the admin. Who reads: any active person of the same company ("photo
-- goes with name": the org chart already lists every name company-wide).
--
-- No advisory locks and no writes to profiles / leave_requests, so no lock-order risk.

-- The cache key of /api/photo/<id>?v=<version>, served as immutable. It must never repeat, even
-- for a person who removes a photo and uploads another (remove deletes the row), or browsers keep
-- the old image: hence one sequence for everybody instead of a per-row counter.
create sequence private.profile_photo_version_seq as integer;

create table private.profile_photos (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  photo_data  text not null,
  locked      boolean not null default false,
  version     integer not null default nextval('private.profile_photo_version_seq'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  -- ≤ 80 000 base64 characters ≈ 60 KB decoded. JPEG starts with FF D8 FF → base64 "/9j/".
  constraint profile_photos_shape check (
    length(photo_data) between 1000 and 80000
    and mod(length(photo_data) - length('data:image/jpeg;base64,'), 4) = 0
    and photo_data ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$'),
  constraint profile_photos_version_positive check (version >= 1)
);

alter sequence private.profile_photo_version_seq owned by private.profile_photos.version;

comment on table private.profile_photos is
  'FR-82: one profile photo per person (256x256 JPEG data URL). Read and written only through public.app_*profile_photo* functions.';

revoke all on table private.profile_photos from public, anon, authenticated;
revoke all on sequence private.profile_photo_version_seq from public, anon, authenticated;

-- ── who may write ───────────────────────────────────────────────────────────
-- Self: allowed unless locked (checked by the callers, which know the row).
-- Others: the admin, or a `people` edit holder of the same company on a non-admin target.
create function private.photo_can_manage(p_caller uuid, p_target uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select p_caller is distinct from p_target
     and private.is_active(p_caller)
     and exists (select 1 from public.profiles t
                   join public.profiles c on c.id = p_caller and c.company_id = t.company_id
                  where t.id = p_target)
     and (private.is_admin(p_caller)
          or (private.has_perm(p_caller, 'people', 'edit')
              and not exists (select 1 from public.user_roles
                               where user_id = p_target and role = 'admin')));
$$;

revoke all on function private.photo_can_manage(uuid, uuid) from public, anon, authenticated;

-- ── reads ───────────────────────────────────────────────────────────────────
create function public.app_profile_photo(p_employee uuid)
    returns table (photo_data text, version integer, locked boolean)
    language sql stable security definer
    set search_path to ''
    as $$
  select p.photo_data, p.version, p.locked
    from private.profile_photos p
   where p.employee_id = p_employee
     and private.is_active(auth.uid())
     and p.company_id = private.caller_company();
$$;

-- Lists ask once for the ids on screen: who has a photo, and its cache key.
create function public.app_profile_photo_versions(p_ids uuid[])
    returns table (employee_id uuid, version integer, locked boolean)
    language sql stable security definer
    set search_path to ''
    as $$
  select p.employee_id, p.version, p.locked
    from unnest(coalesce(p_ids, '{}'::uuid[])) as v(eid)
    join private.profile_photos p on p.employee_id = v.eid
   where private.is_active(auth.uid())
     and p.company_id = private.caller_company()
   limit 2000;
$$;

-- ── writes ──────────────────────────────────────────────────────────────────
-- p_locked: honoured for a manager (admin / people edit); ignored for self, who keeps the
-- current value (false on a first upload).
create function public.app_set_profile_photo(p_employee uuid, p_data text, p_locked boolean default null)
    returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid      uuid := auth.uid();
  v_self     boolean := p_employee = auth.uid();
  v_company  uuid;
  v_before   private.profile_photos;
  v_locked   boolean;
  v_version  integer;
  v_constraint text;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = p_employee;
  if v_company is null then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not (v_self or private.photo_can_manage(v_uid, p_employee)) then
    raise exception 'not allowed to change this photo' using errcode = '42501';
  end if;

  select * into v_before from private.profile_photos where employee_id = p_employee for update;
  if v_self and coalesce(v_before.locked, false) then
    raise exception 'photo is locked by HR' using errcode = '42501';
  end if;

  v_locked := case when v_self then coalesce(v_before.locked, false)
                   else coalesce(p_locked, v_before.locked, false) end;

  begin
    insert into private.profile_photos as pp
           (employee_id, company_id, photo_data, locked, updated_at, updated_by)
    values (p_employee, v_company, p_data, v_locked, now(), v_uid)
    on conflict (employee_id) do update
       set photo_data = excluded.photo_data,
           locked     = excluded.locked,
           version    = excluded.version,
           updated_at = now(),
           updated_by = v_uid
    returning pp.version into v_version;
  exception
    -- Re-raised without DETAIL: the original would echo the whole 80 KB row.
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'photo data is invalid (%)', v_constraint using errcode = '22023';
    when not_null_violation then
      raise exception 'photo data is required' using errcode = '22023';
  end;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'photo.saved', 'profile_photos', p_employee,
          case when v_before.employee_id is null then null
               else jsonb_build_object('locked', v_before.locked, 'version', v_before.version) end,
          jsonb_build_object('locked', v_locked, 'version', v_version));
  return v_version;
end $$;

-- Lock or unlock without a new image (manager only).
create function public.app_set_profile_photo_lock(p_employee uuid, p_locked boolean)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
  v_before private.profile_photos;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_locked is null then
    raise exception 'lock value is required' using errcode = '22023';
  end if;
  if not private.photo_can_manage(v_uid, p_employee) then
    raise exception 'not allowed to change this photo' using errcode = '42501';
  end if;
  select * into v_before from private.profile_photos where employee_id = p_employee for update;
  if v_before.employee_id is null then
    raise exception 'no photo to lock' using errcode = 'P0002';
  end if;
  if v_before.locked = p_locked then
    return;
  end if;
  update private.profile_photos
     set locked = p_locked, version = nextval('private.profile_photo_version_seq'),
         updated_at = now(), updated_by = v_uid
   where employee_id = p_employee;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, case when p_locked then 'photo.locked' else 'photo.unlocked' end,
          'profile_photos', p_employee,
          jsonb_build_object('locked', v_before.locked),
          jsonb_build_object('locked', p_locked));
end $$;

create function public.app_remove_profile_photo(p_employee uuid)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid  uuid := auth.uid();
  v_self boolean := p_employee = auth.uid();
  v_before private.profile_photos;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (v_self or private.photo_can_manage(v_uid, p_employee)) then
    raise exception 'not allowed to change this photo' using errcode = '42501';
  end if;
  select * into v_before from private.profile_photos where employee_id = p_employee for update;
  if v_before.employee_id is null then
    return;
  end if;
  if v_self and v_before.locked then
    raise exception 'photo is locked by HR' using errcode = '42501';
  end if;
  delete from private.profile_photos where employee_id = p_employee;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'photo.deleted', 'profile_photos', p_employee,
          jsonb_build_object('locked', v_before.locked, 'version', v_before.version), null);
end $$;

revoke all on function public.app_profile_photo(uuid) from public, anon;
revoke all on function public.app_profile_photo_versions(uuid[]) from public, anon;
revoke all on function public.app_set_profile_photo(uuid, text, boolean) from public, anon;
revoke all on function public.app_set_profile_photo_lock(uuid, boolean) from public, anon;
revoke all on function public.app_remove_profile_photo(uuid) from public, anon;
grant execute on function public.app_profile_photo(uuid) to authenticated;
grant execute on function public.app_profile_photo_versions(uuid[]) to authenticated;
grant execute on function public.app_set_profile_photo(uuid, text, boolean) to authenticated;
grant execute on function public.app_set_profile_photo_lock(uuid, boolean) to authenticated;
grant execute on function public.app_remove_profile_photo(uuid) to authenticated;
