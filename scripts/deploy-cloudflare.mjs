#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';
const npxBin = isWindows ? 'npx.cmd' : 'npx';
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const shouldDeploy = args.has('--deploy');
const unknownArgs = rawArgs.filter((arg) => arg !== '--deploy');

const preflightSteps = [
  {
    name: 'local security doctor',
    command: npmBin,
    args: ['run', 'doctor'],
    display: 'npm run doctor',
    suggestion: 'Resolve local doctor failures before deployment.',
  },
  {
    name: 'cloudflare bootstrap preflight',
    command: npmBin,
    args: ['run', 'bootstrap:cloudflare'],
    display: 'npm run bootstrap:cloudflare',
    suggestion: 'Resolve Cloudflare preflight failures before deployment.',
  },
  {
    name: 'typecheck',
    command: npmBin,
    args: ['run', 'typecheck'],
    display: 'npm run typecheck',
    suggestion: 'Fix TypeScript errors before deployment.',
  },
  {
    name: 'build dry-run',
    command: npmBin,
    args: ['run', 'build'],
    display: 'npm run build',
    suggestion: 'Fix build or Wrangler dry-run errors before deployment.',
  },
];

const deploySteps = [
  {
    name: 'wrangler deploy',
    command: npxBin,
    args: ['wrangler', 'deploy'],
    display: 'npx wrangler deploy',
    suggestion: 'Inspect Wrangler deployment output, then rerun after fixing the deployment issue.',
  },
  {
    name: 'online smoke doctor',
    command: npmBin,
    args: ['run', 'doctor:online'],
    display: 'npm run doctor:online',
    suggestion: 'Fix public smoke-test failures before considering the deployment complete.',
  },
];

function printStage(step, status, suggestion = step.suggestion) {
  console.log(`STEP: ${step.name}`);
  console.log(`command: ${step.display}`);
  console.log(`status: ${status}`);
  console.log(`suggestion: ${suggestion}`);
  console.log('');
}

function runStep(step) {
  console.log(`STEP: ${step.name}`);
  console.log(`command: ${step.display}`);

  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : step.command;
  const commandArgs = isWindows ? ['/d', '/c', step.display] : step.args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  if (result.error) {
    console.log('status: fail');
    console.log(`suggestion: ${step.suggestion}`);
    console.log('');
    return false;
  }

  if (result.status !== 0) {
    console.log('status: fail');
    console.log(`suggestion: ${step.suggestion}`);
    console.log('');
    return false;
  }

  console.log('status: pass');
  console.log('suggestion: No action required.');
  console.log('');
  return true;
}

function printPlan() {
  console.log('Cloudflare deploy wrapper');
  console.log(`mode: ${shouldDeploy ? 'deploy' : 'dry-run'}`);
  console.log('');
  console.log('Planned steps:');
  for (const step of preflightSteps) {
    console.log(`- ${step.display}`);
  }
  if (shouldDeploy) {
    for (const step of deploySteps) {
      console.log(`- ${step.display}`);
    }
  } else {
    console.log('- deployment steps are skipped in default mode');
  }
  console.log('');
}

function main() {
  if (unknownArgs.length) {
    console.log('STEP: argument validation');
    console.log('command: node scripts/deploy-cloudflare.mjs [unsupported args omitted]');
    console.log('status: fail');
    console.log('suggestion: Only --deploy is supported. Omit it for dry-run mode.');
    console.log('');
    process.exitCode = 1;
    return;
  }

  printPlan();

  for (const step of preflightSteps) {
    if (!runStep(step)) {
      process.exitCode = 1;
      return;
    }
  }

  if (!shouldDeploy) {
    for (const step of deploySteps) {
      printStage(
        step,
        'skipped',
        'Default mode completed preflight only. To deploy, run: npm run deploy:cloudflare -- --deploy',
      );
    }
    return;
  }

  console.log('Deploy mode selected with --deploy. The wrapper will now execute:');
  for (const step of deploySteps) {
    console.log(`- ${step.display}`);
  }
  console.log('');

  for (const step of deploySteps) {
    if (!runStep(step)) {
      process.exitCode = 1;
      return;
    }
  }
}

main();
