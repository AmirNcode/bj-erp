#!/usr/bin/env bash
# Daily full logical database backup. Copy off-server separately; never publish as a CI artifact.
set -euo pipefail
umask 077
cd /opt/bj-erp
. ./lib/common.sh
bj_compose_init "$PWD" liara
set -a; . ./.env; set +a
install -d -m 700 /var/backups/bj-erp
BACKUP="/var/backups/bj-erp/daily-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$BACKUP.partial"' EXIT
bj_compose_with_db_password db pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP.partial"
[ -s "$BACKUP.partial" ]
bj_compose exec -T db pg_restore -l < "$BACKUP.partial" >/dev/null
mv "$BACKUP.partial" "$BACKUP"
sha256sum "$BACKUP" > "$BACKUP.sha256"
# FR-77: record the dump for the admin panel's System tab. Best effort: a database that
# predates private.record_backup must never fail the backup itself.
bj_compose_with_db_password db psql -U supabase_admin -d postgres -qAt -c \
  "select private.record_backup('$(basename "$BACKUP")', $(stat -c %s "$BACKUP"), '$(cut -d' ' -f1 "$BACKUP.sha256")')" \
  >/dev/null 2>&1 || true
find /var/backups/bj-erp -maxdepth 1 -type f -name 'daily-*.dump*' -mtime +14 -delete
printf '%s\n' "$BACKUP"
