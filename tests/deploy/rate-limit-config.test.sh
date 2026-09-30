#!/usr/bin/env bash
# Real Compose interpolation checks; requires Docker Compose CLI, no daemon.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CASE_DIR=$(mktemp -d)
trap 'rm -rf "$CASE_DIR"' EXIT

check_rate() {
  local expected="$1" settings="$2" actual
  cat > "$CASE_DIR/test.env" <<'EOF'
APP_HOST=example.invalid
APP_ORIGIN=https://example.invalid
POSTGRES_PASSWORD=test-only
JWT_SECRET=test-only
ANON_KEY=test-only
SERVICE_ROLE_KEY=test-only
EOF
  printf '%s\n' "$settings" >> "$CASE_DIR/test.env"
  actual=$(
    unset RATE_LIMIT_TOKEN_PER_IP_5_MINUTES RATE_LIMIT_TOKEN_PER_IP_HOUR
    docker compose --env-file "$CASE_DIR/test.env" \
      -f "$ROOT/deploy/docker-compose.yml" config --format json |
      node -e 'let s=""; process.stdin.on("data", d => s+=d); process.stdin.on("end", () => console.log(JSON.parse(s).services.auth.environment.GOTRUE_RATE_LIMIT_TOKEN_REFRESH));'
  )
  [ "$actual" = "$expected" ] || {
    printf 'FAIL: expected rate %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  }
}

check_rate 300 ''
check_rate 75 'RATE_LIMIT_TOKEN_PER_IP_HOUR=75'
check_rate 120 'RATE_LIMIT_TOKEN_PER_IP_5_MINUTES=120'
check_rate 120 $'RATE_LIMIT_TOKEN_PER_IP_HOUR=75\nRATE_LIMIT_TOKEN_PER_IP_5_MINUTES=120'
check_rate 75 $'RATE_LIMIT_TOKEN_PER_IP_HOUR=75\nRATE_LIMIT_TOKEN_PER_IP_5_MINUTES='
printf 'ok - default, legacy preservation, new setting, precedence, and empty fallback\n'
