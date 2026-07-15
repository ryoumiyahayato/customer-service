#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

CONFIRM_FLAG="${1:-}"
BACKUP_PATH="${2:-}"
RESTORE_TEMP=""
PREVIOUS_STORAGE=""
PREVIOUS_DATABASE=""
APP_STOPPED=0
STORAGE_SWAPPED=0
DATABASE_RESTORED=0
RESTORE_SUCCEEDED=0

fail() {
  echo "ERROR: $1"
  exit 1
}

safe_remove_restore_path() {
  local target="$1"
  case "$target" in
    "$ROOT_DIR"/.restore-*) rm -rf -- "$target" ;;
    *) fail "Refusing to remove unexpected restore path." ;;
  esac
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ "$RESTORE_SUCCEEDED" != "1" && "$APP_STOPPED" == "1" ]]; then
    echo "Restore failed; attempting to return the application to its previous state."
    local rollback_safe=1
    if [[ "$DATABASE_RESTORED" == "1" && -f "$PREVIOUS_DATABASE" ]]; then
      echo "Rolling PostgreSQL back to the pre-restore snapshot."
      if ! docker compose exec -T postgres pg_restore --single-transaction --clean --if-exists --no-owner --no-privileges \
        -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "$PREVIOUS_DATABASE"; then
        echo "CRITICAL: PostgreSQL rollback failed; keep traffic closed and restore the pre-restore snapshot manually."
        rollback_safe=0
      fi
    fi
    if [[ "$STORAGE_SWAPPED" == "1" ]]; then
      if [[ -d "$ROOT_DIR/storage" ]]; then
        mv "$ROOT_DIR/storage" "$RESTORE_TEMP/failed-storage"
      fi
      if [[ -n "$PREVIOUS_STORAGE" && -d "$PREVIOUS_STORAGE" ]]; then
        mv "$PREVIOUS_STORAGE" "$ROOT_DIR/storage"
      else
        mkdir -p "$ROOT_DIR/storage"
      fi
    fi
    if [[ "$rollback_safe" == "1" ]]; then
      docker compose up -d || true
    else
      echo "Application remains stopped because rollback did not complete safely."
    fi
  fi

  if [[ -n "$PREVIOUS_STORAGE" && -d "$PREVIOUS_STORAGE" ]]; then
    safe_remove_restore_path "$PREVIOUS_STORAGE"
  fi
  if [[ -n "$RESTORE_TEMP" && -d "$RESTORE_TEMP" ]]; then
    safe_remove_restore_path "$RESTORE_TEMP"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

validate_manifest() {
  local manifest="$BACKUP_PATH/SHA256SUMS"
  [[ -f "$manifest" ]] || fail "Missing SHA256SUMS; legacy or unverifiable backups are refused."
  [[ -f "$BACKUP_PATH/SHA256SUMS.hmac" ]] || fail "Missing authenticated backup manifest."

  local expected_storage
  if [[ -f "$BACKUP_PATH/storage.tar.gz" && ! -e "$BACKUP_PATH/storage.empty" ]]; then
    expected_storage="storage.tar.gz"
  elif [[ -f "$BACKUP_PATH/storage.empty" && ! -e "$BACKUP_PATH/storage.tar.gz" ]]; then
    expected_storage="storage.empty"
  else
    fail "Backup must contain exactly one storage artifact."
  fi

  [[ "$(wc -l < "$manifest" | tr -d ' ')" == "3" ]] || fail "Invalid SHA256SUMS entry count."
  grep -Eq '^[0-9a-fA-F]{64}  postgres\.dump$' "$manifest" || fail "Invalid postgres.dump checksum entry."
  grep -Eq "^[0-9a-fA-F]{64}  ${expected_storage//./\\.}$" "$manifest" || fail "Invalid storage checksum entry."
  grep -Eq '^[0-9a-fA-F]{64}  README\.txt$' "$manifest" || fail "Invalid README checksum entry."
  local expected_hmac provided_hmac
  expected_hmac="$(sign_manifest < "$manifest")"
  provided_hmac="$(tr -d '\r\n' < "$BACKUP_PATH/SHA256SUMS.hmac")"
  [[ "$provided_hmac" =~ ^[A-Za-z0-9_-]{43}$ ]] || fail "Invalid backup manifest authentication code."
  [[ "$provided_hmac" == "$expected_hmac" ]] || fail "Backup manifest authentication failed."
  (cd "$BACKUP_PATH" && sha256sum --check --strict SHA256SUMS >/dev/null) || fail "Backup checksum verification failed."
}

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

validate_and_extract_storage() {
  local archive="$BACKUP_PATH/storage.tar.gz"
  [[ -f "$archive" ]] || return 0

  echo "Validating storage archive paths and entry types."
  local member
  while IFS= read -r member; do
    [[ "$member" == "storage" || "$member" == "storage/" || "$member" == storage/* ]] ||
      fail "Storage archive contains an entry outside storage/."
    [[ "$member" != /* && "$member" != *"\\"* && "$member" != *"/../"* && "$member" != "../"* && "$member" != *"/.." ]] ||
      fail "Storage archive contains an unsafe path."
  done < <(tar -tzf "$archive")

  local listing
  while IFS= read -r listing; do
    [[ "${listing:0:1}" == "-" || "${listing:0:1}" == "d" ]] ||
      fail "Storage archive contains links or unsupported entry types."
  done < <(tar -tvzf "$archive")

  tar -xzf "$archive" -C "$RESTORE_TEMP" --no-same-owner --no-same-permissions
  [[ -d "$RESTORE_TEMP/storage" ]] || fail "Storage archive does not contain the storage directory."
  if find "$RESTORE_TEMP/storage" -type l -print -quit | grep -q .; then
    fail "Extracted storage contains a symbolic link."
  fi
  if find "$RESTORE_TEMP/storage" ! -type f ! -type d -print -quit | grep -q .; then
    fail "Extracted storage contains an unsupported file type."
  fi
}

if [[ "$CONFIRM_FLAG" != "--i-understand-this-overwrites-data" || -z "$BACKUP_PATH" ]]; then
  echo "Usage: ./restore.sh --i-understand-this-overwrites-data <backup-directory>"
  echo "Restore is refused by default to avoid accidental production data overwrite."
  exit 1
fi

[[ -d "$BACKUP_PATH" ]] || fail "Backup directory not found."
BACKUP_PATH="$(cd "$BACKUP_PATH" && pwd -P)"
[[ -f ".env" ]] || fail "Missing .env."
[[ -f "$BACKUP_PATH/postgres.dump" ]] || fail "Missing postgres.dump in backup directory."

set -a
source .env
set +a

[[ -n "${POSTGRES_USER:-}" ]] || fail "POSTGRES_USER is required."
[[ -n "${POSTGRES_DB:-}" ]] || fail "POSTGRES_DB is required."
BACKUP_SIGNING_KEY="${BACKUP_SIGNING_KEY:-}"
[[ "${#BACKUP_SIGNING_KEY}" -ge 32 ]] || fail "BACKUP_SIGNING_KEY must be at least 32 characters."

cat <<'MSG'
Restore requires a maintenance window and overwrites application data.
The script verifies and pre-extracts the backup before stopping app writes. It will not print secret values.
MSG

RESTORE_TEMP="$(mktemp -d "$ROOT_DIR/.restore-work.XXXXXX")"
validate_manifest
validate_and_extract_storage

echo "Stopping app container before restore."
docker compose stop app
APP_STOPPED=1

PREVIOUS_DATABASE="$RESTORE_TEMP/pre-restore-postgres.dump"
echo "Creating a pre-restore PostgreSQL rollback snapshot."
docker compose exec -T postgres pg_dump -Fc --no-owner --no-privileges \
  -U "${POSTGRES_USER}" "${POSTGRES_DB}" > "$PREVIOUS_DATABASE"

echo "Restoring PostgreSQL dump."
docker compose exec -T postgres pg_restore --single-transaction --clean --if-exists --no-owner --no-privileges \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "$BACKUP_PATH/postgres.dump"
DATABASE_RESTORED=1

PREVIOUS_STORAGE="$ROOT_DIR/.restore-previous-storage.$$"
if [[ -d "$ROOT_DIR/storage" ]]; then
  mv "$ROOT_DIR/storage" "$PREVIOUS_STORAGE"
fi
if [[ -f "$BACKUP_PATH/storage.tar.gz" ]]; then
  mv "$RESTORE_TEMP/storage" "$ROOT_DIR/storage"
else
  mkdir -p "$ROOT_DIR/storage"
fi
STORAGE_SWAPPED=1

echo "Starting services after restore."
docker compose up -d
"$ROOT_DIR/healthcheck.sh"
RESTORE_SUCCEEDED=1
echo "Restore completed. Confirm application behavior before reopening traffic."
