#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_MIGRATIONS=0
SELF_CHECK=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --migrate) RUN_MIGRATIONS=1 ;;
    --self-check|--check) SELF_CHECK=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "Usage: ./install.sh [--self-check] [--dry-run] [--migrate]"
      exit 1
      ;;
  esac
done

fail() {
  echo "ERROR: $1"
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "Missing $1."
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "${name} is required in .env."
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "This installer must run on Linux."
fi

require_file ".env"
require_file "docker-compose.yml"
require_file "Caddyfile"
require_file "healthcheck.sh"

set -a
source .env
set +a

for name in \
  APP_DOMAIN \
  VISITOR_ROOT_DOMAIN \
  POSTGRES_DB \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  DATABASE_URL \
  SESSION_SECRET \
  SETUP_TOKEN \
  STORAGE_PATH \
  BACKUP_DIR; do
  require_env "$name"
done

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required. Install Docker first."
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose plugin is required."
fi

mkdir -p storage logs "${BACKUP_DIR:-./backup}"

echo "Linux deployment preflight passed."
echo "Validating Docker Compose configuration..."
run docker compose config

if [[ "$SELF_CHECK" == "1" ]]; then
  echo "Self-check completed without starting services."
  exit 0
fi

echo "Building application image..."
run docker compose build app

echo "Starting PostgreSQL..."
run docker compose up -d postgres

echo "Waiting for PostgreSQL readiness..."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] docker compose exec -T postgres pg_isready"
else
  for _ in {1..30}; do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null
fi

if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  echo "Running server-generic PostgreSQL migrations by explicit --migrate opt-in..."
  run docker compose run --rm app npm run migrate -- up
else
  echo "Skipping PostgreSQL migrations. Re-run ./install.sh --migrate only during an approved migration window."
fi

echo "Starting full stack..."
run docker compose up -d

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] ./healthcheck.sh"
else
  "$ROOT_DIR/healthcheck.sh"
fi

echo "Admin URL: https://${APP_DOMAIN}"
echo "Setup URL: https://${APP_DOMAIN}/setup"
echo "Visitor root URL: https://${VISITOR_ROOT_DOMAIN}"
