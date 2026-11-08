#!/usr/bin/env bash
# End-to-end smoke test through the Gateway: readiness, create, cache MISS/HIT, search.
#   BASE_URL=http://127.0.0.1 HOST_HEADER=api.localtest.me bash scripts/smoke.sh
source "$(dirname "$0")/lib.sh"

BASE_URL="${BASE_URL:-http://127.0.0.1}"
HOST_HEADER="${HOST_HEADER:-api.localtest.me}"
c() { curl -fsS --max-time 10 -H "Host: $HOST_HEADER" "$@"; }

log "readyz"
for i in $(seq 1 30); do
  if out="$(c "$BASE_URL/readyz" 2>/dev/null)"; then break; fi
  [ "$i" -eq 30 ] && die "readyz never returned 200"
  sleep 2
done
echo "  $out"
grep -q '"status":"ok"' <<<"$out" || warn "dependencies degraded: $out"

name="smoke-$(date +%s)"
log "POST /items ($name)"
id="$(c -X POST -H 'content-type: application/json' \
  -d "{\"name\":\"$name\",\"description\":\"redis mysql elasticsearch smoke\"}" \
  "$BASE_URL/items" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
[ -n "$id" ] || die "no id returned"
echo "  id=$id"

log "GET /items/$id twice (expect MISS then HIT)"
first="$(c -o /dev/null -D - "$BASE_URL/items/$id" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}')"
second="$(c -o /dev/null -D - "$BASE_URL/items/$id" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}')"
echo "  $first -> $second"
[ "$first" = "MISS" ] && [ "$second" = "HIT" ] || die "cache-aside not behaving (got $first/$second)"

log "GET /search?q=$name"
c "$BASE_URL/search?q=$name" | grep -q "\"id\":$id" || die "item not found in Elasticsearch"
echo "  found"

log "smoke OK"
