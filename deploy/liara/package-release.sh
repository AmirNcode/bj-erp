#!/usr/bin/env bash
# Build a clean, committed Linux release. No database secrets enter this artifact.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=${1:-$(git rev-parse HEAD)}
[[ "$VERSION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected full commit SHA' >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$VERSION" ] || { echo 'HEAD does not match release' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'Commit all reviewed changes before building' >&2; exit 1; }
OUT="$PWD/.bj-deploy/liara/artifacts/$VERSION"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT" "$STAGE/stack/sql/init" "$STAGE/stack/migrations"
docker build --platform linux/amd64 -f deploy/Dockerfile -t "bj-erp-app:$VERSION" .
[ "$(docker image inspect "bj-erp-app:$VERSION" --format '{{.Architecture}}')" = amd64 ]
docker save "bj-erp-app:$VERSION" | gzip -1 > "$STAGE/app-image.tar.gz"
cp deploy/install.sh deploy/update.sh deploy/remote-job.sh deploy/docker-compose*.yml "$STAGE/stack/"
cp -R deploy/lib deploy/caddy deploy/liara "$STAGE/stack/"
cp deploy/sql/init/00-init.sh "$STAGE/stack/sql/init/"
cp deploy/sql/bootstrap_admin.sql "$STAGE/stack/sql/"
cp supabase/seed.sql "$STAGE/stack/sql/seed.sql"
cp supabase/migrations/*.sql "$STAGE/stack/migrations/"
printf '%s\n' "$VERSION" > "$STAGE/stack/RELEASE"
COPYFILE_DISABLE=1 tar -cf "$OUT/release.tar" -C "$STAGE" .
(cd "$OUT"; shasum -a 256 release.tar > release.sha256)
printf 'Release artifact: %s\n' "$OUT"
