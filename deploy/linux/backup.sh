#!/usr/bin/env bash
set -euo pipefail
umask 077

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
BACKUP_SIGNING_KEY="${BACKUP_SIGNING_KEY:-}"
[[ "${#BACKUP_SIGNING_KEY}" -ge 32 ]] || fail "BACKUP_SIGNING_KEY must be at least 32 characters."

sign_manifest() {
  docker compose run --rm --no-deps -T app node --input-type=module -e '
    import { createHmac } from "node:crypto";
    const key = process.env.BACKUP_SIGNING_KEY || "";
    if (Buffer.byteLength(key) < 32) process.exit(2);
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    process.stdout.write(createHmac("sha256", key).update(Buffer.concat(chunks)).digest("base64url"));
  '
}

BACKUP_TARGET="${BACKUP_DIR:-./backup}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_TARGET}/${STAMP}"

mkdir -p -m 700 "$OUT_DIR"
chmod 700 "$BACKUP_TARGET" "$OUT_DIR"

echo "Backing up PostgreSQL dump."
docker compose exec -T postgres pg_dump -Fc --no-owner --no-privileges -U "${POSTGRES_USER}" "${POSTGRES_DB}" > "${OUT_DIR}/postgres.dump"
chmod 600 "${OUT_DIR}/postgres.dump"

echo "Backing up local storage directory."
if [[ -d "storage" ]]; then
  if find storage -type l -print -quit | grep -q .; then
    fail "Storage contains symbolic links; refusing to create an unsafe archive."
  fi
  if find storage ! -type f ! -type d -print -quit | grep -q .; then
    fail "Storage contains unsupported file types."
  fi
  tar -czf "${OUT_DIR}/storage.tar.gz" storage
  chmod 600 "${OUT_DIR}/storage.tar.gz"
else
  touch "${OUT_DIR}/storage.empty"
  chmod 600 "${OUT_DIR}/storage.empty"
fi

cat > "${OUT_DIR}/README.txt" <<'MSG'
This backup intentionally does not include .env.
Store .env, SESSION_SECRET, SETUP_TOKEN, ENCRYPTION_KEY, database credentials, and DNS/server records in a separate protected secret backup.
MSG
chmod 600 "${OUT_DIR}/README.txt"

echo "Writing backup integrity manifest."
(
  cd "$OUT_DIR"
  if [[ -f storage.tar.gz ]]; then
    sha256sum postgres.dump storage.tar.gz README.txt > SHA256SUMS
  else
    sha256sum postgres.dump storage.empty README.txt > SHA256SUMS
  fi
  sign_manifest < SHA256SUMS > SHA256SUMS.hmac
)
chmod 600 "${OUT_DIR}/SHA256SUMS" "${OUT_DIR}/SHA256SUMS.hmac"

echo "Backup completed: ${OUT_DIR}"
echo ".env was not copied. Keep a separate protected secret backup."
