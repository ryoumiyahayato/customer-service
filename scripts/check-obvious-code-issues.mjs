#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
let passed = 0;
let failed = 0;
const results = [];

function check(name, ok) {
  if (ok) { passed++; results.push(`  PASS  ${name}`); }
  else { failed++; results.push(`  FAIL  ${name}`); }
}

function gitTracked(patterns) {
  try {
    const output = execFileSync('git', ['ls-files', '--', ...patterns], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!output) return [];
    return output.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function readTrackedFiles(patterns) {
  const files = gitTracked(patterns);
  const result = [];
  for (const file of files) {
    const full = path.join(root, file);
    try {
      result.push({ path: file, content: readFileSync(full, 'utf8') });
    } catch { /* skip unreadable */ }
  }
  return result;
}

const srcFiles = () => readTrackedFiles(['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx']);
const deployCodeFiles = () => readTrackedFiles(['scripts/deploy-cloudflare-safe.mjs']);
const trackedAll = () => {
  const all = gitTracked(['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx', 'docs/**/*.md', 'docs/**/*.txt', '*.toml', '*.json', '*.js', '*.mjs', '*.ts', 'scripts/**/*.mjs', 'deploy/**/*.ts', 'deploy/**/*.mjs', 'deploy/**/*.js', 'lib/**/*.ts', 'app/**/*.ts', 'server-generic/**/*.ts']);
  const result = [];
  for (const file of all) {
    const full = path.join(root, file);
    try {
      result.push({ path: file, content: readFileSync(full, 'utf8') });
    } catch { /* skip */ }
  }
  return result;
};

function checkMergeConflictMarkers() {
  const files = trackedAll();
  let conflictCount = 0;
  for (const { path: filePath, content } of files) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      const isCSSDecorativeBorder = /^\/\*\s*=+\s+\w+\s+=+\s*\*\/$/.test(trimmed);
      if (isCSSDecorativeBorder) continue;

      if (trimmed === '=======') {
        conflictCount++;
        results.push(`  FAIL  Merge conflict marker (=======) in ${filePath}:${i + 1}`);
        break;
      }
      if (/^<{7,}\s/.test(trimmed) || /^>{7,}\s/.test(trimmed)) {
        conflictCount++;
        results.push(`  FAIL  Merge conflict marker (<<<<<<</>>>>>>) in ${filePath}:${i + 1}`);
        break;
      }
    }
  }
  check('No merge conflict markers (<<<<<<<, =======, >>>>>>>)', conflictCount === 0);
}

function checkDebugStatements() {
  const files = srcFiles();
  let issueCount = 0;
  for (const { path: filePath, content } of files) {
    const lines = content.split(/\r?\n/);
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      if (inBlockComment) {
        if (raw.includes('*/')) inBlockComment = false;
        continue;
      }
      if (raw.includes('/*') && raw.includes('*/')) continue;
      if (raw.includes('/*')) { inBlockComment = true; continue; }

      const stripped = raw.replace(/\/\/.*$/, '').trim();
      if (stripped === 'debugger' || stripped.includes('debugger;')) {
        issueCount++;
        results.push(`  FAIL  debugger; in ${filePath}:${i + 1}`);
      }
      if (stripped.includes('alert(')) {
        issueCount++;
        results.push(`  FAIL  alert( in ${filePath}:${i + 1}`);
      }
      if (stripped.includes('prompt(')) {
        issueCount++;
        results.push(`  FAIL  prompt( in ${filePath}:${i + 1}`);
      }
      if (stripped.includes('TODO_DEPLOY_BLOCKER') || stripped.includes('FIXME_DEPLOY_BLOCKER')) {
        issueCount++;
        results.push(`  FAIL  ${stripped.includes('TODO_DEPLOY_BLOCKER') ? 'TODO_DEPLOY_BLOCKER' : 'FIXME_DEPLOY_BLOCKER'} in ${filePath}:${i + 1}`);
      }
      const throwMatch = stripped.match(/throw\s+new\s+Error\s*\(\s*["']TODO["']\s*\)/);
      if (throwMatch) {
        issueCount++;
        results.push(`  FAIL  throw new Error("TODO") in ${filePath}:${i + 1}`);
      }
    }
  }
  check('No debugger/alert/prompt/TODO_DEPLOY_BLOCKER/FIXME_DEPLOY_BLOCKER/throw new Error("TODO")', issueCount === 0);
}

function checkDangerousHtmlInjection() {
  const files = srcFiles();
  const allowedFiles = new Set([]);
  let issueCount = 0;
  for (const { path: filePath, content } of files) {
    if (allowedFiles.has(filePath)) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, '').trim();
      if (stripped.includes('dangerouslySetInnerHTML') || stripped.includes('innerHTML =') || stripped.includes('innerHTML=')) {
        issueCount++;
        results.push(`  FAIL  dangerouslySetInnerHTML/innerHTML in ${filePath}:${i + 1}`);
      }
    }
  }
  check('No dangerous HTML injection (dangerouslySetInnerHTML, innerHTML =)', issueCount === 0);
}

function checkSensitiveInfoHardcoded() {
  const files = trackedAll();
  const ALLOWED_PATHS = new Set([
    'deploy/desktop-client/src/smoke.ts',
    'deploy/windows-wizard/src/smoke.ts',
  ]);
  let issueCount = 0;

  const privateKeyPatterns = [
    'BEGIN OPENSSH PRIVATE KEY',
    'BEGIN RSA PRIVATE KEY',
    'BEGIN PRIVATE KEY',
  ];
  const placeholderValues = new Set(['change-me', '<placeholder>', 'placeholder', 'your-secret', 'your-password', 'YOUR_SECRET', 'your-encryption-key', 'your-session-secret', 'your-setup-token', 'sample', 'sample-key', 'sample-secret', 'sample-password', 'sample-token']);

  for (const { path: filePath, content } of files) {
    if (ALLOWED_PATHS.has(filePath)) continue;
    if (filePath === 'package.json' || filePath === 'package-lock.json' || filePath === 'pnpm-lock.yaml') continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('-- ')) continue;

      for (const pattern of privateKeyPatterns) {
        if (line.includes(pattern)) {
          issueCount++;
          results.push(`  FAIL  Private key marker (${pattern}) in ${filePath}:${i + 1}`);
        }
      }

      const dbUrlMatch = line.match(/DATABASE_URL\s*=\s*([^\s"']+)/);
      if (dbUrlMatch) {
        const val = dbUrlMatch[1].replace(/^["']|["']$/g, '');
        if (!placeholderValues.has(val) && !val.startsWith('<') && !val.endsWith('>')) {
          issueCount++;
          results.push(`  FAIL  Possible hardcoded DATABASE_URL in ${filePath}:${i + 1}`);
        }
      }

      const sensitiveKeys = ['ENCRYPTION_KEY', 'SESSION_SECRET', 'SETUP_TOKEN', 'CLOUDFLARE_API_TOKEN'];
      for (const key of sensitiveKeys) {
        const regex = new RegExp(`${key}\\s*=\\s*(\\S+)`);
        const match = line.match(regex);
        if (match) {
          const val = match[1].replace(/^["']|["']$/g, '');
          if (val.length > 3 && !placeholderValues.has(val)) {
            issueCount++;
            results.push(`  FAIL  Possible hardcoded ${key} in ${filePath}:${i + 1}`);
          }
        }
      }
    }
  }
  check('No hardcoded private keys, database URLs, or sensitive secrets', issueCount === 0);
}

function checkHighRiskCommandsInDeployScripts() {
  let issueCount = 0;
  const files = deployCodeFiles();

  const dangerousPatterns = [
    { pattern: /\blifecycle:dry-run\b/, name: 'lifecycle:dry-run' },
    { pattern: /wrangler\s+d1\s+execute\b/, name: 'wrangler d1 execute' },
    { pattern: /wrangler\s+secret\s+(put|delete|list)\b/, name: 'wrangler secret' },
    { pattern: /r2\s+object\s+delete\b/, name: 'r2 object delete' },
    { pattern: /git\s+add\s+\.\s*($|")/, name: 'git add .' },
    { pattern: /git\s+push\s+--force\b/, name: 'git push --force' },
    { pattern: /setup\s+initialize\b/, name: 'setup initialize' },
  ];

  for (const { path: filePath, content } of files) {
    if (filePath === 'package.json') continue;
    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(content)) {
        issueCount++;
        results.push(`  FAIL  Dangerous command "${name}" found in ${filePath}`);
      }
    }

    if (/git\s+clean\s+-fd\s*$/.test(content)) {
      issueCount++;
      results.push(`  FAIL  Unqualified git clean -fd (without -- dist target) in ${filePath}`);
    }
    if (/git\s+clean\s+-fd\s+(?!--\s*dist)/.test(content)) {
      const hasSafeClean = /git\s+clean\s+-fd\s+--\s*dist/.test(content);
      if (!hasSafeClean) {
        issueCount++;
        results.push(`  FAIL  git clean -fd without -- dist target in ${filePath}`);
      }
    }
  }

  check('No high-risk commands in deploy scripts', issueCount === 0);
}

function checkSecurityLogicDegradation() {
  const workerFile = path.join(root, 'src', 'worker.ts');
  let issueCount = 0;

  if (existsSync(workerFile)) {
    const content = readFileSync(workerFile, 'utf8');

    if (!content.includes('UPLOADS.get') && !content.includes('env.UPLOADS.get')) {
      issueCount++;
      results.push(`  FAIL  src/worker.ts missing UPLOADS.get (attachment download logic)`);
    } else {
      if (content.includes('function downloadAttachment')) {
        const downloadFnMatch = content.match(/async function downloadAttachment[\s\S]*?^}/m);
        if (downloadFnMatch) {
          const fnBody = downloadFnMatch[0];
          const hasAuthCall = fnBody.includes('canDownloadAttachment');
          const hasGetCall = fnBody.includes('UPLOADS.get') || fnBody.includes('env.UPLOADS.get');
          if (!hasAuthCall || !hasGetCall) {
            issueCount++;
            results.push(`  FAIL  UPLOADS.get in downloadAttachment may lack auth/permission check`);
          }
        }
      }
    }
  }

  const lifecycleCiPath = path.join(root, 'scripts', 'lifecycle-ci-check.mjs');
  if (existsSync(lifecycleCiPath)) {
    const ciContent = readFileSync(lifecycleCiPath, 'utf8');
    if (!ciContent.includes('cloudflareAccessed: false') || !ciContent.includes('d1Accessed: false')) {
      issueCount++;
      results.push(`  FAIL  lifecycle:ci-check should declare cloudflareAccessed: false and d1Accessed: false`);
    }
  }

  const guestChatFile = path.join(root, 'src', 'visitor', 'GuestChat.tsx');
  if (existsSync(guestChatFile)) {
    const guestContent = readFileSync(guestChatFile, 'utf8');
    const decodedRecall = '\u64a4\u56de';
    const decodedDelete = '\u5220\u9664';
    if (guestContent.includes(`label: '${decodedRecall}'`)) {
      issueCount++;
      results.push(`  FAIL  visitor menu should not contain recall`);
    }
    if (guestContent.includes(`label: '${decodedDelete}'`)) {
      issueCount++;
      results.push(`  FAIL  visitor menu should not contain delete`);
    }
  }

  const chatMessageTextFile = path.join(root, 'src', 'ChatMessageText.tsx');
  if (existsSync(chatMessageTextFile)) {
    const chatContent = readFileSync(chatMessageTextFile, 'utf8');
    if (chatContent.includes('dangerouslySetInnerHTML') || chatContent.includes('innerHTML')) {
      issueCount++;
      results.push(`  FAIL  ChatMessageText should not use innerHTML/dangerouslySetInnerHTML`);
    }
    if (!chatContent.includes('target="_blank"') || !chatContent.includes('rel="noopener noreferrer"')) {
      issueCount++;
      results.push(`  FAIL  ChatMessageText link should use target="_blank" and rel="noopener noreferrer"`);
    }
  }

  check('Key security logic not degraded', issueCount === 0);
}

function checkSetupTokenFailClosed() {
  const workerFile = path.join(root, 'src', 'worker.ts');
  if (!existsSync(workerFile)) return;
  const content = readFileSync(workerFile, 'utf8');
  let issueCount = 0;

  if (!content.includes('SETUP_TOKEN')) {
    issueCount++;
    results.push(`  FAIL  src/worker.ts should reference SETUP_TOKEN`);
  }
  if (!content.includes('/api/setup/status')) {
    issueCount++;
    results.push(`  FAIL  src/worker.ts should have /api/setup/status endpoint`);
  }
  if (content.includes('missing_setup_token') || content.includes('setupTokenRequired')) {
    check('setup token fail-closed logic present', true);
  } else {
    issueCount++;
    results.push(`  FAIL  src/worker.ts missing setup token fail-closed logic`);
    check('setup token fail-closed logic present', false);
    return;
  }
  check('setup token fail-closed logic present', issueCount === 0);
}

function run() {
  console.log('Checking obvious code issues...\n');

  checkMergeConflictMarkers();
  checkDebugStatements();
  checkDangerousHtmlInjection();
  checkSensitiveInfoHardcoded();
  checkHighRiskCommandsInDeployScripts();
  checkSecurityLogicDegradation();
  checkSetupTokenFailClosed();

  console.log(`\nObvious Code Issue Check Results:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log('');
  results.forEach(r => console.log(r));
  console.log('');

  if (failed > 0) {
    console.error('Some obvious code issues found. Fix them before deployment.');
    process.exit(1);
  }
  console.log('All obvious code issue checks passed.');
}

run();
