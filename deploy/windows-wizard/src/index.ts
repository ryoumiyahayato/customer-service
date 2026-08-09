import { loadDeploymentConfig } from './config.js';
import { generateDeploymentPlan } from './deployPlan.js';
import { runDeployment } from './deployment.js';
import { runAsyncSmoke } from './smoke.js';

function usage(): string {
  return [
    'Windows deployment wizard MVP CLI',
    '',
    'Usage:',
    '  node dist/index.js --smoke',
    '  node dist/index.js --plan <config.json>',
    '  node dist/index.js plan --plan <config.json>',
    '  node dist/index.js deploy --plan <config.json> --dry-run',
    '  node dist/index.js deploy --plan <config.json> --real --confirm-target',
    '',
    'Default mode never opens real SSH. Real SSH requires deploy --real, --confirm-target, and dryRun=false in the plan.',
  ].join('\n');
}

function valueAfter(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(argv: string[]) {
  const command = argv[0]?.startsWith('--') ? undefined : argv[0];
  if (argv.includes('--smoke') || command === 'smoke') {
    await runAsyncSmoke();
    console.log('windows-wizard smoke passed: validation, deployment plan, redaction, upload list, mock deploy');
    return;
  }

  if (argv.includes('--plan') && (!command || command === 'plan')) {
    const configPath = valueAfter(argv, '--plan');
    if (!configPath) throw new Error('--plan requires a config.json path');
    const config = await loadDeploymentConfig(configPath);
    const plan = generateDeploymentPlan(config);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === 'deploy') {
    const configPath = valueAfter(argv, '--plan');
    if (!configPath) throw new Error('deploy requires --plan <config.json>');
    const config = await loadDeploymentConfig(configPath);
    const result = await runDeployment(config, {
      real: argv.includes('--real'),
      dryRun: argv.includes('--dry-run'),
      confirmTarget: argv.includes('--confirm-target'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(usage());
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  process.exitCode = 1;
});
