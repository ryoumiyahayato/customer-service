#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const rawArgs = process.argv.slice(2);
if (!rawArgs.length) {
  console.log('This legacy deploy wrapper is retired.');
  console.log('Use: npm run deploy:safe');
  console.log('For pending migrations: npm run deploy:safe -- --apply-migrations');
  process.exit(0);
}

const forwarded = rawArgs.filter(arg => arg !== '--deploy');
const unknown = forwarded.filter(arg => !['--apply-migrations', '--help', '-h'].includes(arg));
if (!rawArgs.includes('--deploy') || unknown.length) {
  console.error('ERROR: This legacy wrapper only accepts --deploy and optional --apply-migrations.');
  console.error('Use npm run deploy:safe instead.');
  process.exit(1);
}

const safeScript = path.join(process.cwd(), 'scripts', 'deploy-cloudflare-safe.mjs');
const result = spawnSync(process.execPath, [safeScript, ...forwarded], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`ERROR: Could not start guarded deploy: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
