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

set -a
source .env
set +a

mkdir -p storage logs backup

echo "Validating Docker Compose configuration..."
docker compose config >/dev/null

echo "Building and starting services..."
docker compose up -d --build

if [[ "${RUN_SERVER_MIGRATIONS:-0}" == "1" ]]; then
  echo "Running server-generic PostgreSQL migrations by explicit operator opt-in..."
  docker compose exec -T app node dist/db/migrate.js
else
  echo "Skipping PostgreSQL migrations. Set RUN_SERVER_MIGRATIONS=1 only after explicit operator approval."
fi

"$ROOT_DIR/healthcheck.sh"

echo "Admin URL: https://${APP_DOMAIN}"
echo "Setup URL: https://${APP_DOMAIN}/setup"
