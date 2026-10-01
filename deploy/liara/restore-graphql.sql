-- Supabase Postgres 15.8.1.085: the wrapper is an extension member created by
-- an initialization event trigger. pg_dump includes its ACL but not its DDL;
-- restoring the extension before that event trigger leaves the wrapper absent.
-- Restore the dump with ONLY that wrapper's ACL entry excluded, then run this
-- as supabase_admin. All application/Auth grants and policies remain in the dump.
create or replace function graphql_public.graphql(
  "operationName" text default null,
  query text default null,
  variables jsonb default null,
  extensions jsonb default null
) returns jsonb language sql as $function$
  select graphql.resolve(
    query := query,
    variables := coalesce(variables, '{}'),
    "operationName" := "operationName",
    extensions := extensions
  );
$function$;
alter function graphql_public.graphql(text, text, jsonb, jsonb) owner to supabase_admin;
grant execute on function graphql_public.graphql(text, text, jsonb, jsonb)
  to public, supabase_admin, postgres, anon, authenticated, service_role;
do $$
begin
  if not exists (
    select 1 from pg_depend
    where classid = 'pg_proc'::regclass
      and objid = 'graphql_public.graphql(text,text,jsonb,jsonb)'::regprocedure
      and refclassid = 'pg_extension'::regclass
      and refobjid = (select oid from pg_extension where extname = 'pg_graphql')
      and deptype = 'e'
  ) then
    alter extension pg_graphql add function graphql_public.graphql(text,text,jsonb,jsonb);
  end if;
end $$;
