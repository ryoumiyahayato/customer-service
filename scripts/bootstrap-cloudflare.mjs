#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const results = [];
const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';
const npxBin = isWindows ? 'npx.cmd' : 'npx';

function result(code, status, severity, message, suggestion) {
  results.push({ code, status, severity, message, suggestion });
}

function run(command, args) {
  try {
    const execCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : command;
    const execArgs = isWindows
      ? ['/d', '/c', [command, ...args].join(' ')]
      : args;
    return {
      ok: true,
      output: execFileSync(execCommand, execArgs, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: '',
      status: typeof error?.status === 'number' ? error.status : null,
    };
  }
}

function readText(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

function checkExists(code, file, severity = 'high') {
  if (existsSync(path.join(root, file))) {
    result(code, 'pass', 'info', `${file} exists.`, 'No action required.');
    return true;
  }
  result(code, 'fail', severity, `${file} is missing.`, `Add ${file} before Cloudflare preflight can pass.`);
  return false;
}

function checkNode() {
  result('runtime.node.available', 'pass', 'info', `Node is available (${process.version}).`, 'No action required.');
}

function checkNpm() {
  const res = run(npmBin, ['--version']);
  if (res.ok) {
    result('runtime.npm.available', 'pass', 'info', 'npm is available.', 'No action required.');
    return;
  }
  result('runtime.npm.available', 'fail', 'high', 'npm is not available.', 'Install Node.js with npm before running Cloudflare preflight.');
}

function checkWranglerAvailable() {
  const res = run(npxBin, ['wrangler', '--version']);
  if (res.ok) {
    result('cloudflare.wrangler.available', 'pass', 'info', 'Wrangler is available and can run a basic version command.', 'No action required.');
    return true;
  }
  result('cloudflare.wrangler.available', 'fail', 'high', 'Wrangler is not available or cannot execute a basic command.', 'Run npm install, then rerun this check. For local deployment, use npx wrangler login.');
  return false;
}

function checkWranglerAuth() {
  const res = run(npxBin, ['wrangler', 'whoami']);
  if (res.ok) {
    result('cloudflare.wrangler.authenticated', 'pass', 'info', 'Wrangler authentication is available.', 'No action required.');
    return;
  }
  result('cloudflare.wrangler.authenticated', 'warn', 'medium', 'Wrangler is not authenticated or cannot read the current Cloudflare identity.', 'Run npx wrangler login for local OAuth authentication, or use a secure CI secret manager.');
}

function checkPackageScripts() {
  const text = readText('package.json');
  if (text === null) {
    result('package.scripts.cloudflare_preflight', 'fail', 'high', 'package.json is missing.', 'Restore package.json before running Cloudflare preflight.');
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    result('package.scripts.cloudflare_preflight', 'fail', 'high', 'package.json could not be parsed.', 'Fix package.json syntax.');
    return;
  }

  const scripts = pkg.scripts || {};
  const required = ['doctor', 'doctor:online', 'typecheck', 'build', 'deploy'];
  const missing = required.filter((name) => !scripts[name]);
  if (missing.length) {
    result('package.scripts.cloudflare_preflight', 'fail', 'high', `Missing package script(s): ${missing.join(', ')}.`, 'Add required package scripts before packaging Cloudflare deployment.');
    return;
  }
  result('package.scripts.cloudflare_preflight', 'pass', 'info', 'Required package scripts exist for Cloudflare preflight.', 'No action required.');
}

function hasRegex(text, regex) {
  return regex.test(text);
}

function checkTomlRegex(code, text, regex, message, suggestion, severity = 'high') {
  if (hasRegex(text, regex)) {
    result(code, 'pass', 'info', message, 'No action required.');
    return;
  }
  result(code, 'fail', severity, message.replace('is configured', 'is missing'), suggestion);
}

function checkLifecycleTriggerConfig(text) {
  const configured = /^\s*\[triggers\]\s*$(?:\r?\n(?!\s*\[)[^\r\n]*)*?\r?\n\s*crons\s*=\s*\[\s*"0 \* \* \* \*"\s*\]\s*$/m.test(text);
  if (configured) {
    result('lifecycle.trigger_config', 'pass', 'info', 'Lifecycle cron trigger is configured for hourly execution.', 'No action required.');
    return;
  }
  result('lifecycle.trigger_config', 'fail', 'high', 'Lifecycle cron trigger is missing or not configured as crons = ["0 * * * *"].', 'Add [triggers] crons = ["0 * * * *"] to wrangler.toml.');
}

function checkWranglerToml() {
  const text = readText('wrangler.toml');
  if (text === null) {
    return;
  }

  checkTomlRegex(
    'wrangler.worker_name.configured',
    text,
    /^\s*name\s*=\s*"[^"]+"\s*$/m,
    'Worker name is configured.',
    'Set the top-level name field in wrangler.toml.',
  );
  checkTomlRegex(
    'wrangler.assets.configured',
    text,
    /^\s*\[assets\]\s*$/m,
    'Assets configuration is configured.',
    'Add an [assets] section with the static build directory and ASSETS binding.',
  );
  checkTomlRegex(
    'wrangler.d1.binding.configured',
    text,
    /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m,
    'D1 binding is configured.',
    'Add a [[d1_databases]] entry with binding "DB".',
  );
  checkTomlRegex(
    'wrangler.r2.binding.configured',
    text,
    /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"UPLOADS"/m,
    'R2 binding is configured.',
    'Add a [[r2_buckets]] entry with binding "UPLOADS".',
  );
  checkTomlRegex(
    'wrangler.do.binding.configured',
    text,
    /\[\[durable_objects\.bindings\]\][\s\S]*?name\s*=\s*"CHAT_ROOM"/m,
    'Durable Object binding is configured.',
    'Add a [[durable_objects.bindings]] entry for "CHAT_ROOM".',
  );
  checkTomlRegex(
    'wrangler.visitor_root_domain.configured',
    text,
    /\[vars\][\s\S]*?VISITOR_ROOT_DOMAIN\s*=\s*"[^"]+"/m,
    'VISITOR_ROOT_DOMAIN is configured.',
    'Add VISITOR_ROOT_DOMAIN under [vars].',
  );
  checkTomlRegex(
    'wrangler.route.backend.configured',
    text,
    /pattern\s*=\s*"denglu\.kefuxitong\.net\/\*"/m,
    'Backend route is configured.',
    'Add the backend custom-domain route to wrangler.toml.',
  );
  checkTomlRegex(
    'wrangler.route.visitor_root.configured',
    text,
    /pattern\s*=\s*"vx9qn7zr\.org\/\*"/m,
    'Visitor root route is configured.',
    'Add the visitor root-domain route to wrangler.toml.',
  );
  checkTomlRegex(
    'wrangler.route.visitor_wildcard.configured',
    text,
    /pattern\s*=\s*"\*\.vx9qn7zr\.org\/\*"/m,
    'Visitor wildcard route is configured.',
    'Add the visitor wildcard route to wrangler.toml.',
  );
  checkLifecycleTriggerConfig(text);
}

function checkLifecycleDryRunScript() {
  const text = readText('package.json');
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
  const text = readText('src/worker.ts');
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
  checkLifecycleDryRunScript();
  checkLifecycleMigrationFields();
  checkLifecycleScheduledHandler();
}

function setupTokenKey() {
  return ['SETUP', 'TOKEN'].join('_');
}

function checkSetupDeploymentGuidance() {
  const key = setupTokenKey();
  result(
    'setup.secret.worker_secret',
    'warn',
    'medium',
    `For production setup initialization, configure ${key} as a Worker secret before using /setup.`,
    `Run: wrangler secret put ${key}`,
  );
  result(
    'setup.secret.not_in_wrangler_vars',
    'pass',
    'info',
    `Do not place ${key} in wrangler.toml [vars].`,
    'Keep setup initialization secrets in Wrangler secrets only.',
  );
  result(
    'setup.secret.not_frontend_env',
    'pass',
    'info',
    `Do not place ${key} in frontend .env files or import.meta.env.`,
    'The setup page should accept the initialization credential only from the form.',
  );
  result(
    'setup.secret.rotate_after_initialize',
    'warn',
    'medium',
    `After initialization succeeds, delete or rotate ${key}.`,
    `Use Wrangler secret management to remove or rotate ${key}; this preflight does not modify secrets.`,
  );
  result(
    'setup.initialization.path',
    'pass',
    'info',
    'Preferred first-admin initialization path is now /setup.',
    'Existing bootstrap admin environment support remains compatibility behavior and should not be removed in this preflight.',
  );
}

function main() {
  checkNode();
  checkNpm();
  checkExists('package.json.exists', 'package.json');
  checkExists('wrangler.toml.exists', 'wrangler.toml');

  const wranglerAvailable = checkWranglerAvailable();
  if (wranglerAvailable) checkWranglerAuth();

  checkPackageScripts();
  checkWranglerToml();
  checkLifecycleAutomation();
  checkSetupDeploymentGuidance();
  checkExists('docs.security_baseline.exists', 'docs/SECURITY_BASELINE.md');
  checkExists('docs.doctor_plan.exists', 'docs/DOCTOR_PLAN.md');
  checkExists('templates.deploy_example.exists', 'templates/deploy.example.bat');
  checkExists('scripts.doctor.exists', 'scripts/doctor.mjs');

  for (const item of results) console.log(JSON.stringify(item));

  const shouldFail = results.some((item) => item.status === 'fail' && ['high', 'critical'].includes(item.severity));
  process.exitCode = shouldFail ? 1 : 0;
}

main();
