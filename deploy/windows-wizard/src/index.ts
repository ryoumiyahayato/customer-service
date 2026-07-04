import { loadDeploymentConfig } from './config.js';
import { generateDeploymentPlan } from './deployPlan.js';
import { runSmoke } from './smoke.js';

function usage(): string {
  return [
    'Windows deployment wizard MVP CLI',
    '',
    'Usage:',
    '  node dist/index.js --smoke',
    '  node dist/index.js --plan <config.json>',
    '',
    'This MVP does not open a GUI, connect to SSH, upload files, or run remote commands.',
  ].join('\n');
}

async function main(argv: string[]) {
  if (argv.includes('--smoke')) {
    runSmoke();
    console.log('windows-wizard smoke passed: validation, deployment plan, redaction, remote commands');
    return;
  }

  const planIndex = argv.indexOf('--plan');
  if (planIndex >= 0) {
    const configPath = argv[planIndex + 1];
    if (!configPath) throw new Error('--plan requires a config.json path');
    const config = await loadDeploymentConfig(configPath);
    const plan = generateDeploymentPlan(config);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(usage());
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  process.exitCode = 1;
});
