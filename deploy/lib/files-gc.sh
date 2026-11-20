#!/usr/bin/env bash
# Sales files clean-up (runs from liara/backup.sh, after the DB dump; best effort).
#   1. rows the database dropped as stale uploads (private.sales_files_gc) -> remove their bytes
#   2. tmp/ leftovers older than a day
#   3. orphan sweep: files older than a day whose id is not in private.sales_file_ids()
# The sweep is skipped when the id query fails or returns nothing: a wrong, empty or freshly
# restored database must never wipe the volume.
# Needs bj_compose_init done and POSTGRES_PASSWORD exported (backup.sh does both).
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PSQL=(psql -U supabase_admin -d postgres -qAt -v ON_ERROR_STOP=1)
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
log() { printf 'files-gc: %s\n' "$*" >&2; }

# 1. stale pending rows
removed=0
if keys="$(bj_compose_with_db_password db "${PSQL[@]}" -c \
  "select (j->>'company_id')||'/'||(j->>'rfp_id')||'/'||(j->>'id') from private.sales_files_gc() j")"; then
  keys="$(printf '%s\n' "$keys" | grep -E "^$UUID/$UUID/$UUID\$" || true)"
  if [ -n "$keys" ]; then
    printf '%s\n' "$keys" | bj_compose exec -T app sh -c \
      'cd "${FILES_DIR:-/data/files}" && while read -r k; do rm -f -- "$k"; done'
    removed="$(printf '%s\n' "$keys" | wc -l | tr -d ' ')"
  fi
else
  log "stale-row query failed; skipped"
fi
log "stale uploads removed: $removed"

# 2. tmp/
bj_compose exec -T app sh -c \
  'cd "${FILES_DIR:-/data/files}" 2>/dev/null && find tmp -type f -mmin +1440 -exec rm -f {} + 2>/dev/null; true' \
  || log "tmp clean-up failed"

# 3. orphan sweep
if ! ids="$(bj_compose_with_db_password db "${PSQL[@]}" -c "select id from private.sales_file_ids() id")"; then
  log "id query failed; orphan sweep skipped"
  exit 0
fi
ids="$(printf '%s\n' "$ids" | grep -E "^$UUID\$" || true)"
if [ -z "$ids" ]; then
  log "database returned no file ids; orphan sweep skipped"
  exit 0
fi
orphans="$(printf '%s\n' "$ids" | bj_compose exec -T app sh -c '
  cd "${FILES_DIR:-/data/files}" || exit 0
  list="$(mktemp)"; cat > "$list"
  n=0
  for f in $(find . -mindepth 3 -maxdepth 3 -type f -mmin +1440 -not -path "./tmp/*"); do
    id="${f##*/}"
    grep -qxF -- "$id" "$list" && continue
    rm -f -- "$f"; n=$((n + 1))
  done
  rm -f "$list"
  echo "$n"
')" || { log "orphan sweep failed"; exit 0; }
log "orphan files removed: ${orphans:-0}"
