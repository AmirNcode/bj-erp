#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/bj-deploy-tests.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$*"; }
assert_eq() { [ "$1" = "$2" ] || fail "expected '$2', got '$1'"; }

# shellcheck source=../../deploy/lib/common.sh
. "$ROOT/deploy/lib/common.sh"
# shellcheck source=../../deploy/lib/migrations.sh
. "$ROOT/deploy/lib/migrations.sh"

assert_eq "$(bj_arch_name aarch64)" arm64
assert_eq "$(bj_arch_name x86_64)" amd64
bj_require_arch aarch64 arm64 test >/dev/null
if bj_require_arch amd64 arm64 test >/dev/null 2>&1; then fail "architecture mismatch was accepted"; fi
pass "architecture normalization and rejection"

if bj_validate_version '../bad' >/dev/null 2>&1; then fail "unsafe version was accepted"; fi
if bj_validate_run_id 'bad/id' >/dev/null 2>&1; then fail "unsafe run id was accepted"; fi
bj_validate_version '20260806-abc_1' >/dev/null
bj_validate_run_id '20260806T100000Z-a1b2c3' >/dev/null
pass "version and run-id validation"

ENV_FILE="$TMP/test.env"
printf 'KEEP=original\nCHANGE=old\n' > "$ENV_FILE"
bj_env_set "$ENV_FILE" CHANGE new
bj_env_set "$ENV_FILE" ADDED value
assert_eq "$(bj_env_value KEEP "$ENV_FILE")" original
assert_eq "$(bj_env_value CHANGE "$ENV_FILE")" new
assert_eq "$(bj_env_value ADDED "$ENV_FILE")" value
assert_eq "$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")" 600
pass "atomic environment updates preserve unrelated values and permissions"

# Compose prioritizes an exported shell variable over the .env file. The
# server update process sources .env before cutover, so changing only the file
# would silently recreate the old image tag.
APP_VERSION_FILE="$TMP/app-version.env"
printf 'KEEP=original\nAPP_VERSION=latest\n' > "$APP_VERSION_FILE"
export APP_VERSION=latest
bj_set_app_version "$APP_VERSION_FILE" release-20260813
assert_eq "$(bj_env_value KEEP "$APP_VERSION_FILE")" original
assert_eq "$(bj_env_value APP_VERSION "$APP_VERSION_FILE")" release-20260813
assert_eq "$APP_VERSION" release-20260813
assert_eq "$(sh -c 'printf %s "$APP_VERSION"')" release-20260813
unset APP_VERSION
grep -q 'bj_set_app_version .env "$VERSION"' "$ROOT/deploy/update.sh" \
  || fail "update cutover does not refresh exported APP_VERSION"
grep -q 'bj_set_app_version .env "$PREVIOUS_VERSION"' "$ROOT/deploy/update.sh" \
  || fail "update rollback does not refresh exported APP_VERSION"
pass "app cutover and rollback synchronize file and exported image version"

mkdir -p "$TMP/migrations"
printf 'select 2;\n' > "$TMP/migrations/20260202_second.sql"
printf 'select 1;\n' > "$TMP/migrations/20260101_first.sql"
bj_write_migration_manifest "$TMP/migrations" "$TMP/manifest"
first=$(sed -n '1s/.*  //p' "$TMP/manifest")
second=$(sed -n '2s/.*  //p' "$TMP/manifest")
assert_eq "$first" 20260101_first.sql
assert_eq "$second" 20260202_second.sql
if grep -Ev '^[0-9a-f]{64}  [A-Za-z0-9._-]+$' "$TMP/manifest" | grep -q .; then
  fail "migration manifest format is invalid"
fi
pass "migration manifest is sorted and checksummed"

# Exercise the ledger algorithm without Docker/Postgres. The fake pgexec keeps
# the same filename/checksum state that the private bj_deploy table would keep,
# and accepts migration SQL only through container-visible standard input.
FAKE_LEDGER="$TMP/fake-ledger"
FAKE_APPLIED="$TMP/fake-applied"
: > "$FAKE_LEDGER"; : > "$FAKE_APPLIED"
pgexec() {
  local args="$*" input='' filename='' checksum='' migration_file='' assignment
  case "$args" in
    *"select count(*) from bj_deploy.schema_migrations"*) wc -l < "$FAKE_LEDGER"; return ;;
    *"to_regclass('public.profiles')"*) printf 'f\n'; return ;;
  esac
  if printf '%s\n' "$args" | grep -q -- '--single-transaction'; then
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -v)
          assignment="${2:-}"
          case "$assignment" in
            filename=*) filename=${assignment#filename=} ;;
            checksum=*) checksum=${assignment#checksum=} ;;
          esac
          shift 2
          ;;
        -f) migration_file="${2:-}"; shift 2 ;;
        -c) return 1 ;;
        *) shift ;;
      esac
    done
    [ "$migration_file" = - ] || return 1
    input=$(cat)
    case "$input" in
      *"insert into bj_deploy.schema_migrations"*) ;;
      *) return 1 ;;
    esac
    case "$input" in
      *"select "*) ;;
      *) return 1 ;;
    esac
    [ "${FAKE_ATOMIC_FAIL:-0}" = 0 ] || return 1
    printf '%s\n' "$input" >> "$FAKE_APPLIED"
    printf '%s|%s\n' "$filename" "$checksum" >> "$FAKE_LEDGER"
    return
  fi
  input=$(cat)
  case "$input" in
    *"create schema if not exists bj_deploy"*) return ;;
    *"select checksum_sha256"*)
      filename=$(printf '%s\n' "$args" | sed -n 's/.*-v filename=\([^ ]*\).*/\1/p')
      awk -F'|' -v filename="$filename" '$1 == filename { print $2 }' "$FAKE_LEDGER"
      ;;
    *"insert into bj_deploy.schema_migrations"*)
      filename=$(printf '%s\n' "$args" | sed -n 's/.*-v filename=\([^ ]*\).*/\1/p')
      checksum=$(printf '%s\n' "$args" | sed -n 's/.*-v checksum=\([^ ]*\).*/\1/p')
      printf '%s|%s\n' "$filename" "$checksum" >> "$FAKE_LEDGER"
      ;;
    *) printf '%s\n---\n' "$input" >> "$FAKE_APPLIED" ;;
  esac
}
bj_apply_migrations "$TMP/migrations" test-release >/dev/null
assert_eq "$(wc -l < "$FAKE_LEDGER" | tr -d ' ')" 2
applied_size=$(wc -c < "$FAKE_APPLIED" | tr -d ' ')
bj_apply_migrations "$TMP/migrations" test-release >/dev/null
assert_eq "$(wc -c < "$FAKE_APPLIED" | tr -d ' ')" "$applied_size"
printf 'select 99;\n' > "$TMP/migrations/20260101_first.sql"
if bj_apply_migrations "$TMP/migrations" test-release >/dev/null 2>&1; then
  fail "edited migration history was accepted"
fi
printf 'select 1;\n' > "$TMP/migrations/20260101_first.sql"
printf 'select 3;\n' > "$TMP/migrations/20260303_third.sql"
before_ledger=$(wc -l < "$FAKE_LEDGER" | tr -d ' ')
before_applied=$(wc -c < "$FAKE_APPLIED" | tr -d ' ')
FAKE_ATOMIC_FAIL=1
if bj_apply_migrations "$TMP/migrations" test-release >/dev/null 2>&1; then
  fail "simulated transaction failure was accepted"
fi
unset FAKE_ATOMIC_FAIL
assert_eq "$(wc -l < "$FAKE_LEDGER" | tr -d ' ')" "$before_ledger"
assert_eq "$(wc -c < "$FAKE_APPLIED" | tr -d ' ')" "$before_applied"
bj_apply_migrations "$TMP/migrations" test-release >/dev/null
assert_eq "$(wc -l < "$FAKE_LEDGER" | tr -d ' ')" 3
pass "single-stdin migration SQL and ledger row are atomic, resumable, and checksum protected"

(
  mkdir -p "$TMP/known-installed"
  for known in \
    20260805171924_request_signatures.sql \
    20260805185628_approval_signatures_persian_only.sql \
    20260806014310_daily_work_errands_pto_overage.sql
  do
    printf 'select 1;\n' > "$TMP/known-installed/$known"
  done
  FAKE_LEDGER="$TMP/interrupted-ledger"
  printf '%s|%064d\n' "$BJ_LEGACY_BASELINE_LAST" 0 > "$FAKE_LEDGER"
  bj_known_migration_is_fully_applied() { printf 't\n'; }
  bj_adopt_known_installed_migrations "$TMP/known-installed" >/dev/null
  assert_eq "$(wc -l < "$FAKE_LEDGER" | tr -d ' ')" 4
  bj_adopt_known_installed_migrations "$TMP/known-installed" >/dev/null
  assert_eq "$(wc -l < "$FAKE_LEDGER" | tr -d ' ')" 4
)
pass "interrupted legacy adoption resumes and records complete known migrations once"

if grep -nE "pgexec[[:space:]]+-[^[:space:]]*c[[:space:]]*<<" "$ROOT/deploy/lib/migrations.sh"; then
  fail "psql -c cannot be combined with a heredoc migration query"
fi
pass "catalog fingerprint queries use stdin without psql -c"

mkdir -p "$TMP/remote/lib"
cp "$ROOT/deploy/remote-job.sh" "$TMP/remote/"
cp "$ROOT/deploy/lib/"*.sh "$TMP/remote/lib/"
chmod +x "$TMP/remote/remote-job.sh"
(
  cd "$TMP/remote"
  BJ_STATE_ROOT="$TMP/state" ./remote-job.sh init run-1 update >/dev/null
  assert_eq "$(BJ_STATE_ROOT="$TMP/state" ./remote-job.sh status run-1)" PREPARED
  BJ_STATE_ROOT="$TMP/state" ./remote-job.sh init run-1 update >/dev/null
  printf 'SUCCEEDED\n' > "$TMP/state/runs/run-1/status"
  if BJ_STATE_ROOT="$TMP/state" ./remote-job.sh init run-1 update >/dev/null 2>&1; then
    fail "completed run ID was allowed to initialize again"
  fi
  if BJ_STATE_ROOT="$TMP/state" ./remote-job.sh init '../escape' update >/dev/null 2>&1; then
    fail "unsafe remote run ID was accepted"
  fi
)
pass "remote run initialization is idempotent only while prepared"

(
  cd "$TMP/remote"
  mkdir -p "$TMP/state/runs/run-verify/migrations"
  printf 'select 1;\n' > "$TMP/state/runs/run-verify/migrations/20260101_first.sql"
  bj_write_migration_manifest \
    "$TMP/state/runs/run-verify/migrations" \
    "$TMP/state/runs/run-verify/source-migrations.sha256"
  printf 'RUN_ID=run-verify\n' > "$TMP/state/runs/run-verify/manifest.env"
  BJ_REMOTE_JOB_LIBRARY_ONLY=1 BJ_STATE_ROOT="$TMP/state" BJ_REMOTE_OWNER="$(id -un)" \
    . ./remote-job.sh
  verify_run_migration_source "$TMP/state/runs/run-verify"
  printf 'select 2;\n' > "$TMP/state/runs/run-verify/migrations/20260101_first.sql"
  if verify_run_migration_source "$TMP/state/runs/run-verify" >/dev/null 2>&1; then
    fail "a run-scoped migration changed after manifest creation"
  fi
  printf 'select 1;\n' > "$TMP/state/runs/run-verify/migrations/20260101_first.sql"
  record_installed_state "$TMP/state/runs/run-verify"
  cmp -s "$TMP/state/runs/run-verify/source-migrations.sha256" \
    "$TMP/state/installed-migrations.sha256" \
    || fail "installed migration state was recomputed from mutable shared files"
  assert_eq "$(stat -f '%Lp' "$TMP/state/installed-migrations.sha256" 2>/dev/null || stat -c '%a' "$TMP/state/installed-migrations.sha256")" 600
)
pass "run-scoped migrations are verified and installed manifests remain owner-readable"

# A terminal failed update may reuse its already-uploaded, checksum-verified
# app archive, but only as a brand-new run and only while migration + seed
# inputs still match the original artifact. Exercise the local dry-run path in
# an isolated fake repository so no SSH, Docker, or production state is used.
RETRY_REPO="$TMP/retry-repo"
mkdir -p \
  "$RETRY_REPO/deploy/lib" \
  "$RETRY_REPO/supabase/migrations" \
  "$RETRY_REPO/dist" \
  "$RETRY_REPO/.bj-deploy/runs/run-failed" \
  "$TMP/fake-bin"
cp "$ROOT/deploy/bj-deploy" "$RETRY_REPO/deploy/"
cp "$ROOT/deploy/lib/"*.sh "$RETRY_REPO/deploy/lib/"
chmod +x "$RETRY_REPO/deploy/bj-deploy"
printf 'select 1;\n' > "$RETRY_REPO/supabase/migrations/20260101_first.sql"
printf 'select 1;\n' > "$RETRY_REPO/supabase/seed.sql"
cp "$RETRY_REPO/supabase/seed.sql" "$TMP/original-seed.sql"
bj_write_migration_manifest \
  "$RETRY_REPO/supabase/migrations" \
  "$RETRY_REPO/.bj-deploy/runs/run-failed/source-migrations.sha256"
cat > "$RETRY_REPO/.bj-deploy/runs/run-failed/manifest.env" <<'EOF'
RUN_ID=run-failed
ACTION=update
VERSION=release-existing
TARGET=client
GIT_SHA=source-commit
GIT_BRANCH=main
EOF
printf 'verified existing archive\n' > "$RETRY_REPO/dist/bj-erp-app-release-existing.tar.gz"
bj_hash_file "$RETRY_REPO/dist/bj-erp-app-release-existing.tar.gz" \
  > "$RETRY_REPO/dist/bj-erp-app-release-existing.tar.gz.sha256"
cat > "$TMP/fake-bin/git" <<'EOF'
#!/bin/sh
case "$1:$2" in
  branch:--show-current) printf 'main\n' ;;
  status:--porcelain) ;;
  cat-file:-e) ;;
  show:*) cat "$FAKE_SOURCE_SEED" ;;
  rev-parse:HEAD) printf 'controller-commit\n' ;;
  *) printf 'unexpected fake git call: %s\n' "$*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TMP/fake-bin/git"
retry_output=$(
  cd "$RETRY_REPO"
  PATH="$TMP/fake-bin:$PATH" FAKE_SOURCE_SEED="$RETRY_REPO/supabase/seed.sql" \
    ./deploy/bj-deploy --dry-run retry-uploaded run-failed
)
printf '%s\n' "$retry_output" | grep -q 'no build or app upload' \
  || fail "retry-uploaded dry run did not preserve the existing artifact"
printf 'select 2;\n' > "$RETRY_REPO/supabase/seed.sql"
if (
  cd "$RETRY_REPO"
  PATH="$TMP/fake-bin:$PATH" FAKE_SOURCE_SEED="$TMP/original-seed.sql" \
    ./deploy/bj-deploy --dry-run retry-uploaded run-failed >/dev/null 2>&1
); then
  fail "retry-uploaded accepted changed seed input"
fi
pass "failed update retry reuses only an unchanged verified uploaded artifact in a new run"

# Reproduce the production incident where update.sh failed its disk preflight,
# but Bash suppressed errexit because perform_update was called before `||`.
# A failed child must become FAILED:<code> and must not record installed state.
(
  cd "$TMP/remote"
  failure_state="$TMP/failure-state"
  run="$failure_state/runs/run-update-failure"
  mkdir -p "$run/migrations"
  printf 'select 1;\n' > "$run/migrations/20260101_first.sql"
  bj_write_migration_manifest "$run/migrations" "$run/source-migrations.sha256"
  printf 'RUN_ID=run-update-failure\n' > "$run/manifest.env"
  printf '#!/usr/bin/env bash\nexit 23\n' > ./update.sh
  chmod +x ./update.sh
  BJ_REMOTE_JOB_LIBRARY_ONLY=1 BJ_STATE_ROOT="$failure_state" BJ_REMOTE_OWNER="$(id -un)" \
    . ./remote-job.sh
  # macOS has no native flock; lock behavior is independently required by the
  # client doctor, while this fixture exercises post-lock worker status logic.
  flock() { return 0; }
  set +e
  run_worker run-update-failure update test-release > "$TMP/update-failure.log" 2>&1
  rc=$?
  set -e
  assert_eq "$rc" 23
  assert_eq "$(read_status "$run")" FAILED:23
  [ ! -e "$failure_state/installed-manifest.env" ] \
    || fail "failed update recorded an installed manifest"
  [ ! -e "$failure_state/installed-migrations.sha256" ] \
    || fail "failed update recorded installed migrations"
  grep -q 'RESULT=FAILED:23' "$TMP/update-failure.log" \
    || fail "failed update log omitted its terminal failure"
)
pass "remote update failures cannot become SUCCEEDED or record installed state"

preflight_line=$(grep -n '^[[:space:]]*client_release_preflight$' "$ROOT/deploy/bj-deploy" | head -1 | cut -d: -f1)
source_gates_line=$(grep -n '^[[:space:]]*run_source_gates$' "$ROOT/deploy/bj-deploy" | head -1 | cut -d: -f1)
[ -n "$preflight_line" ] && [ -n "$source_gates_line" ] && [ "$preflight_line" -lt "$source_gates_line" ] \
  || fail "client disk preflight does not run before local source gates/build"
grep -q 'remote update has no verified backup metadata' "$ROOT/deploy/bj-deploy" \
  || fail "an update can still treat missing backup metadata as no database"
pass "client disk and backup gates fail before expensive or misleading success paths"

grep -q 'BJ_MIGRATIONS_DIR="$directory/migrations"' "$ROOT/deploy/remote-job.sh" \
  || fail "remote workers do not use run-scoped migrations"
grep -q 'chown "$owner" backups' "$ROOT/deploy/remote-job.sh" \
  || fail "reset backup directory is not readable by the transfer owner"
pass "remote workers isolate SQL inputs and preserve backup transfer access"

# A successful client update recorded its backup with an installer-relative
# path, which the controller refused after the deploy had already succeeded.
# The path is normalized onto the configured remote backup directory, and the
# file name is still reduced to one safe component before it reaches rsync and
# the remote shell.
REMOTE_DIR=/opt/fake-installer
RECORDED_RELATIVE='./backups/pre-20260813-004921-11373fe-2026-08-13-053754.dump'
assert_eq \
  "$(bj_resolve_remote_backup_path "$REMOTE_DIR" "$RECORDED_RELATIVE")" \
  "$REMOTE_DIR/backups/pre-20260813-004921-11373fe-2026-08-13-053754.dump"
assert_eq \
  "$(bj_resolve_remote_backup_path "$REMOTE_DIR" "backups/pre-release.dump")" \
  "$REMOTE_DIR/backups/pre-release.dump"
assert_eq \
  "$(bj_resolve_remote_backup_path "$REMOTE_DIR" "$REMOTE_DIR/backups/pre-reset-run-1.dump")" \
  "$REMOTE_DIR/backups/pre-reset-run-1.dump"
assert_eq \
  "$(bj_resolve_remote_backup_path "$REMOTE_DIR/" "$REMOTE_DIR/backups/pre-release.dump")" \
  "$REMOTE_DIR/backups/pre-release.dump"
for unsafe in \
  '' \
  '.' \
  './backups' \
  './backups/' \
  './backups/.' \
  './backups/..' \
  './backups/../../etc/passwd' \
  './backups/../secrets.dump' \
  './backups/nested/pre-release.dump' \
  './backups/pre release.dump' \
  './backups/pre;rm -rf ~.dump' \
  './backups/$(id).dump' \
  './backups/`id`.dump' \
  './backups/-e.dump' \
  '/etc/passwd' \
  '/opt/other/backups/pre-release.dump' \
  '../backups/pre-release.dump' \
  'backups' \
  'pre-release.dump'
do
  if bj_resolve_remote_backup_path "$REMOTE_DIR" "$unsafe" >/dev/null 2>&1; then
    fail "unsafe backup path was accepted: '$unsafe'"
  fi
done
if bj_resolve_remote_backup_path 'relative/installer' './backups/pre-release.dump' >/dev/null 2>&1; then
  fail "a relative remote directory was accepted as a backup root"
fi
grep -q 'BACKUP_DIR="$PWD/backups"' "$ROOT/deploy/update.sh" \
  || fail "update.sh no longer records a canonical absolute backup path"
grep -q 'bj_resolve_remote_backup_path "$BJ_REMOTE_DIR"' "$ROOT/deploy/bj-deploy" \
  || fail "the controller no longer resolves the recorded backup path"
pass "recorded backup paths normalize onto the remote backup directory and reject everything else"

# Resuming an already SUCCEEDED update must only collect the missing evidence:
# it may read status/logs and download the verified backup, and must not start
# a worker, rerun migrations, or touch containers. Exercised against fake ssh
# and rsync so no client server is contacted.
RESUME_REPO="$TMP/resume-repo"
RESUME_RUN=20260813T020320Z-901150
RESUME_DUMP=pre-20260813-004921-11373fe-2026-08-13-053754.dump
SERVER_ROOT="$TMP/fake-server"
mkdir -p \
  "$RESUME_REPO/deploy/lib" \
  "$RESUME_REPO/.bj-deploy/runs/$RESUME_RUN" \
  "$SERVER_ROOT$REMOTE_DIR/backups" \
  "$TMP/resume-bin"
cp "$ROOT/deploy/bj-deploy" "$RESUME_REPO/deploy/"
cp "$ROOT/deploy/lib/"*.sh "$RESUME_REPO/deploy/lib/"
chmod +x "$RESUME_REPO/deploy/bj-deploy"
cat > "$RESUME_REPO/.bj-deploy/runs/$RESUME_RUN/manifest.env" <<EOF
RUN_ID=$RESUME_RUN
ACTION=update
VERSION=release-existing
TARGET=client
EOF
printf 'verified server dump\n' > "$SERVER_ROOT$REMOTE_DIR/backups/$RESUME_DUMP"
printf '%s\n' "$RECORDED_RELATIVE" > "$TMP/fake-backup-path"
bj_hash_file "$SERVER_ROOT$REMOTE_DIR/backups/$RESUME_DUMP" > "$TMP/fake-backup-sha"
cat > "$TMP/resume-bin/ssh" <<'EOF'
#!/bin/sh
cmd=''
while [ "$#" -gt 0 ]; do cmd="$1"; shift; done
printf '%s\n' "$cmd" >> "$FAKE_SSH_LOG"
case "$cmd" in
  *"remote-job.sh status"*) printf 'SUCCEEDED\n' ;;
  *"remote-job.sh logs"*)   printf 'RESULT=SUCCEEDED\n' ;;
  *"test -s '.bj-deploy/runs/"*) exit 0 ;;
  *"cat '.bj-deploy/runs/"*"/backup.path'")   cat "$FAKE_BACKUP_PATH" ;;
  *"cat '.bj-deploy/runs/"*"/backup.sha256'") cat "$FAKE_BACKUP_SHA" ;;
  *) printf 'unexpected fake ssh command: %s\n' "$cmd" >&2; exit 1 ;;
esac
EOF
cat > "$TMP/resume-bin/rsync" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_RSYNC_LOG"
source='' destination=''
while [ "$#" -gt 0 ]; do source="$destination"; destination="$1"; shift; done
case "$source" in
  bj:/*) ;;
  *) printf 'unexpected fake rsync source: %s\n' "$source" >&2; exit 1 ;;
esac
cp "$FAKE_SERVER_ROOT${source#bj:}" "$destination"
EOF
chmod +x "$TMP/resume-bin/ssh" "$TMP/resume-bin/rsync"
: > "$TMP/resume-ssh.log"; : > "$TMP/resume-rsync.log"
(
  cd "$RESUME_REPO"
  PATH="$TMP/resume-bin:$PATH" BJ_REMOTE_DIR="$REMOTE_DIR" \
    FAKE_SSH_LOG="$TMP/resume-ssh.log" FAKE_RSYNC_LOG="$TMP/resume-rsync.log" \
    FAKE_BACKUP_PATH="$TMP/fake-backup-path" FAKE_BACKUP_SHA="$TMP/fake-backup-sha" \
    FAKE_SERVER_ROOT="$SERVER_ROOT" \
    ./deploy/bj-deploy resume "$RESUME_RUN" > "$TMP/resume.log" 2>&1
) || fail "resuming a succeeded update could not collect its backup: $(cat "$TMP/resume.log")"
FETCHED="$RESUME_REPO/backups/deploy-assistant/client/$RESUME_RUN/$RESUME_DUMP"
cmp -s "$FETCHED" "$SERVER_ROOT$REMOTE_DIR/backups/$RESUME_DUMP" \
  || fail "the resumed run did not download the verified server backup"
assert_eq "$(cat "$RESUME_REPO/backups/deploy-assistant/client/$RESUME_RUN/backup.sha256")" \
  "$(cat "$TMP/fake-backup-sha")"
assert_eq "$(stat -f '%Lp' "$FETCHED" 2>/dev/null || stat -c '%a' "$FETCHED")" 600
assert_eq "$(wc -l < "$TMP/resume-rsync.log" | tr -d ' ')" 1
grep -q "bj:$REMOTE_DIR/backups/$RESUME_DUMP" "$TMP/resume-rsync.log" \
  || fail "the backup was not fetched from the absolute remote backup directory"
if grep -Eq 'remote-job\.sh (start|start-reset|__run)|update\.sh|docker|pg_restore' "$TMP/resume-ssh.log"; then
  fail "resuming a succeeded run performed a deployment or database operation"
fi
pass "a succeeded update resumes into backup evidence only, from a relative recorded path"

grep -q "status: 'ok'" "$ROOT/app/api/health/route.ts" \
  || fail "health route does not expose the expected contract"
grep -q "Cache-Control.*no-store" "$ROOT/app/api/health/route.ts" \
  || fail "health route is cacheable"
pass "health route has stable status and no-store contract"

printf '\nAll deployment assistant tests passed.\n'
