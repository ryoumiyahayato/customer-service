#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const forbiddenSql = /\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|REPLACE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    dryRunOnly: true,
    writesExecuted: false,
  }));
  process.exit(1);
}

function readWranglerToml() {
  const file = path.join(root, 'wrangler.toml');
  if (!existsSync(file)) fail('wrangler.toml not found; cannot safely determine D1 database.');
  return readFileSync(file, 'utf8');
}

function parseD1Database(text) {
  const match = text.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/);
  if (!match) fail('No [[d1_databases]] block found in wrangler.toml.');

  const block = match[1];
  const field = (name) => {
    const fieldMatch = block.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"\\s*$`, 'm'));
    return fieldMatch ? fieldMatch[1] : '';
  };
  const binding = field('binding');
  const databaseName = field('database_name');
  const migrationsDir = field('migrations_dir') || 'migrations';

  if (!binding || !databaseName) fail('D1 binding or database_name is missing in wrangler.toml.');
  return { binding, databaseName, migrationsDir };
}

function extractRows(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) fail('Wrangler did not return JSON output.');

  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    fail('Could not parse Wrangler JSON output.');
  }

  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  const rows = result?.results || result?.result?.[0]?.results || result?.result?.results;
  if (!Array.isArray(rows) || !rows[0]) fail('Wrangler JSON output did not include result rows.');
  return rows;
}

function runReadOnlyQuery(databaseName, sql) {
  if (forbiddenSql.test(sql)) fail('Refusing to run non-read-only SQL.');
  if (!existsSync(wranglerBin)) fail('Local Wrangler binary not found. Run npm install before dry-run.');

  let output = '';
  try {
    const commandArgs = ['d1', 'execute', databaseName, '--remote', '--json', '--command', sql.replace(/\s+/g, ' ')];
    output = execFileSync(process.execPath, [wranglerBin, ...commandArgs], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
  } catch {
    fail('Wrangler read-only D1 query failed.');
  }

  return extractRows(output)[0];
}

const d1 = parseD1Database(readWranglerToml());
const cutoffRow = runReadOnlyQuery(d1.databaseName, "SELECT datetime('now', '-24 hours') AS cutoff;");
const archiveRow = runReadOnlyQuery(d1.databaseName, "SELECT COUNT(*) AS autoArchiveCount FROM sessions WHERE status = 'CLOSED' AND closed_at <= datetime('now', '-24 hours') AND archived_at IS NULL AND deleted_at IS NULL;");
const recycleRow = runReadOnlyQuery(d1.databaseName, "SELECT COUNT(*) AS autoRecycleCount FROM sessions WHERE archived_at IS NOT NULL AND deleted_at IS NULL AND archived_at <= datetime('now', '-24 hours');");
const clearSessionRow = runReadOnlyQuery(d1.databaseName, "SELECT COUNT(*) AS autoClearHistorySessionCount FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-24 hours') AND history_cleared_at IS NULL;");
const clearMessageRow = runReadOnlyQuery(d1.databaseName, "SELECT COUNT(*) AS autoClearHistoryMessageCount FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-24 hours') AND history_cleared_at IS NULL);");
const clearAttachmentRow = runReadOnlyQuery(d1.databaseName, "SELECT COUNT(*) AS autoClearHistoryAttachmentCount FROM attachments WHERE conversation_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-24 hours') AND history_cleared_at IS NULL) OR message_id IN (SELECT id FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-24 hours') AND history_cleared_at IS NULL));");

console.log(JSON.stringify({
  ok: true,
  mode: 'lifecycle:dry-run',
  database: {
    binding: d1.binding,
    databaseName: d1.databaseName,
    migrationsDir: d1.migrationsDir,
  },
  cutoff: cutoffRow.cutoff,
  autoArchiveCount: Number(archiveRow.autoArchiveCount || 0),
  autoRecycleCount: Number(recycleRow.autoRecycleCount || 0),
  autoClearHistorySessionCount: Number(clearSessionRow.autoClearHistorySessionCount || 0),
  autoClearHistoryMessageCount: Number(clearMessageRow.autoClearHistoryMessageCount || 0),
  autoClearHistoryAttachmentCount: Number(clearAttachmentRow.autoClearHistoryAttachmentCount || 0),
  readOnly: true,
  writesExecuted: false,
  sqlType: 'SELECT',
}, null, 2));
