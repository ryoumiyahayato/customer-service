#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

const root = process.cwd();
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const args = new Set(process.argv.slice(2));
const applyMigrations = args.has('--apply-migrations');
const showHelp = args.has('--help') || args.has('-h');

function print(...msg) { console.log(...msg); }
function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

function run(cmd, argsArr, opts = {}) {
  const { cwd = root, stdio = 'inherit', env = process.env, ignoreError = false } = opts;
  const result = spawnSync(cmd, argsArr, { cwd, stdio, env, shell: isWin, timeout: 120000 });
  if (result.error && !ignoreError) fail(`Command failed: ${cmd} ${argsArr.join(' ')}\n${result.error.message}`);
  const ok = result.status === 0;
  return { ok, status: result.status, stdout: result.stdout?.toString() || '', stderr: result.stderr?.toString() || '' };
}

function capture(cmd, argsArr, opts = {}) {
  const { cwd = root, env = process.env, ignoreError = true } = opts;
  const result = spawnSync(cmd, argsArr, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env, shell: isWin, timeout: 120000 });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
  };
}

function checkScriptExists(name) {
  const pkgPath = path.join(root, 'package.json');
  if (!existsSync(pkgPath)) fail('package.json not found');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts?.[name]) fail(`Script "${name}" is missing from package.json`);
}

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, answer => { rl.close(); resolve(answer); }));
}

if (showHelp) {
  print('Safe Cloudflare Deploy Tool');
  print('');
  print('Usage:');
  print(`  ${npmCmd} run deploy:safe`);
  print(`  ${npmCmd} run deploy:safe -- --apply-migrations`);
  print(`  ${npmCmd} run deploy:safe -- --help`);
  print('');
  print('Description:');
  print('  Deploys the current main branch to Cloudflare test environment.');
  print('  Runs pre-deployment checks, typecheck, build, and deploy.');
  print('');
  print('Options:');
  print('  --apply-migrations  Allow applying pending D1 remote migrations (requires confirmation)');
  print('  --help, -h          Show this help');
  print('');
  print('Security:');
  print('  - Does NOT run lifecycle:dry-run');
  print('  - Does NOT modify Wrangler secrets');
  print('  - Does NOT delete R2 objects');
  print('  - Does NOT auto commit/push/tag');
  print('  - Does NOT run setup initialize');
  print('  - Does NOT run git add .');
  print('  - Pending D1 migrations block deployment unless --apply-migrations is used');
  process.exit(0);
}

const summary = {};

function main() {
  print('========================================');
  print('  Safe Cloudflare Deploy Tool');
  print('========================================');
  print('');
  print('  This tool deploys the current main branch to the');
  print('  Cloudflare test environment.');
  print('');
  print('  What it does:');
  print('  - Git status check');
  print('  - TypeScript type check');
  print('  - Doctor security check');
  print('  - CI lifecycle check');
  print('  - Obvious code issue scan');
  print('  - Pending D1 migration check');
  print('  - Build and Wrangler deploy');
  print('  - dist cleanup');
  print('');
  print('  What it does NOT do:');
  print('  - lifecycle:dry-run');
  print('  - Modify Wrangler secrets');
  print('  - Delete R2 objects');
  print('  - Auto commit/push/tag');
  print('  - git add .');
  print('  - Setup initialize');
  print('  - SSH/VPS operations');
  print('  - Build EXE/APK/IPA');
  print('');

  // 1. Git checks
  print('--- Step 1: Git checks ---');
  summary.branch = '';
  summary.head = '';
  summary.originSynced = '';

  const branchResult = capture('git', ['branch', '--show-current']);
  if (!branchResult.ok) fail('Not a git repository');
  const branch = branchResult.stdout.trim();
  summary.branch = branch;
  print(`Current branch: ${branch}`);

  if (branch !== 'main') fail(`Current branch is "${branch}", not "main". Switch to main first.`);

  const statusResult = capture('git', ['status', '--short']);
  if (!statusResult.ok) fail('Could not read git status');
  if (statusResult.stdout.trim().length > 0) {
    print('Working tree has uncommitted changes:');
    print(statusResult.stdout.trim());
    fail('Working tree is not clean. Commit or stash changes first.');
  }
  print('Working tree: clean');

  const logResult = capture('git', ['log', '-1', '--oneline']);
  summary.head = logResult.stdout.trim();
  print(`HEAD: ${summary.head}`);

  print('Fetching origin/main...');
  const fetchResult = capture('git', ['fetch', 'origin', 'main']);
  if (!fetchResult.ok) fail('Could not fetch origin/main. Check your network or git remote.');

  const syncResult = capture('git', ['status', '-sb']);
  const syncOutput = syncResult.stdout.trim();
  summary.originSynced = true;
  if (syncOutput.includes('behind')) {
    summary.originSynced = false;
    fail('Local main is behind origin/main. Pull latest changes first.');
  }
  if (syncOutput.includes('ahead')) {
    summary.originSynced = false;
    fail('Local main is ahead of origin/main. Push or reset first.');
  }
  print('Origin synced: yes');
  print('');

  // 2. Package script checks
  print('--- Step 2: Package script validation ---');
  const requiredScripts = ['typecheck', 'doctor', 'lifecycle:ci-check', 'build', 'deploy', 'check:obvious'];
  for (const script of requiredScripts) checkScriptExists(script);
  print('All required scripts exist: typecheck, doctor, lifecycle:ci-check, build, deploy, check:obvious');
  print('');

  // 3. Run obvious code issues check
  print('--- Step 3: Obvious code issues check ---');
  summary.checkObvious = '';
  const obviousResult = run(npmCmd, ['run', 'check:obvious']);
  if (!obviousResult.ok) fail('Obvious code issues found. Fix them and rerun.');
  summary.checkObvious = 'PASS';
  print('');

  // 4. Run existing checks
  print('--- Step 4: Running existing checks ---');

  // check-chat-message-text
  summary.checkChatMessageText = '';
  const chatMsgScript = path.join(root, 'scripts', 'check-chat-message-text.mjs');
  if (existsSync(chatMsgScript)) {
    print('Running check-chat-message-text...');
    const chatResult = run('node', ['scripts/check-chat-message-text.mjs']);
    if (!chatResult.ok) fail('check-chat-message-text failed.');
    summary.checkChatMessageText = 'PASS';
  } else {
    summary.checkChatMessageText = 'SKIP (not found)';
  }

  // check-session-lifecycle
  summary.checkSessionLifecycle = '';
  const sessionLifecycleScript = path.join(root, 'scripts', 'check-session-lifecycle.mjs');
  if (existsSync(sessionLifecycleScript)) {
    print('Running check-session-lifecycle...');
    const sessionResult = run('node', ['scripts/check-session-lifecycle.mjs']);
    if (!sessionResult.ok) fail('check-session-lifecycle failed.');
    summary.checkSessionLifecycle = 'PASS';
  } else {
    summary.checkSessionLifecycle = 'SKIP (not found)';
  }

  // typecheck
  print('Running typecheck...');
  summary.typecheck = '';
  const tcResult = run(npmCmd, ['run', 'typecheck']);
  if (!tcResult.ok) fail('Typecheck failed. Fix TypeScript errors and rerun.');
  summary.typecheck = 'PASS';
  print('');

  // doctor
  print('Running doctor...');
  summary.doctor = '';
  const docResult = run(npmCmd, ['run', 'doctor']);
  if (!docResult.ok) fail('Doctor check failed. Resolve issues and rerun.');
  summary.doctor = 'PASS';
  print('');

  // lifecycle:ci-check
  print('Running lifecycle:ci-check...');
  summary.lifecycleCiCheck = '';
  const ciResult = run(npmCmd, ['run', 'lifecycle:ci-check']);
  if (!ciResult.ok) fail('Lifecycle CI check failed. Resolve issues and rerun.');
  summary.lifecycleCiCheck = 'PASS';
  print('');

  // 5. Check pending D1 migrations
  print('--- Step 5: Checking pending D1 migrations ---');
  summary.pendingMigrations = '';
  summary.migrationsApplied = '';

  const wranglerBin = path.join(root, 'node_modules', '.bin', `wrangler${isWin ? '.cmd' : ''}`);
  const wranglerCmd = existsSync(wranglerBin) ? wranglerBin : npxCmd;
  const wranglerArgs = existsSync(wranglerBin) ? [] : ['wrangler'];

  const migListCmd = existsSync(wranglerBin) ? [wranglerBin] : [npxCmd];
  const migListArgs = existsSync(wranglerBin) ? ['d1', 'migrations', 'list', 'customer_chat_db', '--remote'] : ['wrangler', 'd1', 'migrations', 'list', 'customer_chat_db', '--remote'];

  print('Checking pending migrations...');
  const migResult = capture(migListCmd[0], migListArgs.slice(1), { ignoreError: true });
  let pendingMigs = [];

  if (migResult.ok) {
    const lines = migResult.stdout.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes('No migrations')) {
        break;
      }
      if (line.includes('pending') || line.includes('not yet applied')) {
        pendingMigs.push(line.trim());
      }
    }
  } else {
    print('Warning: Could not list remote D1 migrations. Continuing but be aware there may be pending migrations.');
  }

  if (pendingMigs.length > 0) {
    summary.pendingMigrations = pendingMigs.join(', ');
    print(`Pending migrations detected:`);
    for (const mig of pendingMigs) print(`  - ${mig}`);

    if (!applyMigrations) {
      fail(
        `Pending D1 remote migrations detected.\n` +
        `Run with --apply-migrations to allow migration:\n` +
        `  ${npmCmd} run deploy:safe -- --apply-migrations`
      );
    }

    print('');
    print('WARNING: You are about to apply pending D1 remote migrations.');
    print('This will WRITE to the remote D1 database.');
    print('');

    const answer = awaitAsk('Type exactly "APPLY REMOTE D1 MIGRATIONS" to confirm: ');
    if (answer.trim() !== 'APPLY REMOTE D1 MIGRATIONS') {
      fail('Confirmation text did not match. Aborting.');
    }

    print('Applying pending migrations...');
    const applyCmd = existsSync(wranglerBin) ? wranglerBin : npxCmd;
    const applyArgs = existsSync(wranglerBin)
      ? ['d1', 'migrations', 'apply', 'customer_chat_db', '--remote']
      : ['wrangler', 'd1', 'migrations', 'apply', 'customer_chat_db', '--remote'];
    const applyResult = run(applyCmd, applyArgs);
    if (!applyResult.ok) fail('D1 migration apply failed.');
    summary.migrationsApplied = 'YES';
    print('Migrations applied successfully.');
  } else {
    summary.pendingMigrations = 'none';
    summary.migrationsApplied = 'N/A';
    print('No pending migrations. Safe to proceed.');
  }
  print('');

  // 6. Build
  print('--- Step 6: Build ---');
  summary.build = '';
  print('Running build...');
  const buildResult = run(npmCmd, ['run', 'build']);
  if (!buildResult.ok) fail('Build failed.');
  summary.build = 'PASS';
  print('');

  // 7. Deploy
  print('--- Step 7: Deploy ---');
  summary.deploy = '';
  summary.cloudflareVersionId = '';
  print('Running deploy...');
  const deployResult = capture('npx.cmd', ['wrangler', 'deploy']);
  if (!deployResult.ok) fail('Deploy failed.');
  summary.deploy = 'PASS';

  const versionMatch = deployResult.stdout.match(/version_id\s*=\s*['"]([^'"]+)['"]/i) || deployResult.stdout.match(/Version\s*ID:\s*(\S+)/i) || deployResult.stdout.match(/versionId\s*:\s*['"]([^'"]+)['"]/i);
  summary.cloudflareVersionId = versionMatch ? versionMatch[1] : '(see deploy output)';
  print('');

  // 8. Cleanup dist
  print('--- Step 8: dist cleanup ---');
  summary.distCleanup = '';
  print('Cleaning dist...');

  const checkoutResult = run('git', ['checkout', '--', 'dist'], { ignoreError: true });
  const cleanResult = run('git', ['clean', '-fd', '--', 'dist'], { ignoreError: true });

  const finalStatus = capture('git', ['status', '-sb']);
  summary.finalGitStatus = finalStatus.stdout.trim();

  if (checkoutResult.ok && cleanResult.ok) {
    summary.distCleanup = 'PASS';
    print('dist cleaned.');
  } else {
    summary.distCleanup = 'WARN (see output)';
  }
  print('');

  // 9. Summary
  print('========================================');
  print('  Safe Cloudflare Deploy Summary');
  print('========================================');
  print(`  branch:                           ${summary.branch}`);
  print(`  head:                             ${summary.head}`);
  print(`  origin synced:                    ${summary.originSynced ? 'yes' : 'no'}`);
  print(`  check:obvious:                    ${summary.checkObvious}`);
  print(`  check-chat-message-text:          ${summary.checkChatMessageText}`);
  print(`  check-session-lifecycle:          ${summary.checkSessionLifecycle}`);
  print(`  typecheck:                        ${summary.typecheck}`);
  print(`  doctor:                           ${summary.doctor}`);
  print(`  lifecycle:ci-check:               ${summary.lifecycleCiCheck}`);
  print(`  pending migrations:               ${summary.pendingMigrations}`);
  print(`  migrations applied:               ${summary.migrationsApplied}`);
  print(`  build:                            ${summary.build}`);
  print(`  deploy:                           ${summary.deploy}`);
  print(`  cloudflare version id:            ${summary.cloudflareVersionId}`);
  print(`  dist cleanup:                     ${summary.distCleanup}`);
  print(`  final git status:                 ${summary.finalGitStatus}`);
  print('');

  if (summary.finalGitStatus.includes('??') || summary.finalGitStatus.includes(' M') || summary.finalGitStatus.includes('M ')) {
    print('WARNING: Final git status is not clean. dist may have leftover changes.');
  } else {
    print('Deployment completed successfully. Working tree is clean.');
  }
}

function awaitAsk(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, answer => { rl.close(); resolve(answer); }));
}

main();
