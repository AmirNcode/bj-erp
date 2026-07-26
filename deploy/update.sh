#!/usr/bin/env bash
# =============================================================================
# deploy/update.sh — apply a shipped release to this server.
#
# Runs ON THE SERVER. Shipped and invoked automatically by deploy/release.sh
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
#   * All SQL is fed to psql over STDIN, never via the container's bind mounts:
#     ./sql/seed.sql is a single-FILE mount, and replacing that file gives it a
#     new inode while the mount keeps serving the OLD content.
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

VERSION="${1:?usage: sudo ./update.sh <version>}"
IMAGE_TGZ="bj-erp-app-${VERSION}.tar.gz"
BACKUP_DIR=./backups
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
[ -f "$IMAGE_TGZ" ] || fail "${IMAGE_TGZ} not found — did release.sh finish shipping?"
[ -d migrations ]   || fail "migrations/ not found"
[ -f sql/seed.sql ] || fail "sql/seed.sql not found"

avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
[ "${avail_gb:-0}" -ge "$MIN_FREE_GB" ] \
  || fail "only ${avail_gb}GB free — need ${MIN_FREE_GB}GB. Remove old images/backups first."

set -a; . ./.env; set +a
PREVIOUS_VERSION="${APP_VERSION:-latest}"

docker compose exec -T db pg_isready -U supabase_admin -h localhost >/dev/null 2>&1 \
  || fail "the database container is not running/healthy — fix that before deploying"

say "Updating ${PREVIOUS_VERSION} -> ${VERSION}"

# psql inside the db container as the image's superuser. The image requires
# password auth even over the local socket.
pgexec() {
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

# Row counts for every table holding real data; compared before vs after.
snapshot() {
  local t n
  for t in $DATA_TABLES; do
    n=$(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
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
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP_FILE" || fail "pg_dump failed"
[ -s "$BACKUP_FILE" ] || fail "the backup is empty — refusing to deploy"
docker compose exec -T db pg_restore -l < "$BACKUP_FILE" >/dev/null 2>&1 \
  || fail "the backup is not a valid archive — refusing to deploy"

# The dump holds every employee record and password hash — keep it private,
# but readable by the SSH user so release.sh can copy it off the server.
chmod 600 "$BACKUP_FILE"
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$BACKUP_FILE" 2>/dev/null || true
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

# ── 5. migrations — idempotent replay, fed over STDIN ────────────────────────
say "Applying migrations…"
for f in migrations/*.sql; do
  base=$(basename "$f")
  pgexec < "$f" >/dev/null \
    || fail "migration ${base} failed — the app was NOT restarted and is still on ${PREVIOUS_VERSION}. Restore: ${BACKUP_FILE}"
done
pgexec < sql/seed.sql >/dev/null \
  || fail "seed.sql failed — the app was NOT restarted. Restore: ${BACKUP_FILE}"

# ── 6. cutover — recreates ONLY the app container ────────────────────────────
say "Switching the app container to ${VERSION}…"
sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" .env
docker compose up -d app || fail "compose up failed"

# ── 7. health check ──────────────────────────────────────────────────────────
say "Health-checking https://${APP_HOST}/ (up to $((HEALTH_RETRIES * 2))s)…"
HEALTHY=0
for _ in $(seq 1 "$HEALTH_RETRIES"); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://${APP_HOST}/" || true)
  auth=$(curl -sk --max-time 5 "https://${APP_HOST}/auth/v1/health" || true)
  if [ "$code" = "200" ] && printf '%s' "$auth" | grep -q GoTrue; then HEALTHY=1; break; fi
  sleep 2
done

if [ "$HEALTHY" != 1 ]; then
  warn "UNHEALTHY — rolling back to ${PREVIOUS_VERSION}"
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/" .env
  docker compose up -d app || true
  echo "$(date -u +%FT%TZ) ROLLBACK ${VERSION} -> ${PREVIOUS_VERSION} backup=${BACKUP_FILE}" >> "$LOG_FILE"
  cat <<WARNEOF

!! The IMAGE was rolled back. Any migrations applied above are NOT undone.
!! If the previous version cannot run against the new schema, restore the dump:
!!   cd $(pwd)
!!   sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres \\
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
!!   sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres \\
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
   App:      https://${APP_HOST}
   Backup:   ${BACKUP_FILE}
   Data:     verified — no table lost rows
   Rollback: sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/' .env && \\
             sudo docker compose up -d app
=============================================================
DONEEOF
