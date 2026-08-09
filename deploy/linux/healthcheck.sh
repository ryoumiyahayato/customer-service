#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "ERROR: $1"
  exit 1
}

require_running_service() {
  local name="$1"
  if ! docker compose ps --status running --services | grep -qx "$name"; then
    fail "${name} container is not running."
  fi
}

fetch_json() {
  local url="$1"
  curl --fail --silent --show-error "$url"
}

require_file() {
  [[ -f "$1" ]] || fail "Missing $1."
}

require_file ".env"
set -a
source .env
set +a

[[ -n "${APP_DOMAIN:-}" ]] || fail "APP_DOMAIN is required."
BASE_URL="https://${APP_DOMAIN}"

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required for healthcheck."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose plugin is required for healthcheck."
fi

echo "Checking Docker Compose service state..."
docker compose ps
require_running_service postgres
require_running_service app
require_running_service caddy

echo "Checking /healthz..."
if ! fetch_json "${BASE_URL}/healthz" >/dev/null; then
  echo "HTTPS health check failed; trying local Caddy endpoint."
  fetch_json "http://127.0.0.1/healthz" >/dev/null
fi

echo "Checking /api/setup/status..."
SETUP_JSON=""
if ! SETUP_JSON="$(fetch_json "${BASE_URL}/api/setup/status")"; then
  echo "HTTPS setup check failed; trying local Caddy endpoint."
  SETUP_JSON="$(fetch_json "http://127.0.0.1/api/setup/status")"
fi

node -e '
const input = process.argv[1] || "{}";
const data = JSON.parse(input);
const safe = {
  ok: Boolean(data.ok),
  setupAvailable: Boolean(data.setupAvailable),
  requiresSetupToken: Boolean(data.requiresSetupToken),
  reason: typeof data.reason === "string" ? data.reason : null,
};
console.log(JSON.stringify(safe));
' "$SETUP_JSON"

echo "Skipping write checks; healthcheck does not create sessions, upload attachments, log in admin, or call setup initialize."
echo "Healthcheck passed."
