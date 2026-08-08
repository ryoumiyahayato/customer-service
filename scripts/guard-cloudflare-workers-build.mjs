#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  extractPendingMigrationNames,
  migrationListArgs,
  workersBuildBranchDecision,
  wranglerInvocation,
} from './deployment-safety-lib.mjs';

const decision = workersBuildBranchDecision(process.env);
if (!decision.workersBuild) process.exit(0);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!decision.allowed) {
  fail('Cloudflare Workers Build branch is unavailable; refusing to build because production/preview intent cannot be verified.');
}

// Workers Builds has a distinct non-production deploy command (normally
// `wrangler versions upload`). A preview/version build must be allowed to compile,
// but it must never use the production D1 migration gate as evidence that it may
// promote traffic. Production migration verification is therefore main-only.
if (!decision.production) {
  console.log(`Cloudflare Workers Build gate: non-production branch "${decision.branch}" may build/upload a version; production promotion is not authorized.`);
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
  fail(`Remote D1 migration state could not be verified; refusing automatic production deployment.${detail ? ` ${detail}` : ''}`);
}

const pending = extractPendingMigrationNames(`${result.stdout || ''}\n${result.stderr || ''}`);
if (pending.length) {
  fail(`Pending remote D1 migrations block automatic production deployment: ${pending.join(', ')}. Apply them through npm run deploy:safe -- --apply-migrations.`);
}

console.log('Cloudflare Workers Build gate: main branch confirmed and no pending remote D1 migrations.');
