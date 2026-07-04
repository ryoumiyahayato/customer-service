#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  echo "Missing .env."
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${APP_DOMAIN:-}" ]]; then
  echo "APP_DOMAIN is required."
  exit 1
fi

BASE_URL="https://${APP_DOMAIN}"

echo "Checking Docker Compose service state..."
docker compose ps

if ! docker compose ps --status running --services | grep -qx "app"; then
  echo "App container is not running."
  exit 1
fi

echo "Checking application root..."
if ! curl --fail --silent --show-error "${BASE_URL}/" >/dev/null; then
  echo "HTTPS root check failed; trying local Caddy endpoint."
  curl --fail --silent --show-error "http://127.0.0.1/" >/dev/null
fi

echo "Checking health endpoint..."
if ! curl --fail --silent --show-error "${BASE_URL}/healthz" >/dev/null; then
  echo "HTTPS health check failed; trying local Caddy endpoint."
  curl --fail --silent --show-error "http://127.0.0.1/healthz" >/dev/null
fi

echo "Checking setup status endpoint..."
if ! curl --fail --silent --show-error "${BASE_URL}/api/setup/status" >/dev/null; then
  echo "HTTPS setup check failed; trying local Caddy endpoint."
  curl --fail --silent --show-error "http://127.0.0.1/api/setup/status" >/dev/null
fi

echo "Healthcheck passed."
