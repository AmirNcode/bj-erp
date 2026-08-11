#!/usr/bin/env bash
# =============================================================================
# deploy/package.sh — build the offline installer bundle (run on OUR machine).
#
#   ./deploy/package.sh            → dist/bj-erp-installer-<version>.tar.gz
#
# The bundle is fully offline: all container images are saved as tar files,
# so the client's server never needs to reach Docker Hub (or any registry).
# Requires: Docker running + internet (to pull the pinned service images).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

VERSION=${1:-$(git describe --tags --always 2>/dev/null || date +%Y%m%d)}
case "$VERSION" in
  ''|*[!A-Za-z0-9._-]*) echo "ERROR: invalid version '$VERSION'" >&2; exit 1 ;;
esac
OUT="dist/bj-erp-installer"
SOURCE_IMAGES=(
  "supabase/postgres:15.8.1.085"
  "supabase/gotrue:v2.170.0"
  "postgrest/postgrest:v12.2.3"
  "caddy:2.8.4-alpine"
)
CLIENT_IMAGES=(
  "supabase/postgres:15.8.1.085-client-amd64"
  "supabase/gotrue:v2.170.0-client-amd64"
  "postgrest/postgrest:v12.2.3-client-amd64"
  "caddy:2.8.4-alpine-client-amd64"
)

# The client's server is amd64 and this Mac is arm64. Without an explicit
# platform, `docker build` and `docker pull` both silently produce arm64
# artifacts that die on the server with `exec format error` — and the bundle is
# offline, so the mistake is only discovered on site. release.sh already guards
# its build this way; the same guard belongs here, on the FRESH-INSTALL path.
#
# The pulls matter as much as the build: caddy (and others) publish multi-arch
# manifests, so a re-pull on this Mac would swap a working amd64 image for an
# arm64 one without saying anything.
PLATFORM="linux/amd64"

verify_arch() { # image
  local got
  got=$(docker image inspect "$1" --format '{{.Architecture}}')
  [ "$got" = "amd64" ] \
    || { echo "ERROR: $1 is '${got}', the server needs amd64 — nothing was packaged." >&2; exit 1; }
}

echo "==> Building app image (bj-erp-app:${VERSION}) for ${PLATFORM} (emulated — slow)…"
DOCKER_DEFAULT_PLATFORM="$PLATFORM" \
  docker build -f deploy/Dockerfile -t "bj-erp-app:${VERSION}" -t bj-erp-app:latest .
verify_arch "bj-erp-app:${VERSION}"

echo "==> Pulling pinned service images for ${PLATFORM}…"
for index in "${!SOURCE_IMAGES[@]}"; do
  docker pull --platform "$PLATFORM" "${SOURCE_IMAGES[$index]}"
  docker tag "${SOURCE_IMAGES[$index]}" "${CLIENT_IMAGES[$index]}"
done

echo "==> Verifying every image is amd64 before saving…"
verify_arch bj-erp-app:latest
for img in "${CLIENT_IMAGES[@]}"; do verify_arch "$img"; done
echo "  architecture verified: amd64 (app + ${#CLIENT_IMAGES[@]} service images)"

echo "==> Assembling bundle…"
rm -rf "$OUT"
mkdir -p "$OUT/images" "$OUT/sql/init" "$OUT/caddy" "$OUT/migrations" "$OUT/lib"

cp deploy/docker-compose.yml deploy/docker-compose.client-amd64.yml \
   deploy/install.sh deploy/update.sh deploy/remote-job.sh \
   deploy/RUNBOOK.md deploy/env.example "$OUT/"
cp deploy/lib/common.sh deploy/lib/migrations.sh deploy/lib/health.sh "$OUT/lib/"
cp deploy/caddy/Caddyfile                  "$OUT/caddy/"
cp deploy/sql/init/00-init.sh              "$OUT/sql/init/"
cp deploy/sql/bootstrap_admin.sql          "$OUT/sql/"
cp supabase/seed.sql                       "$OUT/sql/seed.sql"
cp supabase/migrations/*.sql               "$OUT/migrations/"
chmod +x "$OUT/install.sh" "$OUT/update.sh" "$OUT/remote-job.sh" \
  "$OUT/lib/common.sh" "$OUT/lib/migrations.sh" "$OUT/lib/health.sh" \
  "$OUT/sql/init/00-init.sh"

echo "==> Saving images (this is the slow part)…"
docker save bj-erp-app:latest              -o "$OUT/images/bj-erp-app.tar"
docker save "${CLIENT_IMAGES[@]}"          -o "$OUT/images/services.tar"

echo "==> Creating archive…"
COPYFILE_DISABLE=1 tar -C dist -czf "dist/bj-erp-installer-${VERSION}.tar.gz" bj-erp-installer
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "dist/bj-erp-installer-${VERSION}.tar.gz" > "dist/bj-erp-installer-${VERSION}.tar.gz.sha256"
else
  shasum -a 256 "dist/bj-erp-installer-${VERSION}.tar.gz" > "dist/bj-erp-installer-${VERSION}.tar.gz.sha256"
fi
du -h "dist/bj-erp-installer-${VERSION}.tar.gz"

echo "Done: dist/bj-erp-installer-${VERSION}.tar.gz"
echo "Hand this single file to the client → tar xzf … && sudo ./install.sh"
