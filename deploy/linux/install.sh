#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer must run on Linux."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required. Install the Docker Compose plugin first."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "Missing .env. Copy .env.example to .env and fill deployment values on the server."
  exit 1
fi

mkdir -p storage logs backup

echo "Validating Docker Compose configuration..."
docker compose config >/dev/null

echo "Building and starting services..."
docker compose up -d --build

echo "TODO: run database migration only after explicit operator approval."
"$ROOT_DIR/healthcheck.sh"

set -a
source .env
set +a

echo "Admin URL: https://${APP_DOMAIN}"
echo "Setup URL: https://${APP_DOMAIN}/setup"
