#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Starting upgrade skeleton."
echo "TODO: create PostgreSQL and storage backup before upgrade."
echo "Pulling service images where available..."
docker compose pull || true
echo "Building application image..."
docker compose build app
echo "TODO: run migration only after explicit operator approval."
docker compose up -d
"$ROOT_DIR/healthcheck.sh"
echo "TODO: implement rollback using the previous image and backup if healthcheck fails."
echo "Upgrade skeleton completed."
