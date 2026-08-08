#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';
const rawArgs = process.argv.slice(2);
const deployRequested = rawArgs.includes('--deploy');
const applyMigrations = rawArgs.includes('--apply-migrations');
const showHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const unknown = rawArgs.filter(arg => !['--deploy', '--apply-migrations', '--help', '-h'].includes(arg));

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.error || result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function usage() {
  console.log('Cloudflare deployment wrapper');
  console.log('');
  console.log('Preflight only (never deploys):');
  console.log('  npm run deploy:cloudflare');
  console.log('');
  console.log('Explicit guarded production deploy:');
  console.log('  npm run deploy:cloudflare -- --deploy');
  console.log('  npm run deploy:cloudflare -- --deploy --apply-migrations');
}

if (showHelp) {
  usage();
  process.exit(0);
}
if (unknown.length) fail(`Unsupported arguments: ${unknown.join(' ')}`);
if (applyMigrations && !deployRequested) {
  fail('--apply-migrations is valid only together with --deploy.');
}

// A real deploy delegates immediately, before any local build can modify tracked dist/.
// The guarded deploy is the single production authority and owns validation, migration
// checks, build, deploy, cleanup, and the post-deploy online smoke check.
if (deployRequested) {
  const safeScript = path.join(process.cwd(), 'scripts', 'deploy-cloudflare-safe.mjs');
  const forwarded = applyMigrations ? ['--apply-migrations'] : [];
  run(process.execPath, [safeScript, ...forwarded]);
  process.exit(0);
}

// Preserve the documented no-argument preflight contract. These checks can generate
// local build output, but this path never invokes a production deployment.
for (const args of [
  ['run', 'doctor'],
  ['run', 'bootstrap:cloudflare'],
  ['run', 'typecheck'],
  ['run', 'build'],
]) {
  run(npmBin, args);
}

console.log('Cloudflare preflight completed. No production deployment was started.');
