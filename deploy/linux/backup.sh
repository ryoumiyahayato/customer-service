#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "ERROR: $1"
  exit 1
}

[[ -f ".env" ]] || fail "Missing .env."
set -a
source .env
set +a

[[ -n "${POSTGRES_USER:-}" ]] || fail "POSTGRES_USER is required."
[[ -n "${POSTGRES_DB:-}" ]] || fail "POSTGRES_DB is required."

BACKUP_TARGET="${BACKUP_DIR:-./backup}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_TARGET}/${STAMP}"

mkdir -p "$OUT_DIR"

echo "Backing up PostgreSQL dump."
docker compose exec -T postgres pg_dump -Fc --no-owner --no-privileges -U "${POSTGRES_USER}" "${POSTGRES_DB}" > "${OUT_DIR}/postgres.dump"

echo "Backing up local storage directory."
if [[ -d "storage" ]]; then
  tar -czf "${OUT_DIR}/storage.tar.gz" storage
else
  touch "${OUT_DIR}/storage.empty"
fi

cat > "${OUT_DIR}/README.txt" <<'MSG'
This backup intentionally does not include .env.
Store .env, SESSION_SECRET, SETUP_TOKEN, ENCRYPTION_KEY, database credentials, and DNS/server records in a separate protected secret backup.
MSG

echo "Backup completed: ${OUT_DIR}"
echo ".env was not copied. Keep a separate protected secret backup."
