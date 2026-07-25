#!/bin/sh
# =============================================================================
# App container entrypoint: substitute the build-time placeholders with the
# real (install-time) Supabase URL + anon key, then start the Next.js server.
#
# NEXT_PUBLIC_* values are baked into the compiled JS at build time; this
# rewrites every occurrence across the standalone server + client chunks.
# BusyBox-safe (Alpine): plain find + sed, no GNU grep options. Idempotent —
# after the first boot the placeholders no longer exist and sed is a no-op.
# =============================================================================
set -eu

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"

PLACEHOLDER_URL="https://bj-placeholder-supabase-url.invalid"
PLACEHOLDER_KEY="BJ_PLACEHOLDER_ANON_KEY"

find /app \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.rsc' -o -name '*.body' \) -type f \
  -exec sed -i \
    -e "s|$PLACEHOLDER_URL|$NEXT_PUBLIC_SUPABASE_URL|g" \
    -e "s|$PLACEHOLDER_KEY|$NEXT_PUBLIC_SUPABASE_ANON_KEY|g" \
    {} +

echo "entrypoint: Supabase URL/key substituted into built assets."
exec "$@"
