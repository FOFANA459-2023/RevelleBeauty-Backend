#!/usr/bin/env bash
# Checks read "condition && pass || fail". SC2015 warns that the || branch
# could run after the && branch; it can't here: pass() always succeeds and
# fail() always exits.
# shellcheck disable=SC2015
# Smoke-test a built API image the way production runs it.
#
#   scripts/smoke-test.sh <image>          e.g. scripts/smoke-test.sh revelle-api:ci
#
# Boots a throwaway Postgres and the image (production mode, the same
# hardening as deploy/docker-compose.ghcr.yml: read-only root filesystem, no
# Linux capabilities, no privilege escalation), waits for the container's own
# HEALTHCHECK, then checks behaviour from the outside. Used by CI before an
# image may be pushed, and runnable on a laptop with Docker.
set -euo pipefail

IMAGE="${1:?usage: smoke-test.sh <image>}"
RUN_ID="smoke-$$-$RANDOM"
NET="$RUN_ID-net"
DB="$RUN_ID-db"
API="$RUN_ID-api"
PORT="${SMOKE_PORT:-4010}"
BASE="http://127.0.0.1:$PORT"
SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PG_IMAGE="${SMOKE_PG_IMAGE:-postgres:17-alpine}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "---- api logs ----"; docker logs "$API" 2>&1 | tail -60 || true
  fi
  docker rm -f "$API" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_USER=revelle -e POSTGRES_PASSWORD=revelle -e POSTGRES_DB=revelle \
  "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -U revelle >/dev/null 2>&1 && break
  sleep 1
done

docker run -d --name "$API" --network "$NET" -p "127.0.0.1:$PORT:4000" \
  --read-only --tmpfs /tmp:size=64m --tmpfs /app/uploads:uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 200 --memory 640m \
  -e NODE_ENV=production -e LOG_LEVEL=warn \
  -e DATABASE_URL="postgresql://revelle:revelle@$DB:5432/revelle" \
  -e ADMIN_EMAIL=admin@smoke.test -e ADMIN_PASSWORD=smoke-test-password \
  -e ADMIN_JWT_SECRET="$SECRET$SECRET" \
  -e ORIGIN_SHARED_SECRET="$SECRET" \
  -e FRONTEND_URL=https://shop.example -e CORS_ORIGINS=https://shop.example \
  -e MAIL_DRIVER=console \
  "$IMAGE" >/dev/null

echo "Waiting for the container's HEALTHCHECK…"
for _ in $(seq 1 90); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$API" 2>/dev/null || echo starting)"
  [ "$state" = healthy ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$API")" = true ] || fail "container exited during start-up"
  sleep 1
done
[ "$state" = healthy ] || fail "container never became healthy (last: $state)"
pass "container healthy (migrations ran against a fresh database)"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

[ "$(code "$BASE/api/health")" = 200 ] && pass "health check open" || fail "health check"
[ "$(code "$BASE/api/products")" = 403 ] && pass "direct access without the Worker's secret is refused" \
  || fail "origin lock: request without X-Origin-Auth was not refused"
[ "$(code -H "X-Origin-Auth: wrong" "$BASE/api/products")" = 403 ] && pass "a wrong origin secret is refused" \
  || fail "origin lock: wrong secret accepted"

body="$(curl -s -H "X-Origin-Auth: $SECRET" "$BASE/api/products")"
echo "$body" | grep -q '"products"' && pass "catalog served through the Worker path" || fail "catalog: $body"

headers="$(curl -s -D - -o /dev/null -H "X-Origin-Auth: $SECRET" "$BASE/api/products")"
echo "$headers" | grep -qi '^x-powered-by' && fail "X-Powered-By leaks the framework" || pass "no X-Powered-By"
for h in strict-transport-security x-content-type-options x-frame-options content-security-policy; do
  echo "$headers" | grep -qi "^$h:" && pass "header $h" || fail "missing header $h"
done

[ "$(code -X POST -H "X-Origin-Auth: $SECRET" -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' -d '{"email":"a@b.co","password":"x"}' "$BASE/api/auth/login")" = 403 ] \
  && pass "cross-site login attempt refused (CSRF)" || fail "CSRF guard"
[ "$(code -X POST -H "X-Origin-Auth: $SECRET" -H 'Origin: https://shop.example' \
  -H 'Content-Type: application/json' -d '{"email":"a@b.co","password":"wrong-password"}' "$BASE/api/auth/login")" = 401 ] \
  && pass "same-site login reaches the handler" || fail "same-site login"
[ "$(code -X POST -H "X-Origin-Auth: $SECRET" -H 'Origin: https://shop.example' \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/checkout/session")" = 401 ] \
  && pass "checkout requires sign-in" || fail "checkout auth"

[ "$(docker exec "$API" id -u)" != 0 ] && pass "runs as a non-root user" || fail "runs as root"
docker exec "$API" sh -c 'touch /app/dist/x' 2>/dev/null && fail "root filesystem is writable" || pass "root filesystem read-only"
docker exec "$API" sh -c 'command -v npm' >/dev/null 2>&1 && fail "npm present in the runtime image" || pass "no package manager in the image"

echo "Smoke test passed: $IMAGE"
