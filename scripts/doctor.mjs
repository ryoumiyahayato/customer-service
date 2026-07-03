#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import tls from 'node:tls';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', '.wrangler', '.wrangler-dry-run']);
const statuses = [];
const runOnline = process.argv.includes('--online');
const publicRequestHeaders = {
  'user-agent': 'support-chat-doctor/1.0',
};
const responseLeakKeywords = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_TOKEN',
  'CF_API_KEY',
  'SESSION_SECRET',
  'Authorization',
  'private key',
];

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function result(code, status, severity, message, suggestion) {
  statuses.push({ code, status, severity, message, suggestion });
}

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function gitTracked(patterns) {
  const output = runGit(['ls-files', '--', ...patterns]);
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readTextIfExists(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

function walkFiles(startDir) {
  const files = [];
  if (!existsSync(startDir)) return files;
  const stack = [startDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(full);
        continue;
      }
      if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function keywordHits(files, keywords) {
  const hits = [];
  for (const file of files) {
    let text = '';
    try {
      const stat = statSync(file);
      if (stat.size > 10 * 1024 * 1024) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const matched = [];
    for (const keyword of keywords) {
      const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (pattern.test(text)) matched.push(keyword);
    }
    if (matched.length) hits.push({ file: rel(file), keywords: matched });
  }
  return hits;
}

function matchedKeywords(text, keywords) {
  return keywords.filter((keyword) => {
    const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return pattern.test(text);
  });
}

function hasAll(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

function setupTokenKey() {
  return ['SETUP', 'TOKEN'].join('_');
}

function frontendSourceFiles() {
  return walkFiles(path.join(root, 'src')).filter((file) => {
    const name = rel(file);
    if (name === 'src/worker.ts') return false;
    if (name.startsWith('src/durable-objects/')) return false;
    return /\.(?:tsx?|jsx?)$/.test(name);
  });
}

function hasHsts(response) {
  return Boolean(response.headers.get('strict-transport-security'));
}

function isReactSpa(text) {
  return /<div\s+id=["']root["']/i.test(text) || /\/assets\/index-[A-Za-z0-9_-]+\.(js|css)/i.test(text);
}

async function fetchPublic(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs || 10000);
  try {
    return await fetch(url, {
      method: init.method || 'GET',
      redirect: init.redirect || 'manual',
      headers: { ...publicRequestHeaders, ...(init.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyForChecks(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function failFetch(code, error, suggestion) {
  const message = error?.name === 'AbortError' ? 'Request timed out.' : 'Request failed.';
  result(code, 'fail', 'high', message, suggestion);
}

function checkGitStatus() {
  const output = runGit(['status', '--porcelain']);
  if (output === null) {
    result('git.status.clean', 'warn', 'medium', 'Git status could not be read.', 'Run this command inside a Git working tree.');
    return;
  }
  if (!output) {
    result('git.status.clean', 'pass', 'info', 'Working tree is clean.', 'No action required.');
    return;
  }
  const files = output.split(/\r?\n/).map((line) => {
    if (line.startsWith('?? ') || line[2] === ' ') return line.slice(3).trim();
    return line.slice(2).trim();
  }).filter(Boolean);
  result('git.status.clean', 'warn', 'medium', `Working tree has uncommitted changes in ${files.length} file(s): ${files.join(', ')}.`, 'Commit or discard unrelated changes before packaging or deployment.');
}

function checkTrackedFile(code, file, severity = 'critical') {
  const tracked = gitTracked([file]);
  if (tracked.length) {
    result(code, 'fail', severity, `${file} is tracked by Git.`, `Remove ${file} from Git and keep it local only.`);
    return;
  }
  result(code, 'pass', 'info', `${file} is not tracked by Git.`, 'No action required.');
}

function checkDistExists() {
  if (existsSync(path.join(root, 'dist'))) {
    result('dist.exists', 'pass', 'info', 'dist exists.', 'Run the dist secret scan before publishing artifacts.');
    return;
  }
  result('dist.exists', 'warn', 'low', 'dist does not exist.', 'Run npm run build before deployment or package validation.');
}

function checkDistSecrets() {
  const distDir = path.join(root, 'dist');
  const keywords = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'Bearer',
    'SESSION_SECRET',
    'Authorization',
    'private key',
  ];

  if (!existsSync(distDir)) {
    result('dist.secret_scan', 'warn', 'low', 'dist does not exist, so no dist secret scan was run.', 'Run npm run build and then rerun doctor.');
    return;
  }

  const hits = keywordHits(walkFiles(distDir), keywords);
  if (!hits.length) {
    result('dist.secret_scan', 'pass', 'high', 'No high-risk keywords were found in dist.', 'Keep running this check before deployment.');
    return;
  }

  const detail = hits.map((hit) => `${hit.file}: ${hit.keywords.join(', ')}`).join('; ');
  result('dist.secret_scan', 'fail', 'high', `High-risk keyword(s) found in dist: ${detail}.`, 'Remove secrets from the build input, rebuild dist, and rerun doctor.');
}

function checkWranglerSecrets() {
  const file = path.join(root, 'wrangler.toml');
  const text = readTextIfExists(file);
  if (text === null) {
    result('wrangler.secret_scan', 'warn', 'medium', 'wrangler.toml is missing.', 'Cloudflare deployments should include a reviewed wrangler.toml.');
    return;
  }

  const riskyNames = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'SESSION_SECRET',
    'SUPER_ADMIN_PASSWORD',
    'ADMIN_PASSWORD',
    'AUTH_SECRET',
    'PRIVATE_KEY',
    'ENCRYPTION_KEY',
  ];
  const riskyValuePattern = /(token|secret|password|private[_-]?key|authorization)\s*=\s*["'][^"']{8,}["']/i;
  const matchedNames = riskyNames.filter((name) => new RegExp(name, 'i').test(text));
  const hasRiskyValue = riskyValuePattern.test(text);

  if (matchedNames.length || hasRiskyValue) {
    const parts = [];
    if (matchedNames.length) parts.push(`keyword(s): ${matchedNames.join(', ')}`);
    if (hasRiskyValue) parts.push('secret-like assignment');
    result('wrangler.secret_scan', 'fail', 'high', `wrangler.toml contains possible secret material (${parts.join('; ')}).`, 'Move secrets to Wrangler secrets and keep only public vars or bindings in wrangler.toml.');
    return;
  }

  result('wrangler.secret_scan', 'pass', 'high', 'No secret-like values were found in wrangler.toml.', 'Keep runtime secrets in Wrangler secrets.');
}

function checkPackageScripts() {
  const file = path.join(root, 'package.json');
  const text = readTextIfExists(file);
  if (text === null) {
    result('package.scripts.required', 'fail', 'high', 'package.json is missing.', 'Restore package.json with required scripts.');
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    result('package.scripts.required', 'fail', 'high', 'package.json could not be parsed.', 'Fix package.json syntax.');
    return;
  }

  const scripts = pkg.scripts || {};
  const required = ['typecheck', 'build', 'deploy'];
  const missing = required.filter((name) => !scripts[name]);
  if (missing.length) {
    result('package.scripts.required', 'fail', 'medium', `Missing package script(s): ${missing.join(', ')}.`, 'Add the missing scripts before release packaging.');
    return;
  }
  result('package.scripts.required', 'pass', 'info', 'Required package scripts exist: typecheck, build, deploy.', 'No action required.');
}

function checkFileExists(code, file, severity = 'medium') {
  if (existsSync(path.join(root, file))) {
    result(code, 'pass', 'info', `${file} exists.`, 'No action required.');
    return;
  }
  result(code, 'fail', severity, `${file} is missing.`, `Add ${file}.`);
}

function checkLifecycleTriggerConfig() {
  const text = readTextIfExists(path.join(root, 'wrangler.toml'));
  if (text === null) {
    result('lifecycle.trigger_config', 'fail', 'high', 'wrangler.toml is missing, so lifecycle cron configuration could not be checked.', 'Add [triggers] crons = ["0 * * * *"] to wrangler.toml.');
    return;
  }

  const configured = /^\s*\[triggers\]\s*$(?:\r?\n(?!\s*\[)[^\r\n]*)*?\r?\n\s*crons\s*=\s*\[\s*"0 \* \* \* \*"\s*\]\s*$/m.test(text);
  if (configured) {
    result('lifecycle.trigger_config', 'pass', 'info', 'Lifecycle cron trigger is configured for hourly execution.', 'No action required.');
    return;
  }

  result('lifecycle.trigger_config', 'fail', 'high', 'Lifecycle cron trigger is missing or not configured as crons = ["0 * * * *"].', 'Add [triggers] crons = ["0 * * * *"] to wrangler.toml.');
}

function checkLifecycleDryRunScript() {
  const file = path.join(root, 'package.json');
  const text = readTextIfExists(file);
  if (text === null) {
    result('lifecycle.dry_run_script', 'fail', 'high', 'package.json is missing, so lifecycle:dry-run could not be checked.', 'Restore package.json with a lifecycle:dry-run script.');
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    result('lifecycle.dry_run_script', 'fail', 'high', 'package.json could not be parsed, so lifecycle:dry-run could not be checked.', 'Fix package.json syntax.');
    return;
  }

  const hasPackageScript = Boolean(pkg.scripts?.['lifecycle:dry-run']);
  const hasScriptFile = existsSync(path.join(root, 'scripts/lifecycle-dry-run.mjs'));
  if (hasPackageScript && hasScriptFile) {
    result('lifecycle.dry_run_script', 'pass', 'info', 'Lifecycle dry-run package script and script file exist.', 'No action required.');
    return;
  }

  const missing = [];
  if (!hasPackageScript) missing.push('package script lifecycle:dry-run');
  if (!hasScriptFile) missing.push('scripts/lifecycle-dry-run.mjs');
  result('lifecycle.dry_run_script', 'fail', 'high', `Missing lifecycle dry-run requirement(s): ${missing.join(', ')}.`, 'Add the lifecycle dry-run script before relying on lifecycle automation checks.');
}

function checkLifecycleMigrationFields() {
  const file = 'migrations/0008_session_lifecycle_fields.sql';
  if (existsSync(path.join(root, file))) {
    result('lifecycle.migration_fields', 'pass', 'info', `${file} exists.`, 'No action required.');
    return;
  }

  result('lifecycle.migration_fields', 'fail', 'high', `${file} is missing.`, 'Add the lifecycle fields migration file before enabling lifecycle automation.');
}

function checkLifecycleScheduledHandler() {
  const text = readTextIfExists(path.join(root, 'src/worker.ts'));
  if (text === null) {
    result('lifecycle.scheduled_handler', 'fail', 'high', 'src/worker.ts is missing, so the scheduled handler could not be checked.', 'Restore the Worker entrypoint with a scheduled handler.');
    return;
  }

  if (/\basync\s+scheduled\s*\(/.test(text) || /\bscheduled\s*\([^)]*\)\s*\{/.test(text)) {
    result('lifecycle.scheduled_handler', 'pass', 'info', 'Worker scheduled handler exists.', 'No action required.');
    return;
  }

  result('lifecycle.scheduled_handler', 'fail', 'high', 'Worker scheduled handler is missing.', 'Add a scheduled handler before relying on lifecycle cron automation.');
}

function checkLifecycleAutomation() {
  checkLifecycleTriggerConfig();
  checkLifecycleDryRunScript();
  checkLifecycleMigrationFields();
  checkLifecycleScheduledHandler();
}

function checkSetupBackendApi() {
  const text = readTextIfExists(path.join(root, 'src/worker.ts'));
  if (text === null) {
    result('setup.backend_api', 'fail', 'high', 'src/worker.ts is missing, so setup API static checks could not run.', 'Restore the Worker entrypoint with the setup API implementation.');
    return;
  }

  const requirements = [
    { name: 'status endpoint', ok: text.includes('/api/setup/status') },
    { name: 'initialize endpoint', ok: text.includes('/api/setup/initialize') },
    { name: 'runtime setup token env access', ok: new RegExp(`\\b${setupTokenKey()}\\b`).test(text) },
    { name: 'existing admin disables setup', ok: hasAll(text, [/\bhasAnyAdmin\b/, /already_configured/]) },
    { name: 'missing production setup token is rejected', ok: hasAll(text, [/\bsetupTokenRequired\b/, /missing_setup_token/]) },
  ];
  const missing = requirements.filter((item) => !item.ok).map((item) => item.name);
  if (!missing.length) {
    result('setup.backend_api', 'pass', 'high', 'Setup API endpoints and guard structures are present in the Worker.', 'No action required.');
    return;
  }

  result('setup.backend_api', 'fail', 'high', `Setup API static check is missing: ${missing.join(', ')}.`, 'Restore the setup status and initialize endpoints with admin-exists and setup-token guards.');
}

function checkSetupFrontendRoute() {
  const routing = readTextIfExists(path.join(root, 'src/routing.ts'));
  const app = readTextIfExists(path.join(root, 'src/App.tsx'));
  const pkgText = readTextIfExists(path.join(root, 'package.json'));
  if (routing === null || app === null || pkgText === null) {
    result('setup.frontend_route', 'fail', 'high', 'Frontend routing files or package.json are missing, so setup route static checks could not run.', 'Restore src/routing.ts, src/App.tsx, and package.json.');
    return;
  }

  let pkg = {};
  try {
    pkg = JSON.parse(pkgText);
  } catch {
    result('setup.frontend_route', 'fail', 'high', 'package.json could not be parsed during setup route checks.', 'Fix package.json syntax.');
    return;
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasNewRouterDependency = Object.keys(deps).some((name) => /^react-router(?:-dom)?$/.test(name));
  const requirements = [
    { name: 'setup mode or /setup route recognition', ok: /\bsetup\b/.test(routing) && /\/setup/.test(routing) },
    { name: 'SetupPage rendered for setup mode', ok: /SetupPage/.test(app) && /mode\.type\s*===\s*['"]setup['"]/.test(app) },
    { name: 'no router dependency introduced', ok: !hasNewRouterDependency },
  ];
  const missing = requirements.filter((item) => !item.ok).map((item) => item.name);
  if (!missing.length) {
    result('setup.frontend_route', 'pass', 'high', 'Setup frontend route is wired through the existing routing flow without a router dependency.', 'No action required.');
    return;
  }

  result('setup.frontend_route', 'fail', 'high', `Setup frontend route static check is missing: ${missing.join(', ')}.`, 'Wire /setup through the existing routing mode and avoid adding a router dependency.');
}

function checkSetupFrontendPage() {
  const text = readTextIfExists(path.join(root, 'src/admin/SetupPage.tsx'));
  if (text === null) {
    result('setup.frontend_page', 'fail', 'high', 'src/admin/SetupPage.tsx is missing.', 'Add the setup page component.');
    return;
  }

  const requirements = [
    { name: 'status request', ok: text.includes('/api/setup/status') },
    { name: 'initialize request', ok: text.includes('/api/setup/initialize') },
    { name: 'password field logic', ok: /\bpassword\b/.test(text) && /\bconfirmPassword\b/.test(text) && /\bsetupToken\b/.test(text) },
    { name: 'no automatic login call', ok: !/\/api\/auth\/login|\/api\/login/.test(text) },
    { name: 'login navigation after success', ok: /前往登录|next.*login|\/admin/.test(text) },
    { name: 'rotate or remove setup token prompt', ok: /删除|轮换/.test(text) && /getSetupTokenConfigName/.test(text) },
  ];
  const missing = requirements.filter((item) => !item.ok).map((item) => item.name);
  if (!missing.length) {
    result('setup.frontend_page', 'pass', 'high', 'Setup page requests status, submits only from the form, and shows safe completion guidance.', 'No action required.');
    return;
  }

  result('setup.frontend_page', 'fail', 'high', `Setup page static check is missing: ${missing.join(', ')}.`, 'Restore the setup form, safe status handling, and completion guidance.');
}

function checkSetupNoPlaintextSecret() {
  const key = setupTokenKey();
  const wrangler = readTextIfExists(path.join(root, 'wrangler.toml'));
  if (wrangler === null) {
    result('setup.no_plaintext_secret', 'fail', 'high', 'wrangler.toml is missing, so setup secret placement could not be checked.', 'Restore wrangler.toml and keep setup initialization secrets in Wrangler secrets.');
    return;
  }

  const frontendFiles = frontendSourceFiles();
  const envReferenceHits = [];
  const hardcodedTokenHits = [];
  const hardcodedTokenPattern = /\b(?:setupToken|setup[_-]?token)\b\s*[:=]\s*['"][A-Za-z0-9_./+=-]{16,}['"]/i;
  for (const file of frontendFiles) {
    const text = readTextIfExists(file) || '';
    if (new RegExp(`import\\.meta\\.env\\.${key}\\b`).test(text)) envReferenceHits.push(rel(file));
    if (hardcodedTokenPattern.test(text)) hardcodedTokenHits.push(rel(file));
  }

  const issues = [];
  if (new RegExp(`\\b${key}\\b`).test(wrangler)) issues.push('wrangler.toml contains setup token configuration');
  if (envReferenceHits.length) issues.push(`frontend env reference in ${envReferenceHits.join(', ')}`);
  if (hardcodedTokenHits.length) issues.push(`possible hardcoded setup token in ${hardcodedTokenHits.join(', ')}`);

  if (!issues.length) {
    result('setup.no_plaintext_secret', 'pass', 'high', 'No plaintext setup initialization secret placement was found in wrangler.toml or frontend source files.', 'Use Wrangler secrets for setup initialization and keep frontend code free of setup secret values.');
    return;
  }

  result('setup.no_plaintext_secret', 'fail', 'high', `Plaintext setup secret risk found: ${issues.join('; ')}.`, 'Move setup initialization secrets to Wrangler secrets and do not expose them through frontend env variables.');
}

function checkSetupDistSecretScan() {
  const distDir = path.join(root, 'dist');
  const tracked = gitTracked(['dist']);
  if (!existsSync(distDir)) {
    result('setup.dist_secret_scan', 'warn', 'low', 'dist does not exist, so setup dist secret scan was skipped.', 'Run npm run build and rerun doctor before publishing artifacts.');
    return;
  }
  if (!tracked.length) {
    result('setup.dist_secret_scan', 'warn', 'low', 'dist is not tracked by Git, so setup dist secret scan was skipped for tracked artifacts.', 'Run npm run build and scan any published artifact directory.');
    return;
  }

  const files = walkFiles(distDir);
  const highRisk = [setupTokenKey(), 'password_hash', `import.meta.env.${setupTokenKey()}`];
  const counts = Object.fromEntries(highRisk.map((keyword) => [keyword, 0]));
  let setupTokenFieldNameFiles = 0;
  for (const file of files) {
    const text = readTextIfExists(file) || '';
    for (const keyword of highRisk) {
      if (text.includes(keyword)) counts[keyword] += 1;
    }
    if (text.includes('setupToken')) setupTokenFieldNameFiles += 1;
  }

  const failures = Object.entries(counts).filter(([, count]) => count > 0).map(([keyword, count]) => `${keyword} in ${count} file(s)`);
  if (!failures.length) {
    const suffix = setupTokenFieldNameFiles ? ` setupToken field name appears in ${setupTokenFieldNameFiles} file(s) and is treated as an API field name, not a secret value.` : '';
    result('setup.dist_secret_scan', 'pass', 'high', `No setup high-risk keywords were found in tracked dist artifacts.${suffix}`, 'Keep scanning built artifacts before publishing.');
    return;
  }

  result('setup.dist_secret_scan', 'fail', 'high', `Setup high-risk keyword(s) found in dist: ${failures.join(', ')}.`, 'Remove setup secret material from frontend inputs, rebuild dist, and rerun doctor.');
}

function checkSetupReadiness() {
  checkSetupBackendApi();
  checkSetupFrontendRoute();
  checkSetupFrontendPage();
  checkSetupNoPlaintextSecret();
  checkSetupDistSecretScan();
}

function checkGitignore() {
  const file = path.join(root, '.gitignore');
  const text = readTextIfExists(file);
  if (text === null) {
    result('gitignore.required_entries', 'fail', 'high', '.gitignore is missing.', 'Restore .gitignore with required secret and local-script exclusions.');
    return;
  }

  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  const required = ['.dev.vars', '.env.production', 'deploy.bat', 'deploy.local.bat', '*.local.bat'];
  const missing = required.filter((entry) => !lines.has(entry));
  if (missing.length) {
    result('gitignore.required_entries', 'fail', 'high', `.gitignore is missing required entr${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}.`, 'Add the missing ignore rules before packaging.');
    return;
  }
  result('gitignore.required_entries', 'pass', 'info', '.gitignore contains required secret and local-script entries.', 'No action required.');
}

async function checkHttpRedirect(code, sourceUrl, expectedLocation, options = {}) {
  try {
    const response = await fetchPublic(sourceUrl, { redirect: 'manual' });
    const body = await readBodyForChecks(response);
    const location = response.headers.get('location') || '';
    const statusOk = [301, 308].includes(response.status);
    const locationOk = location === expectedLocation;
    const spa = isReactSpa(body);

    if (statusOk && locationOk && !spa) {
      result(code, 'pass', 'high', `HTTP returned ${response.status} and redirected to the expected HTTPS URL.`, 'No action required.');
      return;
    }

    const issues = [];
    if (!statusOk) issues.push(`status ${response.status}`);
    if (!locationOk) issues.push('unexpected Location header');
    if (spa) issues.push('React SPA body');
    result(code, 'fail', 'high', `HTTP redirect check failed: ${issues.join(', ')}.`, options.suggestion || 'Ensure the Worker redirects HTTP to HTTPS before serving application assets.');
  } catch (error) {
    failFetch(code, error, options.suggestion || 'Verify the public HTTP endpoint is reachable.');
  }
}

async function checkHttpsStatusHsts(code, url, expectedStatuses, options = {}) {
  try {
    const response = await fetchPublic(url);
    const body = await readBodyForChecks(response);
    const statusOk = expectedStatuses.includes(response.status);
    const hstsOk = hasHsts(response);
    const spa = isReactSpa(body);
    const shouldRejectSpa = Boolean(options.rejectSpa);

    if (statusOk && hstsOk && (!shouldRejectSpa || !spa)) {
      result(code, 'pass', 'high', `HTTPS returned ${response.status} with HSTS.`, 'No action required.');
      return;
    }

    const issues = [];
    if (!statusOk) issues.push(`status ${response.status}`);
    if (!hstsOk) issues.push('missing HSTS');
    if (shouldRejectSpa && spa) issues.push('React SPA body');
    result(code, 'fail', 'high', `HTTPS boundary check failed: ${issues.join(', ')}.`, options.suggestion || 'Check Worker routing, host gate, and security headers.');
  } catch (error) {
    failFetch(code, error, options.suggestion || 'Verify the public HTTPS endpoint is reachable.');
  }
}

async function checkAuthMe() {
  const code = 'online.auth_me.unauthenticated';
  try {
    const response = await fetchPublic('https://denglu.kefuxitong.net/api/auth/me');
    const body = await readBodyForChecks(response);
    const leaks = matchedKeywords(body, responseLeakKeywords);
    const contentType = response.headers.get('content-type') || '';
    const acceptableStatus = response.status < 500;

    if (leaks.length) {
      result(code, 'fail', 'critical', `Unauthenticated auth check response contains high-risk keyword(s): ${leaks.join(', ')}.`, 'Remove sensitive data from unauthenticated API responses.');
      return;
    }

    if (!acceptableStatus) {
      result(code, 'fail', 'high', `/api/auth/me returned ${response.status} for an unauthenticated request.`, 'Return a safe unauthenticated response instead of a server error.');
      return;
    }

    if (contentType.includes('application/json')) {
      try {
        const parsed = body ? JSON.parse(body) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          result(code, 'pass', 'high', `/api/auth/me returned safe JSON with status ${response.status}.`, 'No action required.');
          return;
        }
        result(code, 'warn', 'medium', `/api/auth/me returned JSON with status ${response.status}, but the structure was not an object.`, 'Keep unauthenticated auth responses structured and minimal.');
        return;
      } catch {
        result(code, 'warn', 'medium', `/api/auth/me returned JSON content-type with invalid JSON and status ${response.status}.`, 'Return a small valid JSON object for unauthenticated auth checks.');
        return;
      }
    }

    result(code, 'warn', 'medium', `/api/auth/me returned ${response.status} without JSON content-type.`, 'Prefer a small JSON unauthenticated response.');
  } catch (error) {
    failFetch(code, error, 'Verify the public auth endpoint is reachable and does not require credentials for a safe me check.');
  }
}

function requestWsUpgrade(host, requestPath) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      ALPNProtocols: ['http/1.1'],
      timeout: 10000,
    });
    let data = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setEncoding('utf8');
    socket.on('secureConnect', () => {
      const request = [
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${host}`,
        'User-Agent: support-chat-doctor/1.0',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(request);
    });
    socket.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\r\n\r\n')) return;
      const statusLine = data.split(/\r?\n/, 1)[0] || '';
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/);
      finish({ status: match ? Number(match[1]) : 0 });
    });
    socket.on('timeout', () => fail(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    socket.on('error', fail);
  });
}

async function checkWsAdminUnauthenticated() {
  const code = 'online.ws_admin.unauthenticated';
  try {
    const response = await requestWsUpgrade('denglu.kefuxitong.net', '/api/ws/admin');
    if (response.status === 101) {
      result(code, 'fail', 'critical', 'Unauthenticated WebSocket upgrade returned 101.', 'Require authentication before upgrading admin WebSocket connections.');
      return;
    }
    if (response.status >= 500 || response.status === 0) {
      result(code, 'fail', 'high', `Unauthenticated WebSocket check returned ${response.status}.`, 'Reject unauthenticated WebSocket requests without server errors.');
      return;
    }
    result(code, 'pass', 'high', `Unauthenticated WebSocket upgrade was rejected with ${response.status}.`, 'No action required.');
  } catch (error) {
    failFetch(code, error, 'Verify the public admin WebSocket endpoint is reachable and rejects unauthenticated upgrades.');
  }
}

async function runOnlineChecks() {
  await checkHttpRedirect(
    'online.admin_http.redirect_https',
    'http://denglu.kefuxitong.net/',
    'https://denglu.kefuxitong.net/',
  );
  await checkHttpsStatusHsts(
    'online.admin_https.hsts',
    'https://denglu.kefuxitong.net/',
    [200],
    { suggestion: 'Ensure the backend host serves the admin shell over HTTPS with HSTS.' },
  );
  await checkHttpRedirect(
    'online.visitor_root_http.redirect_https',
    'http://vx9qn7zr.org/',
    'https://vx9qn7zr.org/',
    { suggestion: 'Redirect the visitor root domain before any SPA asset handling.' },
  );
  await checkHttpsStatusHsts(
    'online.visitor_root_https.not_found',
    'https://vx9qn7zr.org/',
    [404],
    { rejectSpa: true, suggestion: 'Keep the visitor root domain fail-closed with HSTS.' },
  );
  await checkHttpRedirect(
    'online.invalid_invite_http.redirect_https',
    'http://0000000000000000000000000000000000000000.vx9qn7zr.org/',
    'https://0000000000000000000000000000000000000000.vx9qn7zr.org/',
  );
  await checkHttpsStatusHsts(
    'online.invalid_invite_https.not_found',
    'https://0000000000000000000000000000000000000000.vx9qn7zr.org/',
    [404, 410],
    { rejectSpa: true, suggestion: 'Keep invalid invite hosts returning 404 or 410 with HSTS and no SPA body.' },
  );
  await checkAuthMe();
  await checkWsAdminUnauthenticated();
}

async function main() {
  checkGitStatus();
  checkTrackedFile('git.dev_vars.untracked', '.dev.vars');
  checkTrackedFile('git.env_production.untracked', '.env.production');
  checkTrackedFile('git.env_local.untracked', '.env.local', 'high');
  checkTrackedFile('git.deploy_bat.untracked', 'deploy.bat');
  checkTrackedFile('git.deploy_local_bat.untracked', 'deploy.local.bat');
  checkDistExists();
  checkDistSecrets();
  checkWranglerSecrets();
  checkPackageScripts();
  checkLifecycleAutomation();
  checkSetupReadiness();
  checkFileExists('docs.security_baseline.exists', 'docs/SECURITY_BASELINE.md');
  checkFileExists('docs.doctor_plan.exists', 'docs/DOCTOR_PLAN.md');
  checkFileExists('templates.deploy_example.exists', 'templates/deploy.example.bat');
  checkGitignore();

  if (runOnline) await runOnlineChecks();

  for (const item of statuses) console.log(JSON.stringify(item));

  const shouldFail = statuses.some((item) => item.status === 'fail' && ['high', 'critical'].includes(item.severity));
  process.exitCode = shouldFail ? 1 : 0;
}

main().catch((error) => {
  result('doctor.unhandled_error', 'fail', 'critical', error?.name === 'AbortError' ? 'Doctor timed out.' : 'Doctor failed unexpectedly.', 'Rerun doctor and inspect the local environment.');
  for (const item of statuses) console.log(JSON.stringify(item));
  process.exitCode = 1;
});
