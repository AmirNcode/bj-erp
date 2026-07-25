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

VERSION=$(git describe --tags --always 2>/dev/null || date +%Y%m%d)
OUT="dist/bj-erp-installer"
IMAGES=(
  "supabase/postgres:15.8.1.085"
  "supabase/gotrue:v2.170.0"
  "postgrest/postgrest:v12.2.3"
  "caddy:2.8.4-alpine"
)

echo "==> Building app image (bj-erp-app:${VERSION})…"
docker build -f deploy/Dockerfile -t "bj-erp-app:${VERSION}" -t bj-erp-app:latest .

echo "==> Pulling pinned service images…"
for img in "${IMAGES[@]}"; do docker pull "$img"; done

echo "==> Assembling bundle…"
rm -rf "$OUT"
mkdir -p "$OUT/images" "$OUT/sql/init" "$OUT/caddy" "$OUT/migrations"

cp deploy/docker-compose.yml deploy/install.sh deploy/RUNBOOK.md deploy/env.example "$OUT/"
cp deploy/caddy/Caddyfile                  "$OUT/caddy/"
cp deploy/sql/init/00-init.sh              "$OUT/sql/init/"
cp deploy/sql/bootstrap_admin.sql          "$OUT/sql/"
cp supabase/seed.sql                       "$OUT/sql/seed.sql"
cp supabase/migrations/*.sql               "$OUT/migrations/"
chmod +x "$OUT/install.sh" "$OUT/sql/init/00-init.sh"

echo "==> Saving images (this is the slow part)…"
docker save bj-erp-app:latest              -o "$OUT/images/bj-erp-app.tar"
docker save "${IMAGES[@]}"                 -o "$OUT/images/services.tar"

echo "==> Creating archive…"
tar -C dist -czf "dist/bj-erp-installer-${VERSION}.tar.gz" bj-erp-installer
du -h "dist/bj-erp-installer-${VERSION}.tar.gz"

echo "Done: dist/bj-erp-installer-${VERSION}.tar.gz"
echo "Hand this single file to the client → tar xzf … && sudo ./install.sh"
