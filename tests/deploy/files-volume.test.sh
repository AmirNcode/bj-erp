#!/usr/bin/env bash
# Sales files volume: Compose (base + each overlay) and Dockerfile.
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
check() {
  local name="$1"; shift
  docker compose --env-file "$CASE_DIR/test.env" -f "$ROOT/deploy/docker-compose.yml" "$@" \
    config --format json > "$CASE_DIR/$name.json"
  node - "$CASE_DIR/$name.json" "$name" <<'JS'
const assert = require('node:assert/strict');
const c = require(process.argv[2]);
const app = c.services.app;
const v = (app.volumes || []).find(x => x.target === '/data/files');
assert.ok(v, 'app mounts /data/files');
assert.equal(v.type, 'volume');
assert.equal(v.source, 'sales-files');
assert.equal(app.environment.FILES_DIR, '/data/files');
assert.ok('sales-files' in c.volumes, 'top-level sales-files volume');
console.log(`ok - ${process.argv[3]}: app has sales-files at /data/files, FILES_DIR set`);
JS
}
check base
for o in liara local-arm64 client-amd64; do
  check "$o" -f "$ROOT/deploy/docker-compose.$o.yml"
done
node - "$ROOT/deploy/Dockerfile" <<'JS'
const assert = require('node:assert/strict');
const lines = require('node:fs').readFileSync(process.argv[2], 'utf8').split('\n');
const from = lines.map((l, i) => /^FROM /.test(l) ? i : -1).filter(i => i >= 0).pop();
const rt = lines.slice(from).join('\n');
const mk = rt.search(/mkdir -p \/data\/files[^\n]*chown[^\n]*\/data\/files/);
const user = rt.search(/^USER node$/m);
assert.ok(mk >= 0, 'runtime stage creates and chowns /data/files');
assert.ok(user > mk, 'chown happens before USER node');
console.log('ok - Dockerfile runtime stage creates /data/files owned by node before USER node');
JS
