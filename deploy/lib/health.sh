#!/usr/bin/env bash
# Stack health contract. Caller provides bj_compose() and has loaded .env.

bj_wait_for_stack() {
  local retries="${1:-60}" attempt app_json auth_json db_health
  for attempt in $(seq 1 "$retries"); do
    db_health=$(bj_compose ps --format json db 2>/dev/null || true)
    app_json=$(bj_compose exec -T app node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const b=await r.text();if(r.status!==200||!b.includes('\\\"status\\\":\\\"ok\\\"'))process.exit(1)}).catch(()=>process.exit(1))" \
      2>/dev/null && printf ok || true)
    auth_json=$(bj_compose exec -T gateway wget -qO- http://auth:9999/health 2>/dev/null || true)
    if printf '%s' "$db_health" | grep -Eq 'healthy|"Health":"healthy"' \
       && [ "$app_json" = ok ] \
       && printf '%s' "$auth_json" | grep -q 'GoTrue'; then
      return 0
    fi
    sleep 2
  done
  bj_compose ps >&2 || true
  bj_fail "stack did not pass database, app, and Auth health checks"
}

bj_verify_running_architecture() {
  local expected="$1" service image actual
  for service in db auth rest app gateway; do
    image=$(bj_compose images -q "$service" 2>/dev/null | head -n 1)
    [ -n "$image" ] || { bj_fail "no image found for service $service"; return 1; }
    actual=$(docker image inspect "$image" --format '{{.Architecture}}')
    bj_require_arch "$actual" "$expected" "service $service" || return 1
  done
}
