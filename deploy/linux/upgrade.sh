#!/usr/bin/env bash
set -euo pipefail
umask 077

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
[[ -x "./prepare-directories.sh" ]] || { echo "Missing executable prepare-directories.sh."; exit 1; }
set -a
source .env
set +a

"$ROOT_DIR/prepare-directories.sh"

PREVIOUS_IMAGE_ID="$(docker image inspect customer-chat-app:local --format '{{.Id}}' 2>/dev/null || true)"
ROLLBACK_TAG="customer-chat-app:rollback-$(date +%Y%m%d%H%M%S)"
UPGRADE_SUCCEEDED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$UPGRADE_SUCCEEDED" != "1" && -n "$PREVIOUS_IMAGE_ID" ]]; then
    echo "Upgrade failed; restoring the previous application image."
    docker image tag "$ROLLBACK_TAG" customer-chat-app:local || true
    docker compose up -d app caddy || true
    if [[ "$RUN_MIGRATIONS" == "1" ]]; then
      echo "WARNING: application image was rolled back, but database migrations require a verified backup or down migration."
    fi
  fi
  if [[ -n "$PREVIOUS_IMAGE_ID" ]]; then
    docker image rm "$ROLLBACK_TAG" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if [[ -n "$PREVIOUS_IMAGE_ID" ]]; then
  docker image tag "$PREVIOUS_IMAGE_ID" "$ROLLBACK_TAG"
fi

echo "Starting upgrade. Create and verify a backup before running this script in production."
echo "Pulling PostgreSQL and Caddy service images..."
docker compose pull postgres caddy

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
UPGRADE_SUCCEEDED=1

echo "Upgrade completed. Application-image rollback is automatic on failure; database migration rollback remains operator-managed."
