#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline';
import {
  extractPendingMigrationNames,
  migrationApplyArgs,
  migrationListArgs,
  nodeNpmInvocation,
  wranglerInvocation,
} from './deployment-safety-lib.mjs';

const root = process.cwd();
const npmDisplay = 'npm';
const rawArgs = process.argv.slice(2);
const applyMigrations = rawArgs.includes('--apply-migrations');
const showHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const unknownArgs = rawArgs.filter(arg => !['--apply-migrations', '--help', '-h'].includes(arg));

function print(...values) {
  console.log(...values);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function commandResult(command, args, { capture = false, ignoreError = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
    shell: false,
    timeout: 120000,
  });
  if (result.error && !ignoreError) fail(`${command} failed: ${result.error.message}`);
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function run(command, args) {
  const result = commandResult(command, args);
  if (!result.ok) fail(`Command failed: ${command} ${args.join(' ')}`);
  return result;
}

function capture(command, args) {
  return commandResult(command, args, { capture: true, ignoreError: true });
}

function packageScript(name) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return typeof pkg.scripts?.[name] === 'string' ? pkg.scripts[name] : '';
}

function requireScript(name) {
  if (!packageScript(name)) fail(`Required package script is missing: ${name}`);
}

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    resolve(answer);
  }));
}

function wrangler(args) {
  const local = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return wranglerInvocation(existsSync(local) ? local : '', '', args);
}

function npm(args) {
  return nodeNpmInvocation(args);
}

function remoteMigrationState() {
  const invocation = wrangler(migrationListArgs());
  const result = capture(invocation.command, invocation.args);
  if (!result.ok) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(`Could not verify remote D1 migration state; deployment is blocked.${detail ? ` ${detail}` : ''}`);
  }
  return extractPendingMigrationNames(`${result.stdout}\n${result.stderr}`);
}

async function ensureMigrations() {
  let pending = remoteMigrationState();
  if (!pending.length) {
    print('Remote D1 migrations: none pending');
    return;
  }

  print('Pending remote D1 migrations:');
  for (const migration of pending) print(`  - ${migration}`);
  if (!applyMigrations) {
    fail(`Pending D1 migrations block deployment. Re-run with: ${npmDisplay} run deploy:safe -- --apply-migrations`);
  }
  if (!process.stdin.isTTY) {
    fail('Migration application requires an interactive terminal; refusing non-interactive production mutation.');
  }

  const answer = String(await ask('Apply these remote D1 migrations before deployment? Type yes or no: ')).trim().toLowerCase();
  if (answer !== 'yes' && answer !== 'y') fail('Migration application cancelled; deployment was not started.');

  const invocation = wrangler(migrationApplyArgs());
  run(invocation.command, invocation.args);

  pending = remoteMigrationState();
  if (pending.length) {
    fail(`Remote D1 migrations remain pending after apply: ${pending.join(', ')}`);
  }
  print('Remote D1 migrations applied and re-verified.');
}

function showUsage() {
  print('Guarded Cloudflare production deploy');
  print('');
  print('Usage:');
  print(`  ${npmDisplay} run deploy:safe`);
  print(`  ${npmDisplay} run deploy:safe -- --apply-migrations`);
  print('');
  print('The deploy is allowed only from a clean main branch exactly matching origin/main.');
  print('Remote D1 migration state must be readable. Pending migrations block deploy unless');
  print('--apply-migrations is provided and explicitly confirmed in an interactive terminal.');
}

async function main() {
  if (showHelp) {
    showUsage();
    return;
  }
  if (unknownArgs.length) fail(`Unsupported arguments: ${unknownArgs.join(' ')}`);

  print('=== Guarded Cloudflare production deploy ===');

  const branch = capture('git', ['branch', '--show-current']);
  if (!branch.ok) fail('Not a git repository.');
  if (branch.stdout.trim() !== 'main') fail(`Current branch is "${branch.stdout.trim()}", not "main".`);

  const status = capture('git', ['status', '--porcelain']);
  if (!status.ok) fail('Could not read git status.');
  if (status.stdout.trim()) fail('Working tree is not clean. Commit or stash changes first.');

  const fetch = capture('git', ['fetch', 'origin', 'main']);
  if (!fetch.ok) fail('Could not fetch origin/main; refusing deployment without remote branch verification.');
  const localHead = capture('git', ['rev-parse', 'HEAD']);
  const remoteHead = capture('git', ['rev-parse', 'origin/main']);
  if (!localHead.ok || !remoteHead.ok) fail('Could not resolve local and remote main revisions.');
  if (localHead.stdout.trim() !== remoteHead.stdout.trim()) {
    fail(`Local main (${localHead.stdout.trim()}) does not exactly match origin/main (${remoteHead.stdout.trim()}).`);
  }
  print(`main revision: ${localHead.stdout.trim()}`);

  for (const script of ['check:obvious', 'typecheck', 'doctor', 'doctor:online', 'lifecycle:ci-check', 'build']) requireScript(script);

  { const invocation = npm(['run', 'check:obvious']); run(invocation.command, invocation.args); }
  if (existsSync(path.join(root, 'scripts', 'check-chat-message-text.mjs'))) {
    run('node', ['scripts/check-chat-message-text.mjs']);
  }
  if (existsSync(path.join(root, 'scripts', 'check-session-lifecycle.mjs'))) {
    run('node', ['scripts/check-session-lifecycle.mjs']);
  }
  for (const script of ['typecheck', 'doctor', 'lifecycle:ci-check']) {
    const invocation = npm(['run', script]);
    run(invocation.command, invocation.args);
  }

  await ensureMigrations();

  { const invocation = npm(['run', 'build']); run(invocation.command, invocation.args); }

  const deployInvocation = wrangler(['deploy']);
  const deploy = commandResult(deployInvocation.command, deployInvocation.args, { capture: true });
  if (!deploy.ok) {
    process.stdout.write(deploy.stdout);
    process.stderr.write(deploy.stderr);
    fail('Wrangler deploy failed.');
  }
  process.stdout.write(deploy.stdout);
  process.stderr.write(deploy.stderr);

  commandResult('git', ['checkout', '--', 'dist'], { ignoreError: true });
  commandResult('git', ['clean', '-fd', '--', 'dist'], { ignoreError: true });
  const finalStatus = capture('git', ['status', '--porcelain']);
  if (!finalStatus.ok || finalStatus.stdout.trim()) {
    fail('Deployment completed but the working tree is not clean; inspect generated files before continuing.');
  }

  { const invocation = npm(['run', 'doctor:online']); run(invocation.command, invocation.args); }
  print('Deployment completed successfully and online smoke check passed.');
}

await main();
