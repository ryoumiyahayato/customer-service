#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

CONFIRM_FLAG="${1:-}"
BACKUP_PATH="${2:-}"

if [[ "$CONFIRM_FLAG" != "--i-understand-this-overwrites-data" || -z "$BACKUP_PATH" ]]; then
  echo "Usage: ./restore.sh --i-understand-this-overwrites-data <backup-directory>"
  echo "Restore is refused by default to avoid accidental production data overwrite."
  exit 1
fi

[[ -d "$BACKUP_PATH" ]] || { echo "Backup directory not found."; exit 1; }
[[ -f ".env" ]] || { echo "Missing .env."; exit 1; }

set -a
source .env
set +a

[[ -n "${POSTGRES_USER:-}" ]] || { echo "POSTGRES_USER is required."; exit 1; }
[[ -n "${POSTGRES_DB:-}" ]] || { echo "POSTGRES_DB is required."; exit 1; }

cat <<'MSG'
Restore requires a maintenance window and overwrites application data.
The script will stop app writes before database restore. It will not print secret values.
MSG

if [[ ! -f "${BACKUP_PATH}/postgres.dump" ]]; then
  echo "Missing postgres.dump in backup directory."
  exit 1
fi

echo "Stopping app container before restore."
docker compose stop app

echo "Restoring PostgreSQL dump."
cat "${BACKUP_PATH}/postgres.dump" | docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

if [[ -f "${BACKUP_PATH}/storage.tar.gz" ]]; then
  echo "Restoring storage archive."
  mkdir -p storage
  tar -xzf "${BACKUP_PATH}/storage.tar.gz"
else
  echo "No storage archive found; skipping storage restore."
fi

echo "Starting services after restore."
docker compose up -d
"$ROOT_DIR/healthcheck.sh"
echo "Restore completed. Confirm application behavior before reopening traffic."
