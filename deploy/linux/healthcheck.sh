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

echo "Checking application root..."
curl --fail --silent --show-error "${BASE_URL}/" >/dev/null

echo "Checking setup status endpoint..."
curl --fail --silent --show-error "${BASE_URL}/api/setup/status" >/dev/null

echo "Healthcheck passed."
