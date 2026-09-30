#!/usr/bin/env bash
# Real Compose merge: preserve private services, replace only public ingress.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CASE_DIR=$(mktemp -d)
trap 'rm -rf "$CASE_DIR"' EXIT
cat > "$CASE_DIR/test.env" <<'ENV'
APP_HOST=example.invalid
APP_ORIGIN=https://example.invalid
APP_PORT=3500
POSTGRES_PASSWORD=test-only
JWT_SECRET=test-only
ANON_KEY=test-only
SERVICE_ROLE_KEY=test-only
APP_VERSION=test
ENV
docker compose --env-file "$CASE_DIR/test.env" -f "$ROOT/deploy/docker-compose.yml" \
  -f "$ROOT/deploy/docker-compose.liara.yml" config --format json > "$CASE_DIR/compose.json"
node - "$CASE_DIR/compose.json" <<'JS'
const assert = require('node:assert/strict');
const c = require(process.argv[2]);
for (const service of ['db','auth','rest','app']) {
  assert.equal((c.services[service].ports || []).length, 0, `${service} must remain private`);
  assert.equal(c.services[service].platform, 'linux/amd64');
}
const g = c.services.gateway;
assert.deepEqual(g.ports.map(p => String(p.published)).sort(), ['443','80']);
assert.equal(g.image, 'caddy:2.11.4-alpine');
assert.ok(g.volumes.find(v => v.target === '/etc/caddy/Caddyfile').source.endsWith('/liara/Caddyfile'));
assert.ok(g.volumes.some(v => v.type === 'volume' && v.target === '/data'));
assert.equal(c.services.auth.environment.GOTRUE_RATE_LIMIT_TOKEN_REFRESH, '300');
console.log('ok - Liara merge publishes only 80/443, retains private services and certificate storage');
JS
bash -n "$ROOT/deploy/liara/package-release.sh" "$ROOT/deploy/liara/apply-release.sh" "$ROOT/deploy/liara/backup.sh"
