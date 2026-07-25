#!/bin/bash
# =============================================================================
# First-boot Postgres init (runs once, on an empty data volume). Mounted as
# /docker-entrypoint-initdb.d/zz-bj-init.sh so it runs AFTER the
# supabase/postgres image's own init scripts (which create the roles and
# schemas). We only align the service-role passwords with POSTGRES_PASSWORD
# and set the JWT GUCs PostgREST-adjacent tooling expects.
# =============================================================================
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-postgres}" <<SQL
alter role supabase_auth_admin with password '${POSTGRES_PASSWORD}';
alter role authenticator       with password '${POSTGRES_PASSWORD}';
alter database postgres set "app.settings.jwt_secret" to '${JWT_SECRET}';
alter database postgres set "app.settings.jwt_exp"    to '3600';
SQL
