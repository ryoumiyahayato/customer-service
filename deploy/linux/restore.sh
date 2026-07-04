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

if [[ ! -d "$BACKUP_PATH" ]]; then
  echo "Backup directory not found."
  exit 1
fi

cat <<'MSG'
Restore skeleton only.

This script intentionally does not overwrite production data automatically.
Before restoring, an operator must:
1. Stop application writes.
2. Verify the backup source.
3. Create a fresh backup of current data.
4. Approve PostgreSQL and storage restore commands manually.

TODO: implement guarded restore commands after the safety flow is finalized.
MSG
