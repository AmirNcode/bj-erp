#!/usr/bin/env bash
# deploy/lib/sync-view-as-hook.sql must make the PostgREST pre-request setting
# follow private.view_as_pre_request: set when the function exists, gone when
# it does not, idempotent, and scoped to one database. Needs the Docker daemon
# (a throwaway Postgres), not the local stack.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE="${BJ_TEST_PG_IMAGE:-postgres:15-alpine}"
NAME="bj-view-as-hook-test-$$"
SYNC="$ROOT/deploy/lib/sync-view-as-hook.sql"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker is required"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 2
docker exec "$NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1 || fail "postgres did not start"

psql_db() { local db="$1"; shift; docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"; }
run_sync() { psql_db postgres -q < "$SYNC" >/dev/null; }
# Value of the setting for authenticator in database $1 ('' when absent).
setting_in() {
  psql_db postgres -tA -c "select coalesce((
    select s.setconfig::text from pg_db_role_setting s
      join pg_roles r on r.oid = s.setrole
      join pg_database d on d.oid = s.setdatabase
     where r.rolname = 'authenticator' and d.datname = '$1'
       and s.setconfig::text like '%pgrst.db_pre_request%'), '')" | tr -d '[:space:]'
}
rows_in() {
  psql_db postgres -tA -c "select count(*) from pg_db_role_setting s
      join pg_database d on d.oid = s.setdatabase
     where d.datname = '$1' and s.setrole <> 0" | tr -d '[:space:]'
}
WANT='{pgrst.db_pre_request=private.view_as_pre_request}'

[ -f "$SYNC" ] || fail "$SYNC is missing"

psql_db postgres -q -c "create role authenticator nologin; create schema private;" >/dev/null
psql_db postgres -q -c "create database other" >/dev/null

run_sync
[ -z "$(setting_in postgres)" ] || fail "setting present although the function does not exist"
pass "no function: no setting"

psql_db postgres -q -c "create function private.view_as_pre_request() returns void language sql as 'select 1'" >/dev/null
run_sync
[ "$(setting_in postgres)" = "$WANT" ] || fail "expected $WANT, got '$(setting_in postgres)'"
pass "function exists: setting points at it"

[ -z "$(setting_in other)" ] || fail "setting leaked into another database"
pass "setting is per-database"

run_sync
[ "$(setting_in postgres)" = "$WANT" ] || fail "second run changed the setting"
[ "$(rows_in postgres)" = 1 ] || fail "expected exactly one setting row, got $(rows_in postgres)"
pass "second run: still one row, no error"

psql_db postgres -q -c "drop function private.view_as_pre_request()" >/dev/null
run_sync
[ -z "$(setting_in postgres)" ] || fail "setting survived the function being dropped"
run_sync
pass "function dropped: setting gone, rerun is harmless"
