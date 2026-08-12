#!/usr/bin/env bash
# Reconnect-safe server-side controller for BJ ERP deployments.
#
# Public commands:
#   ./remote-job.sh init RUN_ID ACTION
#   sudo ./remote-job.sh start RUN_ID update VERSION
#   sudo ./remote-job.sh start RUN_ID backup VERSION
#   sudo ./remote-job.sh authorize-backup RUN_ID SHA256
#   sudo ./remote-job.sh start-reset RUN_ID reset-db|factory-reset VERSION
#   ./remote-job.sh status RUN_ID
#   ./remote-job.sh logs RUN_ID [LINE_COUNT]
#
# `start`/`start-reset` detach the worker. Closing SSH does not kill it.
set -euo pipefail
REMOTE_JOB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$REMOTE_JOB_DIR"

# shellcheck source=lib/common.sh
. ./lib/common.sh
# shellcheck source=lib/migrations.sh
. ./lib/migrations.sh
# shellcheck source=lib/health.sh
. ./lib/health.sh

readonly STATE_ROOT="${BJ_STATE_ROOT:-$PWD/.bj-deploy}"
readonly RUNS_ROOT="$STATE_ROOT/runs"
readonly SELF="$PWD/remote-job.sh"

usage() {
  sed -n '2,13p' "$SELF" >&2
  exit 2
}

require_root() {
  [ "$(id -u)" -eq 0 ] || { bj_fail "this command must run through sudo"; exit 1; }
}

run_dir() {
  bj_validate_run_id "$1" >/dev/null || exit 2
  printf '%s/%s\n' "$RUNS_ROOT" "$1"
}

write_status() {
  local directory="$1" value="$2"
  printf '%s\n' "$value" | bj_atomic_write "$directory/status"
  chmod 644 "$directory/status"
}

read_status() {
  local directory="$1"
  [ -f "$directory/status" ] && sed -n '1p' "$directory/status" || printf 'UNKNOWN\n'
}

ensure_run_dir() {
  local directory="$1"
  mkdir -p "$directory"
  chmod 700 "$directory"
}

compose_setup() {
  bj_compose_init "$PWD" client
  [ -f .env ] && { set -a; . ./.env; set +a; }
}

pgexec() {
  bj_compose_with_db_password db \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

snapshot_rows() {
  local output="$1" table count
  : > "$output"
  for table in profiles user_roles leave_requests leave_ledger holidays departments leave_types companies; do
    count=$(pgexec -tAc "select count(*) from public.${table}" 2>/dev/null | tr -d '[:space:]' || true)
    printf '%s:%s\n' "$table" "${count:-ERR}" >> "$output"
  done
}

perform_backup() {
  local directory="$1" run_id="$2" backup checksum owner
  compose_setup
  owner="${BJ_REMOTE_OWNER:-${SUDO_USER:-behsazan}}"
  mkdir -p backups
  chown "$owner" backups 2>/dev/null || true
  chmod 700 backups

  if [ -z "$(bj_compose ps -q db 2>/dev/null || true)" ]; then
    : > "$directory/backup.path"
    : > "$directory/backup.sha256"
    write_status "$directory" NO_DATABASE
    printf 'No running database exists; there is nothing to back up.\n'
    return 0
  fi
  bj_compose exec -T db pg_isready -U supabase_admin -h localhost -d postgres >/dev/null \
    || { bj_fail "database is not ready"; return 1; }

  backup="$PWD/backups/pre-reset-${run_id}.dump"
  bj_say "Creating database backup"
  bj_compose_with_db_password db \
    pg_dump -U supabase_admin -d postgres -Fc > "$backup"
  [ -s "$backup" ] || { bj_fail "database backup is empty"; return 1; }
  bj_compose exec -T db pg_restore -l < "$backup" >/dev/null
  checksum=$(bj_hash_file "$backup")
  printf '%s\n' "$backup" > "$directory/backup.path"
  printf '%s\n' "$checksum" > "$directory/backup.sha256"
  snapshot_rows "$directory/rows-before.txt"
  chmod 600 "$backup" "$directory/backup.path" "$directory/backup.sha256" "$directory/rows-before.txt"
  chown "$owner" "$backup" "$directory/backup.path" "$directory/backup.sha256" "$directory/rows-before.txt" 2>/dev/null || true
  write_status "$directory" BACKUP_READY
  printf 'Backup ready: %s\nSHA-256: %s\n' "$backup" "$checksum"
}

validate_volume() {
  local volume="$1" project
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    return 1
  fi
  project=$(docker volume inspect "$volume" --format '{{ index .Labels "com.docker.compose.project" }}')
  [ "$project" = "$BJ_PROJECT_NAME" ] \
    || { bj_fail "volume $volume is labeled for project '$project', not '$BJ_PROJECT_NAME'"; return 2; }
}

remove_project_volume_if_present() {
  local volume="$1"
  if validate_volume "$volume"; then
    docker volume rm "$volume"
  else
    case "$?" in
      1) printf 'Volume %s does not exist; nothing to remove.\n' "$volume" ;;
      *) return 1 ;;
    esac
  fi
}

verify_run_migration_source() {
  local directory="$1" expected current
  expected="$directory/source-migrations.sha256"
  current="$directory/current-migrations.sha256"
  [ -d "$directory/migrations" ] \
    || { bj_fail "run-scoped migration directory is missing"; return 1; }
  [ -f "$expected" ] \
    || { bj_fail "run migration manifest is missing"; return 1; }
  bj_write_migration_manifest "$directory/migrations" "$current"
  if ! cmp -s "$expected" "$current"; then
    rm -f "$current"
    bj_fail "run-scoped migrations do not match the reviewed source manifest"
    return 1
  fi
  rm -f "$current"
}

record_installed_state() {
  local directory="$1" owner
  owner="${BJ_REMOTE_OWNER:-${SUDO_USER:-behsazan}}"
  mkdir -p "$STATE_ROOT"
  if [ -f "$directory/manifest.env" ]; then
    cp "$directory/manifest.env" "$STATE_ROOT/installed-manifest.env"
    chmod 600 "$STATE_ROOT/installed-manifest.env"
    chown "$owner" "$STATE_ROOT/installed-manifest.env" 2>/dev/null || true
  fi
  [ -f "$directory/source-migrations.sha256" ] \
    || { bj_fail "cannot record installed state without a run migration manifest"; return 1; }
  cp "$directory/source-migrations.sha256" "$STATE_ROOT/installed-migrations.sha256"
  chmod 600 "$STATE_ROOT/installed-migrations.sha256"
  chown "$owner" "$STATE_ROOT/installed-migrations.sha256" 2>/dev/null || true
}

perform_reset() {
  local directory="$1" action="$2" version="$3" host port password_file
  [ -f "$directory/reset.env" ] || { bj_fail "reset configuration is missing"; return 1; }
  # reset.env contains only public host/port values and was generated locally.
  # shellcheck disable=SC1090
  . "$directory/reset.env"
  host="$APP_HOST"
  port="$APP_PORT"
  password_file="$directory/admin-password"
  [ -s "$password_file" ] || { bj_fail "protected admin password input is missing"; return 1; }
  verify_run_migration_source "$directory" || return 1

  if [ -f .env ]; then
    compose_setup
    bj_say "Stopping only the $BJ_PROJECT_NAME Compose project"
    bj_compose down --remove-orphans
  else
    # A genuinely new server has no Compose configuration to interpolate and
    # no project containers to stop. Volume deletion is still exact/labeled.
    bj_compose_init "$PWD" client
    bj_say "No previous .env/stack configuration found; preparing a first install"
  fi
  remove_project_volume_if_present "${BJ_PROJECT_NAME}_db-data"
  if [ "$action" = factory-reset ]; then
    remove_project_volume_if_present "${BJ_PROJECT_NAME}_caddy-data"
    remove_project_volume_if_present "${BJ_PROJECT_NAME}_caddy-config"
  fi

  # A reset intentionally invalidates every old token. Generate a completely
  # new .env while preserving the public route selected above.
  if [ -f .env ]; then
    chmod 600 .env
    mv .env "$directory/pre-reset.env"
    chmod 600 "$directory/pre-reset.env"
  fi
  BJ_DEPLOY_TARGET=client BJ_FORCE_NEW_CONFIG=1 \
    BJ_APP_HOST="$host" BJ_APP_PORT="$port" \
    BJ_MIGRATIONS_DIR="$directory/migrations" BJ_SEED_FILE="$directory/seed.sql" \
    BJ_ADMIN_PASSWORD_FILE="$password_file" ./install.sh
  rm -f "$password_file"
  record_installed_state "$directory"
  printf 'Reset completed; application route is https://%s:%s\n' "$host" "$port"
}

perform_update() {
  local directory="$1" version="$2"
  verify_run_migration_source "$directory" || return 1
  BJ_DEPLOY_TARGET=client BJ_RUN_DIR="$directory" \
    BJ_MIGRATIONS_DIR="$directory/migrations" BJ_SEED_FILE="$directory/seed.sql" \
    ./update.sh "$version"
  record_installed_state "$directory"
}

perform_app() {
  local directory="$1" version="$2" archive previous arch
  verify_run_migration_source "$directory" || return 1
  compose_setup
  archive="bj-erp-app-${version}.tar.gz"
  [ -f "$archive" ] || { bj_fail "app archive is missing: $archive"; return 1; }
  previous="${APP_VERSION:-latest}"
  gunzip -c "$archive" | docker load
  arch=$(docker image inspect "bj-erp-app:${version}" --format '{{.Architecture}}')
  bj_require_arch "$arch" amd64 "new app image" || return 1
  bj_env_set .env APP_VERSION "$version"
  set -a; . ./.env; set +a
  if ! bj_compose up -d --no-deps --force-recreate app \
     || ! bj_wait_for_stack 45 \
     || ! bj_verify_running_architecture amd64; then
    bj_warn "New app is unhealthy; restoring image version $previous"
    bj_env_set .env APP_VERSION "$previous"
    set -a; . ./.env; set +a
    bj_compose up -d --no-deps --force-recreate app || true
    return 1
  fi
  rm -f "$archive"
  record_installed_state "$directory"
}

perform_restart() {
  compose_setup
  bj_compose restart
  bj_wait_for_stack 60
  bj_verify_running_architecture amd64
}

run_worker() {
  local run_id="$1" action="$2" version="$3" directory rc=0 terminal=SUCCEEDED had_errexit=0
  directory=$(run_dir "$run_id")
  ensure_run_dir "$directory"
  exec 9>"$STATE_ROOT/mutation.lock"
  if ! flock -n 9; then
    write_status "$directory" FAILED:75
    bj_fail "another mutating deployment job is running"
    return 75
  fi
  write_status "$directory" RUNNING
  printf 'RUN_ID=%s\nACTION=%s\nVERSION=%s\nSTARTED_AT=%s\n' \
    "$run_id" "$action" "$version" "$(date -u +%FT%TZ)"

  # A function invoked on the left side of `||` inherits Bash's ignored
  # errexit context. The former `perform_update ... || rc=$?` therefore let a
  # failed update.sh continue into record_installed_state and return success.
  # Run the action in an isolated shell where `set -e` is genuinely active,
  # while keeping this controller alive long enough to persist FAILED:<code>.
  case $- in *e*) had_errexit=1 ;; esac
  set +e
  (
    set -e
    case "$action" in
      backup) perform_backup "$directory" "$run_id" ;;
      update) perform_update "$directory" "$version" ;;
      app) perform_app "$directory" "$version" ;;
      restart) perform_restart ;;
      reset-db|factory-reset) perform_reset "$directory" "$action" "$version" ;;
      *) bj_fail "unsupported worker action: $action" || true; exit 2 ;;
    esac
  )
  rc=$?
  [ "$had_errexit" -eq 0 ] || set -e
  if [ "$rc" -eq 0 ] && [ "$action" = backup ]; then
    terminal=$(read_status "$directory")
  fi

  rm -f "$directory/admin-password"
  if [ "$rc" -eq 0 ]; then
    if [ "$action" = backup ]; then
      write_status "$directory" "$terminal"
    else
      write_status "$directory" SUCCEEDED
    fi
    printf 'FINISHED_AT=%s\nRESULT=%s\n' "$(date -u +%FT%TZ)" "$(read_status "$directory")"
  else
    write_status "$directory" "FAILED:${rc}"
    printf 'FINISHED_AT=%s\nRESULT=FAILED:%s\n' "$(date -u +%FT%TZ)" "$rc"
  fi
  return "$rc"
}

start_worker() {
  local run_id="$1" action="$2" version="$3" directory current
  require_root
  bj_validate_version "$version" || exit 2
  directory=$(run_dir "$run_id")
  ensure_run_dir "$directory"
  current=$(read_status "$directory")
  case "$current" in
    RUNNING|SUCCEEDED|BACKUP_READY|NO_DATABASE|FAILED:*)
      bj_fail "run $run_id is already $current; it will not be started twice"; exit 1 ;;
  esac
  write_status "$directory" RUNNING
  nohup "$SELF" __run "$run_id" "$action" "$version" \
    > "$directory/job.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$directory/pid"
  chmod 644 "$directory/job.log" "$directory/pid" 2>/dev/null || true
  printf 'Started %s as run %s (PID %s).\n' "$action" "$run_id" "$!"
}

start_reset() {
  local run_id="$1" action="$2" version="$3" directory current host port password confirm
  require_root
  case "$action" in reset-db|factory-reset) ;; *) usage ;; esac
  directory=$(run_dir "$run_id")
  current=$(read_status "$directory")
  case "$current" in BACKUP_VERIFIED|NO_DATABASE) ;; *) bj_fail "backup is not verified (status: $current)"; exit 1 ;; esac
  if [ -f .env ]; then
    host=$(bj_env_value APP_HOST .env)
    port=$(bj_env_value APP_PORT .env); port=${port:-443}
  else
    host="${BJ_CLIENT_APP_HOST:-10.10.10.50}"
    port="${BJ_CLIENT_APP_PORT:-3500}"
  fi
  bj_validate_host "$host" || exit 1
  bj_validate_port "$port" || exit 1

  while :; do
    read -r -s -p "New password for the first admin (8-72 characters): " password; echo
    if printf '%s' "$password" | LC_ALL=C grep -Eq '^[ -~]{8,72}$'; then break; fi
    printf 'Password must be 8-72 printable Latin characters.\n' >&2
  done
  read -r -p "Re-enter the new admin password: " -s confirm; echo
  [ "$password" = "$confirm" ] || { bj_fail "passwords do not match"; exit 1; }
  umask 077
  printf '%s\n' "$password" > "$directory/admin-password"
  printf 'APP_HOST=%s\nAPP_PORT=%s\n' "$host" "$port" > "$directory/reset.env"
  unset password confirm
  chmod 600 "$directory/admin-password" "$directory/reset.env"
  # If SSH drops in the tiny gap before start_worker, resume can launch this
  # already-prepared reset without asking for or transmitting the password again.
  write_status "$directory" RESET_READY
  start_worker "$run_id" "$action" "$version"
}

if [ "${BJ_REMOTE_JOB_LIBRARY_ONLY:-0}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi

command_name="${1:-}"
case "$command_name" in
  init)
    run_id="${2:-}"; action="${3:-}"; directory=$(run_dir "$run_id")
    if [ -f "$directory/status" ]; then
      current=$(read_status "$directory")
      [ "$current" = PREPARED ] && { printf '%s\n' "$run_id"; exit 0; }
      bj_fail "run $run_id already exists with status $current"; exit 1
    fi
    ensure_run_dir "$directory"
    printf 'ACTION=%s\nCREATED_AT=%s\n' "$action" "$(date -u +%FT%TZ)" > "$directory/request.env"
    chmod 600 "$directory/request.env"
    write_status "$directory" PREPARED
    printf '%s\n' "$run_id"
    ;;
  start)
    start_worker "${2:-}" "${3:-}" "${4:-}"
    ;;
  start-reset)
    start_reset "${2:-}" "${3:-}" "${4:-}"
    ;;
  authorize-backup)
    require_root
    run_id="${2:-}"; supplied="${3:-}"; directory=$(run_dir "$run_id")
    [ "$(read_status "$directory")" = BACKUP_READY ] || { bj_fail "backup is not ready"; exit 1; }
    expected=$(sed -n '1p' "$directory/backup.sha256")
    [ -n "$expected" ] && [ "$supplied" = "$expected" ] \
      || { bj_fail "downloaded backup checksum does not match server backup"; exit 1; }
    write_status "$directory" BACKUP_VERIFIED
    ;;
  status)
    directory=$(run_dir "${2:-}"); read_status "$directory"
    ;;
  logs)
    directory=$(run_dir "${2:-}"); lines="${3:-120}"
    case "$lines" in ''|*[!0-9]*) usage ;; esac
    [ -f "$directory/job.log" ] && tail -n "$lines" "$directory/job.log" || true
    ;;
  stack-status)
    require_root
    compose_setup
    bj_compose ps
    ;;
  stack-logs)
    require_root
    lines="${2:-120}"
    case "$lines" in ''|*[!0-9]*) usage ;; esac
    compose_setup
    bj_compose logs --tail "$lines" app auth rest gateway db
    ;;
  __run)
    require_root
    run_worker "${2:-}" "${3:-}" "${4:-}"
    ;;
  *) usage ;;
esac
