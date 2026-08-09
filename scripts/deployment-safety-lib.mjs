import { existsSync } from 'node:fs';
import path from 'node:path';

export const CLOUDFLARE_PRODUCTION_BRANCH = 'main';
export const D1_DATABASE_NAME = 'customer_chat_db';

export function workersBuildBranchDecision(env = process.env) {
  if (env.WORKERS_CI !== '1') {
    return { workersBuild: false, allowed: true, branch: '', reason: 'not_workers_build', production: false };
  }

  const branch = String(env.WORKERS_CI_BRANCH || '').trim();
  if (!branch) {
    return { workersBuild: true, allowed: false, branch: '', reason: 'missing_branch', production: false };
  }
  if (branch !== CLOUDFLARE_PRODUCTION_BRANCH) {
    return { workersBuild: true, allowed: true, branch, reason: 'preview_branch', production: false };
  }
  return { workersBuild: true, allowed: true, branch, reason: 'production_branch', production: true };
}

export function wranglerInvocation(wranglerBin, npxBin, args) {
  if (wranglerBin) {
    const candidate = wranglerBin.endsWith('.cmd')
      ? path.resolve(path.dirname(wranglerBin), '..', 'wrangler', 'bin', 'wrangler.js')
      : wranglerBin;
    if (existsSync(candidate)) return { command: process.execPath, args: [candidate, ...args] };
  }
  return nodeNpmInvocation(['exec', '--', 'wrangler', ...args]);
}

export function nodeNpmInvocation(args) {
  const configured = String(process.env.npm_execpath || '');
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = configured.endsWith('.js') && existsSync(configured) ? configured : bundled;
  if (!existsSync(npmCli)) throw new Error(`npm CLI entrypoint not found: ${npmCli}`);
  return { command: process.execPath, args: [npmCli, ...args] };
}

export function migrationListArgs() {
  return ['d1', 'migrations', 'list', D1_DATABASE_NAME, '--remote'];
}

export function migrationApplyArgs() {
  return ['d1', 'migrations', 'apply', D1_DATABASE_NAME, '--remote'];
}

export function extractPendingMigrationNames(output) {
  const names = [];
  const seen = new Set();
  for (const match of String(output || '').matchAll(/(?:^|[\s|│])([A-Za-z0-9][A-Za-z0-9._-]*\.sql)(?=$|[\s|│])/gm)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
