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

BACKUP_TARGET="${BACKUP_DIR:-./backup}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_TARGET}/${STAMP}"

mkdir -p "$OUT_DIR"

echo "Backing up PostgreSQL to ${OUT_DIR}/postgres.dump"
docker compose exec -T postgres pg_dump -Fc --no-owner --no-privileges -U "${POSTGRES_USER}" "${POSTGRES_DB}" > "${OUT_DIR}/postgres.dump"

echo "Backing up local storage to ${OUT_DIR}/storage.tar.gz"
tar -czf "${OUT_DIR}/storage.tar.gz" storage

echo "Backup completed: ${OUT_DIR}"
