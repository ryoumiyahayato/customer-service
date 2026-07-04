#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKUP_PATH="${1:-}"

if [[ -z "$BACKUP_PATH" ]]; then
  echo "Usage: ./restore.sh <backup-directory>"
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
