#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../deploy/linux/${name}`, import.meta.url), 'utf8');
const [install, backup, restore, upgrade] = await Promise.all([
  read('install.sh'),
  read('backup.sh'),
  read('restore.sh'),
  read('upgrade.sh'),
]);

assert.match(install, /docker compose config --quiet/);
assert.doesNotMatch(install, /docker compose config\s*(?:\r?\n|$)/);

assert.match(backup, /sha256sum postgres\.dump storage\.tar\.gz README\.txt > SHA256SUMS/);
assert.match(backup, /find storage -type l/);
assert.match(backup, /unsupported file types/);
assert.match(backup, /SHA256SUMS\.hmac/);
assert.match(backup, /createHmac\("sha256", key\)/);

assert.match(restore, /sha256sum --check --strict SHA256SUMS/);
assert.match(restore, /Backup manifest authentication failed/);
assert.match(restore, /\^\[A-Za-z0-9_-\]\{43\}\$/);
assert.match(restore, /tar -tzf/);
assert.match(restore, /tar -tvzf/);
assert.match(restore, /outside storage\//);
assert.match(restore, /links or unsupported entry types/);
assert.match(restore, /mktemp -d/);
assert.match(restore, /--no-same-owner --no-same-permissions/);
assert.match(restore, /Restore failed; attempting to return the application to its previous state/);
assert.match(restore, /pre-restore-postgres\.dump/);
assert.match(restore, /Rolling PostgreSQL back to the pre-restore snapshot/);
assert.match(restore, /pg_restore --single-transaction --clean --if-exists/);
assert.match(restore, /Application remains stopped because rollback did not complete safely/);
assert.match(restore, /docker compose up -d \|\| true/);
assert.ok(restore.indexOf('validate_and_extract_storage') < restore.indexOf('docker compose stop app'));

assert.doesNotMatch(upgrade, /docker compose pull \|\| true/);
assert.match(upgrade, /docker compose pull postgres caddy/);
assert.match(upgrade, /customer-chat-app:rollback-/);
assert.match(upgrade, /restoring the previous application image/);
assert.match(upgrade, /database migrations require a verified backup or down migration/);

console.log('linux deployment security checks passed');
