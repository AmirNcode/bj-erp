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
# the same filename/checksum state that the private bj_deploy table would keep.
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
        *) shift ;;
      esac
    done
    [ -f "$migration_file" ] || return 1
    [ "${FAKE_ATOMIC_FAIL:-0}" = 0 ] || return 1
    cat "$migration_file" >> "$FAKE_APPLIED"
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
pass "migration SQL and ledger row are atomic, resumable, and checksum protected"

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

grep -q 'BJ_MIGRATIONS_DIR="$directory/migrations"' "$ROOT/deploy/remote-job.sh" \
  || fail "remote workers do not use run-scoped migrations"
grep -q 'chown "$owner" backups' "$ROOT/deploy/remote-job.sh" \
  || fail "reset backup directory is not readable by the transfer owner"
pass "remote workers isolate SQL inputs and preserve backup transfer access"

grep -q "status: 'ok'" "$ROOT/app/api/health/route.ts" \
  || fail "health route does not expose the expected contract"
grep -q "Cache-Control.*no-store" "$ROOT/app/api/health/route.ts" \
  || fail "health route is cacheable"
pass "health route has stable status and no-store contract"

printf '\nAll deployment assistant tests passed.\n'
