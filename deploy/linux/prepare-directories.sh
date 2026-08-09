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

APP_UID="${APP_UID:-}"
APP_GID="${APP_GID:-}"
BACKUP_DIR="${BACKUP_DIR:-}"

[[ "$APP_UID" =~ ^[1-9][0-9]*$ ]] || fail "APP_UID must be an explicitly configured non-root numeric UID."
[[ "$APP_GID" =~ ^[1-9][0-9]*$ ]] || fail "APP_GID must be an explicitly configured non-root numeric GID."
[[ -n "$BACKUP_DIR" ]] || fail "BACKUP_DIR is required in .env."

check_metadata() {
  local path="$1"
  local expected_mode="$2"
  local expected_uid="$3"
  local expected_gid="$4"
  local label="$5"
  local owner group mode

  owner="$(stat -c '%u' -- "$path" 2>/dev/null || true)"
  group="$(stat -c '%g' -- "$path" 2>/dev/null || true)"
  mode="$(stat -c '%a' -- "$path" 2>/dev/null || true)"
  [[ "$owner" == "$expected_uid" && "$group" == "$expected_gid" ]] ||
    fail "${label} must be owned by ${expected_uid}:${expected_gid}; found ${owner:-unknown}:${group:-unknown}. Fix ownership before starting the service."
  [[ "$mode" == "$expected_mode" ]] ||
    fail "${label} must have mode ${expected_mode}; found ${mode:-unknown}. Fix permissions before starting the service."
}

secure_private_tree() {
  local path="$1"
  local label="$2"

  if [[ -L "$path" ]]; then
    fail "${label} must not be a symbolic link."
  fi
  mkdir -p -- "$path" || fail "Cannot create ${label}: ${path}"

  if find -P -- "$path" -type l -print -quit | grep -q .; then
    fail "${label} contains a symbolic link; refusing to change or mount it."
  fi
  if find -P -- "$path" ! -type f ! -type d -print -quit | grep -q .; then
    fail "${label} contains an unsupported file type."
  fi

  while IFS= read -r -d '' entry; do
    chown "${APP_UID}:${APP_GID}" -- "$entry" ||
      fail "Cannot set ${label} directory ownership on ${entry}; run this preparation as an account allowed to chown ${APP_UID}:${APP_GID}."
    chmod 700 -- "$entry" || fail "Cannot set ${label} directory mode on ${entry}."
  done < <(find -P -- "$path" -type d -print0)

  while IFS= read -r -d '' entry; do
    chown "${APP_UID}:${APP_GID}" -- "$entry" ||
      fail "Cannot set ${label} file ownership on ${entry}; run this preparation as an account allowed to chown ${APP_UID}:${APP_GID}."
    chmod 600 -- "$entry" || fail "Cannot set ${label} file mode on ${entry}."
  done < <(find -P -- "$path" -type f -print0)

  check_metadata "$path" "700" "$APP_UID" "$APP_GID" "$label"
}

secure_private_tree "$ROOT_DIR/storage" "storage"
secure_private_tree "$ROOT_DIR/logs" "logs"
secure_private_tree "$BACKUP_DIR" "backup directory"

echo "Private deployment directories are ready for app UID/GID ${APP_UID}:${APP_GID}."
