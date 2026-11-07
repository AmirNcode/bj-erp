-- Keeps the PostgREST pre-request setting in step with the function it names
-- (FR-86, docs/specs/2026-11-07-view-as-design.md section 4). Role settings are
-- cluster-level and not in a database dump, so this is not a migration: the
-- deploy runs it after the last migration, and a restore runs it after
-- pg_restore. Idempotent. Run as supabase_admin against the app database.
do $$
begin
  if to_regproc('private.view_as_pre_request') is not null then
    execute format(
      'alter role authenticator in database %I set pgrst.db_pre_request = %L',
      current_database(), 'private.view_as_pre_request');
  else
    -- A setting that names a missing function fails every request for every user.
    execute format(
      'alter role authenticator in database %I reset pgrst.db_pre_request',
      current_database());
  end if;
end
$$;

notify pgrst, 'reload config';
