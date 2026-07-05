#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const forbiddenSql = /\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|REPLACE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;

function readRequired(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) throw new Error(`${file} is missing.`);
  return readFileSync(fullPath, 'utf8');
}

function parsePackageJson() {
  try {
    return JSON.parse(readRequired('package.json'));
  } catch (error) {
    throw new Error(`package.json could not be parsed: ${error instanceof Error ? error.message : 'invalid JSON'}`);
  }
}

function hasLifecycleCron(wranglerToml) {
  return /^\s*\[triggers\]\s*$(?:\r?\n(?!\s*\[)[^\r\n]*)*?\r?\n\s*crons\s*=\s*\[\s*"0 \* \* \* \*"\s*\]\s*$/m.test(wranglerToml);
}

function extractReadOnlyQueries(scriptText) {
  const queries = [];
  const pattern = /runReadOnlyQuery\(\s*[^,]+,\s*(["'`])([\s\S]*?)\1\s*\)/g;
  let match;
  while ((match = pattern.exec(scriptText)) !== null) {
    queries.push(match[2].replace(/\s+/g, ' ').trim());
  }
  return queries;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const packageJson = parsePackageJson();
  const wranglerToml = readRequired('wrangler.toml');
  const lifecycleScript = readRequired('scripts/lifecycle-dry-run.mjs');

  assert(packageJson.scripts?.['lifecycle:dry-run'] === 'node scripts/lifecycle-dry-run.mjs', 'package.json lifecycle:dry-run script is missing or unexpected.');
  assert(packageJson.scripts?.['lifecycle:ci-check'] === 'node scripts/lifecycle-ci-check.mjs', 'package.json lifecycle:ci-check script is missing or unexpected.');
  assert(hasLifecycleCron(wranglerToml), 'wrangler.toml scheduled cron trigger is missing or unexpected.');

  for (const marker of ['dryRunOnly', 'writesExecuted', 'readOnly', 'SELECT']) {
    assert(lifecycleScript.includes(marker), `scripts/lifecycle-dry-run.mjs is missing safety marker: ${marker}.`);
  }

  assert(lifecycleScript.includes('forbiddenSql'), 'scripts/lifecycle-dry-run.mjs is missing the forbidden SQL guard.');
  assert(lifecycleScript.includes('wranglerBin'), 'scripts/lifecycle-dry-run.mjs should isolate Wrangler access behind the dry-run command path.');

  const queries = extractReadOnlyQueries(lifecycleScript);
  assert(queries.length > 0, 'No lifecycle dry-run read-only queries were found.');

  for (const query of queries) {
    assert(/^SELECT\b/i.test(query), `Lifecycle dry-run query is not SELECT-only: ${query}`);
    assert(!forbiddenSql.test(query), `Lifecycle dry-run query contains a forbidden SQL keyword: ${query}`);
  }

  return {
    ok: true,
    ciSafe: true,
    mode: 'lifecycle:ci-check',
    checks: {
      lifecycleDryRunScriptExists: true,
      wranglerTomlExists: true,
      scheduledCronConfigured: true,
      packageScriptsPresent: true,
      safetyMarkersPresent: true,
      selectOnlyQueries: queries.length,
    },
    cloudflareAccessed: false,
    d1Accessed: false,
    writesExecuted: false,
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    ciSafe: true,
    error: error instanceof Error ? error.message : 'Lifecycle CI check failed.',
    cloudflareAccessed: false,
    d1Accessed: false,
    writesExecuted: false,
  }, null, 2));
  process.exit(1);
}
