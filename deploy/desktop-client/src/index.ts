import { loadDesktopClientConfig } from './config.js';
import { generateClientPlan } from './clientPlan.js';
import { runSmoke } from './smoke.js';

function usage(): string {
  return [
    'Desktop client shell MVP CLI',
    '',
    'Usage:',
    '  node dist/index.js --smoke',
    '  node dist/index.js --plan <config.json>',
    '',
    'This MVP does not package an EXE, connect to a server, or store credentials.',
  ].join('\n');
}

async function main(argv: string[]) {
  if (argv.includes('--smoke')) {
    await runSmoke();
    console.log('desktop-client smoke passed: URL validation, redaction, client plan, launcher, public config store');
    return;
  }

  const planIndex = argv.indexOf('--plan');
  if (planIndex >= 0) {
    const configPath = argv[planIndex + 1];
    if (!configPath) throw new Error('--plan requires a config.json path');
    const config = await loadDesktopClientConfig(configPath);
    console.log(JSON.stringify(generateClientPlan(config), null, 2));
    return;
  }

  console.log(usage());
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  process.exitCode = 1;
});
