import { generateDeploymentPlan } from './deployPlan.js';
import { runDeployment } from './deployment.js';
import { generateRedactedRemoteEnv, plannedRemoteCommands } from './remoteCommands.js';
import { redactText } from './redact.js';
import { validateDeploymentConfig } from './validation.js';
import type { DeploymentConfig } from './config.js';

const sampleConfig: DeploymentConfig = {
  mode: 'mock',
  dryRun: true,
  runMigrations: false,
  host: 'example-host',
  port: 22,
  username: 'deploy',
  authMethod: 'privateKey',
  privateKeyPath: 'C:\\Users\\Example\\.ssh\\id_ed25519',
  appDomain: 'admin.example.com',
  visitorRootDomain: 'visitor.example.com',
  remoteBaseDir: '/opt',
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runSmoke(): void {
  const validation = validateDeploymentConfig(sampleConfig);
  assert(validation.ok, `validation failed: ${validation.errors.join(', ')}`);

  const invalid = validateDeploymentConfig({ ...sampleConfig, remoteBaseDir: 'relative/path' });
  assert(!invalid.ok, 'invalid remoteBaseDir should fail validation');

  const plan = generateDeploymentPlan(sampleConfig);
  const serializedPlan = JSON.stringify(plan);
  assert(plan.steps.length === 7, 'plan should include seven steps');
  assert(plan.target.setupUrl.endsWith('/setup'), 'plan should include setup URL');
  assert(plan.dryRun, 'plan should default to dryRun-safe behavior');

  const redacted = redactText(
    `password=sample-password setupToken=sample-token SESSION_SECRET=sample-secret ENCRYPTION_KEY=sample-key DATABASE_URL=postgres://user:pass@host/db privateKeyPath=${sampleConfig.privateKeyPath} https://example.com/?token=abc&session=def&password=pwd`,
    sampleConfig,
  );
  assert(!redacted.includes('sample-password'), 'password should be redacted');
  assert(!redacted.includes('sample-token'), 'setupToken should be redacted');
  assert(!redacted.includes('sample-secret'), 'session secret should be redacted');
  assert(!redacted.includes('sample-key'), 'encryption key should be redacted');
  assert(!redacted.includes('postgres://user:pass@host/db'), 'database URL should be redacted');

  const envPreview = generateRedactedRemoteEnv(sampleConfig);
  assert(!envPreview.includes('SETUP_TOKEN='), 'remote env preview should not generate secrets');

  const commands = plannedRemoteCommands(sampleConfig).join('\n');
  assert(commands.includes('./install.sh --self-check'), 'commands should include self-check');
  assert(commands.includes('./install.sh --dry-run'), 'dry-run plan should include install dry-run');
  assert(!serializedPlan.includes(sampleConfig.privateKeyPath || ''), 'plan should not include full private key path');
}

export async function runAsyncSmoke(): Promise<void> {
  runSmoke();
  const result = await runDeployment(sampleConfig, { real: false, dryRun: true });
  assert(!result.realSshExecuted, 'smoke deploy must not execute real SSH');
  assert(result.uploadedFiles.includes('install.sh'), 'upload list should include install.sh');
}
