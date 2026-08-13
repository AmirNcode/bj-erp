#!/usr/bin/env bash
# =============================================================================
# deploy/update.sh — apply a shipped release to this server.
#
# Runs ON THE SERVER. Shipped and invoked automatically by deploy/bj-deploy
# from the developer's machine; you normally never run it by hand.
#
#   sudo ./update.sh <version>
#
# DATABASE SAFETY — the guarantees this script is built around:
#   * The only Docker commands used against the stack are `docker load` and
#     `docker compose up -d app` (recreates ONE container). The db container is
#     never stopped; `docker compose down`, `down -v` and `volume rm` appear
#     nowhere.
#   * A backup is taken FIRST and proven restorable (`pg_restore -l`) before
#     anything changes. An empty or invalid dump aborts the deploy.
#   * Migration and seed paths are explicit per run, rather than relying on the
#     database container's bind mounts. This avoids stale single-file mounts and
#     prevents another staged release from changing a running job's SQL inputs.
#   * Row counts of every data table are recorded before and after. If any
#     count decreased, the deploy fails loudly with the restore command.
#   * Only the APP_VERSION line of .env is ever rewritten — secrets are never
#     regenerated (that would log every user out) and the admin is never reset.
#
# Migrations are FORWARD-ONLY: an image rollback does not undo them. The
# pre-deploy dump is the only true rollback for schema changes.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=lib/common.sh
. ./lib/common.sh
# shellcheck source=lib/migrations.sh
. ./lib/migrations.sh
# shellcheck source=lib/health.sh
. ./lib/health.sh
bj_compose_init "$PWD" "${BJ_DEPLOY_TARGET:-client}"

VERSION="${1:?usage: sudo ./update.sh <version>}"
IMAGE_TGZ="bj-erp-app-${VERSION}.tar.gz"
MIGRATIONS_DIR="${BJ_MIGRATIONS_DIR:-$PWD/migrations}"
SEED_FILE="${BJ_SEED_FILE:-$PWD/sql/seed.sql}"
# Absolute: the path recorded in $BJ_RUN_DIR/backup.path is consumed by the
# controller's rsync on the Mac, which would otherwise resolve a relative path
# against the SSH user's home instead of this installer directory.
BACKUP_DIR="$PWD/backups"
LOG_FILE=./update.log
HEALTH_RETRIES=45          # x2s = 90s. A new image's first boot runs the
                           # placeholder find+sed pass over /app (~30s+).
KEEP_IMAGES=3
KEEP_BACKUPS=14
MIN_FREE_GB=5
DATA_TABLES="profiles user_roles leave_requests leave_ledger holidays departments leave_types companies"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2
         echo "$(date -u +%FT%TZ) FAILED ${VERSION}: $*" >> "$LOG_FILE" 2>/dev/null || true
         exit 1; }

# ── 0. only one update at a time ─────────────────────────────────────────────
exec 9>/tmp/bj-erp-update.lock
flock -n 9 || fail "another update is already running on this server"

# ── 1. preflight — fail before touching anything ─────────────────────────────
[ "$(id -u)" -eq 0 ] || fail "run with sudo (needs the root-owned .env and docker)"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
  || fail "invalid version '${VERSION}' — letters, digits, dot, dash, underscore only"
[ -f .env ]         || fail ".env not found — run this from the installer directory"
[ -f "$IMAGE_TGZ" ] || fail "${IMAGE_TGZ} not found — did bj-deploy finish staging?"
[ -d "$MIGRATIONS_DIR" ] || fail "migration directory not found: $MIGRATIONS_DIR"
[ -f "$SEED_FILE" ]      || fail "seed file not found: $SEED_FILE"

avail_kb=$(df -Pk . | awk 'NR == 2 { print $4 }')
case "$avail_kb" in ''|*[!0-9]*) fail "could not read available server disk space" ;; esac
required_kb=$((MIN_FREE_GB * 1024 * 1024))
if [ "$avail_kb" -lt "$required_kb" ]; then
  avail_gib=$(awk -v kib="$avail_kb" 'BEGIN { printf "%.1f", kib / 1048576 }')
  fail "only ${avail_gib} GiB free — need ${MIN_FREE_GB} GiB. Remove old images/backups first."
fi

set -a; . ./.env; set +a
PREVIOUS_VERSION="${APP_VERSION:-latest}"
bj_validate_version "$PREVIOUS_VERSION" \
  || fail "existing APP_VERSION is invalid: ${PREVIOUS_VERSION}"

# .env files written before the HTTPS port became configurable have no
# APP_ORIGIN. Fall back to the 443 form so the health check below still targets
# a real listener instead of failing and triggering a bogus rollback.
APP_ORIGIN="${APP_ORIGIN:-https://${APP_HOST}}"

bj_compose exec -T db pg_isready -U supabase_admin -h localhost -d postgres >/dev/null 2>&1 \
  || fail "the database container is not running/healthy — fix that before deploying"

say "Updating ${PREVIOUS_VERSION} -> ${VERSION}"

# psql inside the db container as the image's superuser. The image requires
# password auth even over the local socket.
pgexec() {
  bj_compose_with_db_password db \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

# Row counts for every table holding real data; compared before vs after.
snapshot() {
  local t n
  for t in $DATA_TABLES; do
    n=$(bj_compose_with_db_password db \
          psql -tAc "select count(*) from public.${t}" -U supabase_admin -d postgres 2>/dev/null \
        | tr -d '[:space:]')
    echo "${t}:${n:-ERR}"
  done
}

# ── 2. verified backup ───────────────────────────────────────────────────────
say "Backing up the database…"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$BACKUP_DIR" 2>/dev/null || true

BACKUP_FILE="${BACKUP_DIR}/pre-${VERSION}-$(date +%F-%H%M%S).dump"
bj_compose_with_db_password db \
  pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP_FILE" || fail "pg_dump failed"
[ -s "$BACKUP_FILE" ] || fail "the backup is empty — refusing to deploy"
bj_compose exec -T db pg_restore -l < "$BACKUP_FILE" >/dev/null 2>&1 \
  || fail "the backup is not a valid archive — refusing to deploy"

# The dump holds every employee record and password hash — keep it private,
# but readable by the SSH user so bj-deploy can copy it off the server.
chmod 600 "$BACKUP_FILE"
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$BACKUP_FILE" 2>/dev/null || true
if [ -n "${BJ_RUN_DIR:-}" ] && [ -d "$BJ_RUN_DIR" ]; then
  printf '%s\n' "$BACKUP_FILE" > "$BJ_RUN_DIR/backup.path"
  bj_hash_file "$BACKUP_FILE" > "$BJ_RUN_DIR/backup.sha256"
  chmod 600 "$BJ_RUN_DIR/backup.path" "$BJ_RUN_DIR/backup.sha256"
  [ -n "${SUDO_USER:-}" ] \
    && chown "$SUDO_USER" "$BJ_RUN_DIR/backup.path" "$BJ_RUN_DIR/backup.sha256" 2>/dev/null \
    || true
fi
say "Backup OK: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 3. row counts BEFORE ─────────────────────────────────────────────────────
say "Recording row counts…"
ROWS_BEFORE=$(mktemp); snapshot > "$ROWS_BEFORE"
grep -q ':ERR$' "$ROWS_BEFORE" && fail "could not read row counts — is the database healthy?"
sed 's/^/  /' "$ROWS_BEFORE"

# ── 4. load the new image ────────────────────────────────────────────────────
say "Loading the app image…"
gunzip -c "$IMAGE_TGZ" | docker load || fail "docker load failed"
arch=$(docker image inspect "bj-erp-app:${VERSION}" --format '{{.Architecture}}' 2>/dev/null || echo missing)
[ "$arch" = "amd64" ] \
  || fail "image bj-erp-app:${VERSION} is '${arch}' — this server needs amd64. Nothing was changed."

# ── 5. migrations — pending immutable files, atomically ledgered ─────────────
say "Applying pending migrations…"
bj_apply_migrations "$MIGRATIONS_DIR" "$VERSION" \
  || fail "migration failed — the app was NOT restarted and is still on ${PREVIOUS_VERSION}. Restore: ${BACKUP_FILE}"
pgexec < "$SEED_FILE" >/dev/null \
  || fail "seed.sql failed — the app was NOT restarted. Restore: ${BACKUP_FILE}"

# ── 6. cutover — recreates ONLY the app container ────────────────────────────
say "Switching the app container to ${VERSION}…"
bj_set_app_version .env "$VERSION" \
  || fail "could not select app image version ${VERSION}"
bj_compose up -d --no-deps --force-recreate app || fail "compose up failed"

# ── 7. health check ──────────────────────────────────────────────────────────
say "Health-checking the database, app endpoint, and Auth service…"
if ! bj_wait_for_stack "$HEALTH_RETRIES" || ! bj_verify_running_architecture amd64; then
  warn "UNHEALTHY — rolling back to ${PREVIOUS_VERSION}"
  if ! bj_set_app_version .env "$PREVIOUS_VERSION"; then
    # Persisting the rollback tag failed, but do not let the still-exported new
    # value make this immediate recovery recreate the unhealthy image again.
    APP_VERSION="$PREVIOUS_VERSION"
    export APP_VERSION
    warn "could not persist APP_VERSION=${PREVIOUS_VERSION} in .env; rollback is temporary"
  fi
  bj_compose up -d --no-deps --force-recreate app || true
  echo "$(date -u +%FT%TZ) ROLLBACK ${VERSION} -> ${PREVIOUS_VERSION} backup=${BACKUP_FILE}" >> "$LOG_FILE"
  cat <<WARNEOF

!! The IMAGE was rolled back. Any migrations applied above are NOT undone.
!! If the previous version cannot run against the new schema, restore the dump:
!!   cd $(pwd)
!!   sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml \\
!!        exec -T db pg_restore -U supabase_admin -d postgres \\
!!        --clean --if-exists < ${BACKUP_FILE}
WARNEOF
  fail "deploy failed; rolled back to ${PREVIOUS_VERSION}"
fi

# ── 8. prove no data was lost ────────────────────────────────────────────────
say "Verifying data integrity…"
ROWS_AFTER=$(mktemp); snapshot > "$ROWS_AFTER"
LOST=0
while IFS=: read -r t before; do
  after=$(grep "^${t}:" "$ROWS_AFTER" | cut -d: -f2)
  if [ "${after:-ERR}" = "ERR" ]; then
    warn "  !! ${t}: unreadable after the deploy"; LOST=1
  elif [ "$after" -lt "$before" ]; then
    warn "  !! ${t}: ${before} -> ${after}   ROWS LOST"; LOST=1
  else
    echo "  ok ${t}: ${before} -> ${after}"
  fi
done < "$ROWS_BEFORE"
rm -f "$ROWS_BEFORE" "$ROWS_AFTER"

if [ "$LOST" != 0 ]; then
  cat <<LOSTEOF

!! DATA LOSS DETECTED. The app is running ${VERSION} but rows are missing.
!! Restore immediately:
!!   cd $(pwd)
!!   sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml \\
!!        exec -T db pg_restore -U supabase_admin -d postgres \\
!!        --clean --if-exists < ${BACKUP_FILE}
LOSTEOF
  fail "row counts decreased — restore ${BACKUP_FILE}"
fi

# ── 9. tidy up: shipped archive, old images, old backups ─────────────────────
rm -f "$IMAGE_TGZ"

docker images 'bj-erp-app' --format '{{.Tag}}\t{{.CreatedAt}}' \
  | grep -v '^<none>' | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | cut -f1 \
  | while read -r old; do
      [ "$old" = "$VERSION" ] && continue
      [ "$old" = "latest" ]   && continue
      docker rmi "bj-erp-app:${old}" >/dev/null 2>&1 && echo "  removed image bj-erp-app:${old}" || true
    done

ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --

echo "$(date -u +%FT%TZ) OK ${VERSION} backup=${BACKUP_FILE}" >> "$LOG_FILE"

cat <<DONEEOF

=============================================================
 Deployed ${VERSION}
   App:      ${APP_ORIGIN}
   Backup:   ${BACKUP_FILE}
   Data:     verified — no table lost rows
   Rollback: sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/' .env && \\
             sudo docker compose -f docker-compose.yml \\
               -f docker-compose.client-amd64.yml up -d app
=============================================================
DONEEOF
