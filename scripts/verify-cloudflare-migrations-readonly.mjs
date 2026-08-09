#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  extractPendingMigrationNames,
  migrationListArgs,
  wranglerInvocation,
} from './deployment-safety-lib.mjs';

const VERIFY_BRANCH = 'ops/verify-cloudflare-migrations-20260809';
if (process.env.WORKERS_CI !== '1' || String(process.env.WORKERS_CI_BRANCH || '') !== VERIFY_BRANCH) {
  process.exit(0);
}

const isWindows = process.platform === 'win32';
const npxBin = isWindows ? 'npx.cmd' : 'npx';
const localWrangler = path.join(process.cwd(), 'node_modules', '.bin', `wrangler${isWindows ? '.cmd' : ''}`);
const invocation = wranglerInvocation(existsSync(localWrangler) ? localWrangler : '', npxBin, migrationListArgs());
const result = spawnSync(invocation.command, invocation.args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  shell: isWindows,
  timeout: 120000,
});

if (result.error || result.status !== 0) {
  const detail = String(result.stderr || result.stdout || result.error?.message || '').trim();
  console.error(`ERROR: Read-only remote D1 migration verification failed.${detail ? ` ${detail}` : ''}`);
  process.exit(1);
}

const pending = extractPendingMigrationNames(`${result.stdout || ''}\n${result.stderr || ''}`);
if (pending.length) {
  console.error(`ERROR: Remote D1 migrations are still pending after the production apply attempt: ${pending.join(', ')}`);
  process.exit(1);
}

console.log('Read-only remote D1 verification: zero pending migrations.');
