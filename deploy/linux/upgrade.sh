#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_MIGRATIONS=0
for arg in "$@"; do
  case "$arg" in
    --migrate) RUN_MIGRATIONS=1 ;;
    *)
      echo "Usage: ./upgrade.sh [--migrate]"
      exit 1
      ;;
  esac
done

[[ -f ".env" ]] || { echo "Missing .env."; exit 1; }
set -a
source .env
set +a

echo "Starting upgrade. Create a backup before running this script in production."
echo "Pulling service images where available..."
docker compose pull || true

echo "Building application image..."
docker compose build app

if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  echo "Running server-generic PostgreSQL migrations by explicit --migrate opt-in..."
  docker compose run --rm app npm run migrate -- up
else
  echo "Skipping migrations. Re-run ./upgrade.sh --migrate only during an approved migration window."
fi

echo "Starting services..."
docker compose up -d
"$ROOT_DIR/healthcheck.sh"

echo "Rollback TODO: restore the previous image and latest verified backup if healthcheck or business validation fails."
echo "Upgrade completed."
