#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', '.wrangler', '.wrangler-dry-run']);
const statuses = [];

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

function main() {
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
  checkFileExists('docs.security_baseline.exists', 'docs/SECURITY_BASELINE.md');
  checkFileExists('docs.doctor_plan.exists', 'docs/DOCTOR_PLAN.md');
  checkFileExists('templates.deploy_example.exists', 'templates/deploy.example.bat');
  checkGitignore();

  for (const item of statuses) console.log(JSON.stringify(item));

  const shouldFail = statuses.some((item) => item.status === 'fail' && ['high', 'critical'].includes(item.severity));
  process.exitCode = shouldFail ? 1 : 0;
}

main();
