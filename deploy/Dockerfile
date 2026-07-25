# =============================================================================
# deploy/Dockerfile — production image for the BJ ERP app (self-host package).
#
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, but
# the client's real URL/keys are only known at INSTALL time. So we build with
# distinctive placeholder strings and substitute them with the real values on
# container start (see docker-entrypoint.sh). Standard self-host pattern.
#
# Build from the repo root:  docker build -f deploy/Dockerfile -t bj-erp-app .
# =============================================================================

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Placeholders — replaced at container start by docker-entrypoint.sh.
ENV NEXT_PUBLIC_SUPABASE_URL=https://bj-placeholder-supabase-url.invalid
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=BJ_PLACEHOLDER_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime image ────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# `output: 'standalone'` emits a self-contained server + minimal node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
COPY deploy/gen-keys.mjs /gen-keys.mjs
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENV HOSTNAME=0.0.0.0 PORT=3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
