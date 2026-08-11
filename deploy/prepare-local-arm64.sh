#!/usr/bin/env bash
# Prepare native ARM64 images for local Apple-Silicon testing.
#
# This script only pulls/builds and tags images. It never stops containers,
# recreates services, applies migrations, or touches Docker volumes.
set -euo pipefail

cd "$(dirname "$0")/.."

readonly LOCAL_PLATFORM="linux/arm64"
readonly LOCAL_ARCH="arm64"

readonly -a SOURCE_IMAGES=(
  "supabase/postgres:15.8.1.085"
  "supabase/gotrue:v2.170.0"
  "postgrest/postgrest:v12.2.3"
  "caddy:2.8.4-alpine"
)

readonly -a LOCAL_IMAGES=(
  "supabase/postgres:15.8.1.085-local-arm64"
  "supabase/gotrue:v2.170.0-local-arm64"
  "postgrest/postgrest:v12.2.3-local-arm64"
  "caddy:2.8.4-alpine-local-arm64"
)

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

verify_arm64() {
  local image="$1"
  local architecture
  architecture=$(docker image inspect "$image" --format '{{.Architecture}}')
  [ "$architecture" = "$LOCAL_ARCH" ] \
    || fail "$image is $architecture; expected native $LOCAL_ARCH"
  printf '  verified %-58s %s\n' "$image" "$architecture"
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running"

daemon_arch=$(docker info --format '{{.Architecture}}')
case "$daemon_arch" in
  arm64|aarch64) ;;
  *) fail "Docker daemon is $daemon_arch; this local workflow requires Apple-Silicon ARM64" ;;
esac

printf 'Pulling pinned service images for %s...\n' "$LOCAL_PLATFORM"
for index in "${!SOURCE_IMAGES[@]}"; do
  source_image="${SOURCE_IMAGES[$index]}"
  local_image="${LOCAL_IMAGES[$index]}"
  docker pull --platform "$LOCAL_PLATFORM" "$source_image"
  docker tag "$source_image" "$local_image"
  verify_arm64 "$local_image"
done

printf 'Building the app for %s...\n' "$LOCAL_PLATFORM"
docker build --platform "$LOCAL_PLATFORM" -f deploy/Dockerfile -t bj-erp-app:local-arm64 .
verify_arm64 bj-erp-app:local-arm64

if [ -f deploy/.env ]; then
  docker compose --project-directory deploy \
    -f deploy/docker-compose.yml \
    -f deploy/docker-compose.local-arm64.yml \
    config >/dev/null
else
  # A first install has no generated .env yet. Use non-secret placeholders for
  # syntax/render validation only; install.sh creates the real values later.
  APP_HOST=localhost APP_PORT=3500 APP_ORIGIN=https://localhost:3500 \
    POSTGRES_PASSWORD=placeholder JWT_SECRET=placeholder ANON_KEY=placeholder \
    docker compose --project-directory deploy \
      -f deploy/docker-compose.yml \
      -f deploy/docker-compose.local-arm64.yml \
      config >/dev/null
fi

printf '\nNative local images are ready. No containers or volumes were changed.\n'
printf 'Continue with the backup and recreation steps in docs/LOCAL_REDEPLOY.md.\n'
