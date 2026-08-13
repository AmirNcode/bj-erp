#!/usr/bin/env bash
# Immutable migration ledger for existing and fresh self-hosted databases.
# Caller must provide pgexec(), which executes psql as supabase_admin against
# the postgres database with ON_ERROR_STOP enabled.

BJ_LEGACY_BASELINE_LAST="20260731120001_post_review_fixes.sql"

bj_migration_files() {
  find "$1" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort
}

bj_write_migration_manifest() {
  local directory="$1" output="$2" file base checksum temporary
  temporary="${output}.tmp.$$"
  : > "$temporary"
  while IFS= read -r file; do
    base=$(basename "$file")
    checksum=$(bj_hash_file "$file")
    printf '%s  %s\n' "$checksum" "$base" >> "$temporary"
  done <<EOF
$(bj_migration_files "$directory")
EOF
  mv -f "$temporary" "$output"
}

bj_init_migration_ledger() {
  pgexec >/dev/null <<'SQL'
create schema if not exists bj_deploy;
revoke all on schema bj_deploy from public, anon, authenticated;
create table if not exists bj_deploy.schema_migrations (
  filename text primary key,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now(),
  release_version text not null
);
revoke all on table bj_deploy.schema_migrations from public, anon, authenticated;
SQL
}

bj_ledger_count() {
  pgexec -tAc "select count(*) from bj_deploy.schema_migrations" | tr -d '[:space:]'
}

bj_schema_has_column() {
  local column="$1"
  pgexec -tAc "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='${column}')" \
    | tr -d '[:space:]'
}

bj_ledger_checksum() {
  local filename="$1"
  pgexec -tA -v filename="$filename" <<'SQL' | tr -d '[:space:]'
select checksum_sha256
  from bj_deploy.schema_migrations
 where filename = :'filename';
SQL
}

bj_record_migration() {
  local filename="$1" checksum="$2" release="$3"
  pgexec -v filename="$filename" -v checksum="$checksum" -v release="$release" >/dev/null <<'SQL'
insert into bj_deploy.schema_migrations(filename, checksum_sha256, release_version)
values (:'filename', :'checksum', :'release')
on conflict (filename) do nothing;
SQL
}

bj_apply_and_record_migration() {
  local file="$1" filename="$2" checksum="$3" release="$4" pipeline_status
  # Keep each migration and its ledger row in one PostgreSQL transaction. If
  # either the SQL file or the ledger insert fails, psql rolls both back and a
  # reconnect can safely resume at the same filename. psql runs inside the DB
  # container, so stream the host-side run-scoped file and ledger statement
  # together through stdin. Do not pass the ledger statement with -c: psql
  # does not interpolate :'variable' references in that command path.
  {
    cat "$file" &&
      printf '\n' &&
      cat <<'SQL'
insert into bj_deploy.schema_migrations(filename, checksum_sha256, release_version)
values (:'filename', :'checksum', :'release');
SQL
  } | pgexec --single-transaction \
    -v filename="$filename" -v checksum="$checksum" -v release="$release" \
    -f - >/dev/null
  pipeline_status=("${PIPESTATUS[@]}")
  [ "${pipeline_status[0]}" -eq 0 ] && [ "${pipeline_status[1]}" -eq 0 ]
}

bj_bootstrap_legacy_ledger() {
  local directory="$1" release="$2" table_exists sentinel file base checksum
  [ "$(bj_ledger_count)" = "0" ] || return 0

  table_exists=$(pgexec -tAc "select to_regclass('public.profiles') is not null" | tr -d '[:space:]')
  [ "$table_exists" = "t" ] || return 0

  # The first shipped client bundle contained exactly migrations 1..38. Its
  # final migration adds v_first_post to accrue_leave. Refuse to guess if that
  # sentinel is absent; a human must reconcile that older/partial database.
  sentinel=$(pgexec -tAc \
    "select coalesce(position('v_first_post' in pg_get_functiondef(to_regprocedure('public.accrue_leave(uuid,uuid)'))) > 0, false)" \
    2>/dev/null | tr -d '[:space:]')
  [ "$sentinel" = "t" ] \
    || { bj_fail "legacy database does not match the known 38-migration baseline; refusing to guess"; return 1; }

  bj_say "Bootstrapping the migration ledger for the verified legacy baseline"
  while IFS= read -r file; do
    base=$(basename "$file")
    if [ "$base" \< "$BJ_LEGACY_BASELINE_LAST" ] || [ "$base" = "$BJ_LEGACY_BASELINE_LAST" ]; then
      checksum=$(bj_hash_file "$file")
      bj_record_migration "$base" "$checksum" "legacy-baseline"
      printf '  recorded existing %s\n' "$base"
    fi
  done <<EOF
$(bj_migration_files "$directory")
EOF
}

bj_known_migration_is_fully_applied() {
  local filename="$1"
  case "$filename" in
    20260805171924_request_signatures.sql)
      pgexec -tA <<'SQL' | tr -d '[:space:]'
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='signature_data')
  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='signature_consent_at')
  and exists (select 1 from pg_constraint where conname='leave_requests_signature_shape' and conrelid='public.leave_requests'::regclass)
  and to_regprocedure('private.attach_request_signature(uuid,text,boolean)') is not null
  and to_regprocedure('public.submit_leave_request(uuid,date,date,public.day_part,text,boolean,text,uuid)') is not null
  and to_regprocedure('public.submit_hourly_leave_request(uuid,date,time,time,text,boolean,text,uuid)') is not null
  and to_regprocedure('public.submit_errand_request(date,time,time,text,text,boolean,text)') is not null
  and to_regprocedure('public.submit_leave_request(uuid,date,date,public.day_part,text,uuid)') is null
  and to_regprocedure('public.submit_hourly_leave_request(uuid,date,time,time,text,uuid)') is null
  and to_regprocedure('public.submit_errand_request(date,time,time,text,text)') is null
  and exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('private.attach_request_signature(uuid,text,boolean)')
       and not p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and position('signature authorization is required' in pg_get_functiondef(p.oid)) > 0
  )
  and (
    select count(*) from pg_proc p
     where p.oid = any(array[
       to_regprocedure('public.submit_leave_request(uuid,date,date,public.day_part,text,boolean,text,uuid)'),
       to_regprocedure('public.submit_hourly_leave_request(uuid,date,time,time,text,boolean,text,uuid)'),
       to_regprocedure('public.submit_errand_request(date,time,time,text,text,boolean,text)')
     ])
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and position('private.attach_request_signature' in pg_get_functiondef(p.oid)) > 0
  ) = 3;
SQL
      ;;
    20260805185628_approval_signatures_persian_only.sql)
      pgexec -tA <<'SQL' | tr -d '[:space:]'
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='approver_signature_data')
  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='approver_signature_consent_at')
  and exists (select 1 from pg_constraint where conname='leave_requests_approver_signature_shape' and conrelid='public.leave_requests'::regclass)
  and position(
    'cancelled' in pg_get_constraintdef((
      select oid from pg_constraint
       where conname='leave_requests_approver_signature_shape'
         and conrelid='public.leave_requests'::regclass
    ))
  ) > 0
  and exists (select 1 from pg_constraint where conname='profiles_calendar_pref_persian_only' and conrelid='public.profiles'::regclass)
  and to_regprocedure('public.approve_leave_request(uuid,text,boolean)') is not null
  and to_regprocedure('public.approve_leave_request(uuid)') is null
  and not exists (select 1 from public.profiles where calendar_pref <> 'jalali')
  and exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.approve_leave_request(uuid,text,boolean)')
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and position('signature authorization is required' in pg_get_functiondef(p.oid)) > 0
       and position('replacement_is_away' in pg_get_functiondef(p.oid)) > 0
       and position('approver_signature_data = p_signature_data' in pg_get_functiondef(p.oid)) > 0
  );
SQL
      ;;
    20260806014310_daily_work_errands_pto_overage.sql)
      pgexec -tA <<'SQL' | tr -d '[:space:]'
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name='unpaid_minutes')
  and exists (select 1 from pg_constraint where conname='leave_requests_unpaid_minutes_shape' and conrelid='public.leave_requests'::regclass)
  and exists (select 1 from pg_constraint where conname='leave_requests_kind_shape' and conrelid='public.leave_requests'::regclass)
  and to_regprocedure('public.compute_requested_minutes(uuid,date,date,public.day_part,public.leave_unit,time,time,public.request_kind)') is not null
  and to_regprocedure('private.submit_leave_impl(uuid,date,date,public.day_part,text,public.leave_unit,time,time,uuid,public.request_kind,text)') is not null
  and to_regprocedure('public.submit_daily_errand_request(date,date,text,text,boolean,text)') is not null
  and to_regprocedure('public.approve_leave_request(uuid,text,boolean)') is not null
  and to_regprocedure('public.cancel_leave_request(uuid)') is not null
  and exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.compute_requested_minutes(uuid,date,date,public.day_part,public.leave_unit,time,time,public.request_kind)')
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and position('p_kind = ''errand''' in pg_get_functiondef(p.oid)) > 0
       and position('(p_end - p_start) + 1' in pg_get_functiondef(p.oid)) > 0
  )
  and exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('private.submit_leave_impl(uuid,date,date,public.day_part,text,public.leave_unit,time,time,uuid,public.request_kind,text)')
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and position('unpaid_minutes' in pg_get_functiondef(p.oid)) > 0
  )
  and exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.submit_daily_errand_request(date,date,text,text,boolean,text)')
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and position('private.attach_request_signature' in pg_get_functiondef(p.oid)) > 0
  )
  and position('v_unpaid' in pg_get_functiondef(to_regprocedure('public.approve_leave_request(uuid,text,boolean)'))) > 0
  and position('unpaid_minutes' in pg_get_functiondef(to_regprocedure('public.cancel_leave_request(uuid)'))) > 0
  and (
    select count(*) from pg_proc p
     where p.oid = any(array[
       to_regprocedure('public.approve_leave_request(uuid,text,boolean)'),
       to_regprocedure('public.cancel_leave_request(uuid)')
     ])
       and p.prosecdef
       and p.proconfig @> array['search_path=""']::text[]
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
  ) = 2;
SQL
      ;;
    *) printf 'f\n' ;;
  esac
}

bj_adopt_known_installed_migrations() {
  local directory="$1" baseline_recorded file base checksum state
  baseline_recorded=$(bj_ledger_checksum "$BJ_LEGACY_BASELINE_LAST")
  [ -n "$baseline_recorded" ] || return 0

  for base in \
    20260805171924_request_signatures.sql \
    20260805185628_approval_signatures_persian_only.sql \
    20260806014310_daily_work_errands_pto_overage.sql
  do
    [ -z "$(bj_ledger_checksum "$base")" ] || continue
    file="$directory/$base"
    [ -f "$file" ] || continue
    state=$(bj_known_migration_is_fully_applied "$base")
    [ "$state" = t ] || continue
    checksum=$(bj_hash_file "$file")
    bj_record_migration "$base" "$checksum" "legacy-adopted"
    printf '  recorded fully installed %s\n' "$base"
  done
}

bj_apply_migrations() {
  local directory="$1" release="$2" file base checksum recorded
  [ -d "$directory" ] || { bj_fail "migration directory missing: $directory"; return 1; }
  bj_validate_version "$release" || return 1
  bj_init_migration_ledger
  bj_bootstrap_legacy_ledger "$directory" "$release"
  bj_adopt_known_installed_migrations "$directory"

  while IFS= read -r file; do
    base=$(basename "$file")
    case "$base" in *[!A-Za-z0-9._-]*) bj_fail "invalid migration filename: $base"; return 1 ;; esac
    checksum=$(bj_hash_file "$file")
    recorded=$(bj_ledger_checksum "$base")
    if [ -n "$recorded" ]; then
      [ "$recorded" = "$checksum" ] \
        || { bj_fail "migration history changed: $base (recorded $recorded, source $checksum)"; return 1; }
      printf '  skip %s (already applied)\n' "$base"
      continue
    fi

    printf '  apply %s\n' "$base"
    bj_apply_and_record_migration "$file" "$base" "$checksum" "$release" \
      || { bj_fail "migration failed: $base (not recorded)"; return 1; }
  done <<EOF
$(bj_migration_files "$directory")
EOF
}
