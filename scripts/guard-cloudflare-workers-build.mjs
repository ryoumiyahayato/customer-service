#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  extractPendingMigrationNames,
  migrationApplyArgs,
  migrationListArgs,
  workersBuildBranchDecision,
  wranglerInvocation,
} from './deployment-safety-lib.mjs';

const decision = workersBuildBranchDecision(process.env);
if (!decision.workersBuild) process.exit(0);

const root = process.cwd();
const ONE_TIME_APPLY_SENTINEL = path.join(root, 'ops', 'cloudflare-auto-apply-once-20260811');
const EXPECTED_ONE_TIME_PENDING = ['0015_security_resource_limits.sql'];

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

const localWrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function runWrangler(args) {
  const invocation = wranglerInvocation(existsSync(localWrangler) ? localWrangler : '', '', args);
  return spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
  });
}

function remotePendingMigrations() {
  const result = runWrangler(migrationListArgs());
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || '').trim();
    fail(`Remote D1 migration state could not be verified; refusing automatic production deployment.${detail ? ` ${detail}` : ''}`);
  }
  return extractPendingMigrationNames(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function sameMigrationSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.every((value, index) => value === b[index]);
}

let pending = remotePendingMigrations();
if (pending.length) {
  if (!existsSync(ONE_TIME_APPLY_SENTINEL)) {
    fail(`Pending remote D1 migrations block automatic production deployment: ${pending.join(', ')}. Apply them through npm run deploy:safe -- --apply-migrations.`);
  }
  if (!sameMigrationSet(pending, EXPECTED_ONE_TIME_PENDING)) {
    fail(`One-time migration apply sentinel is present, but remote pending migrations do not exactly match the approved set. Refusing mutation. Pending: ${pending.join(', ')}`);
  }

  console.log(`Cloudflare Workers Build gate: applying the approved one-time migration set (${pending.join(', ')}).`);
  const applied = runWrangler(migrationApplyArgs());
  if (applied.error || applied.status !== 0) {
    const detail = String(applied.stderr || applied.stdout || applied.error?.message || '').trim();
    fail(`One-time remote D1 migration apply failed.${detail ? ` ${detail}` : ''}`);
  }

  pending = remotePendingMigrations();
  if (pending.length) {
    fail(`Remote D1 migrations remain pending after the one-time apply: ${pending.join(', ')}`);
  }
  console.log('Cloudflare Workers Build gate: approved one-time migration applied and re-verified.');
}

console.log('Cloudflare Workers Build gate: main branch confirmed and no pending remote D1 migrations.');
