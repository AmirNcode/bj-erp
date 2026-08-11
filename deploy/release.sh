#!/usr/bin/env bash
# =============================================================================
# deploy/release.sh — compatibility entry point for the guarded assistant.
#
#   ./deploy/release.sh
#   SKIP_TESTS=1 ./deploy/release.sh     # maps to BJ_SKIP_TESTS for emergencies
#
# New production releases must use bj-deploy so clean-main, immutable migration
# manifests, detached resume, architecture, backup, and health gates stay one
# contract. This filename remains only so older documentation/operator habits
# cannot accidentally enter the superseded transfer path.
# =============================================================================
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

[ "$#" -eq 0 ] || {
  printf 'ERROR: explicit release versions are retired; bj-deploy derives a timestamp + Git SHA.\n' >&2
  exit 2
}

if [ "${SKIP_TESTS:-0}" = 1 ]; then
  export BJ_SKIP_TESTS=1
fi

exec "$SCRIPT_DIR/bj-deploy" update client
