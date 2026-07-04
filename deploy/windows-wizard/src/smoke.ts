import { generateDeploymentPlan } from './deployPlan.js';
import { generateRedactedRemoteEnv, plannedRemoteCommands } from './remoteCommands.js';
import { redactText } from './redact.js';
import { validateDeploymentConfig } from './validation.js';
import type { DeploymentConfig } from './config.js';

const sampleConfig: DeploymentConfig = {
  serverHost: 'example-host',
  sshPort: 22,
  sshUser: 'deploy',
  authMethod: 'password',
  password: 'sample-password-for-smoke',
  appDomain: 'admin.example.com',
  visitorRootDomain: 'visitor.example.com',
  email: 'ops@example.com',
  remoteDir: '/opt/customer-chat',
  appPort: 3000,
  storagePath: '/opt/customer-chat/storage',
  backupDir: '/opt/customer-chat/backup',
  setupToken: 'sample-setup-token-for-smoke',
  sessionSecret: 'sample-session-secret-for-smoke',
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runSmoke(): void {
  const validation = validateDeploymentConfig(sampleConfig);
  assert(validation.ok, `validation failed: ${validation.errors.join(', ')}`);

  const invalid = validateDeploymentConfig({ ...sampleConfig, remoteDir: 'relative/path' });
  assert(!invalid.ok, 'invalid remoteDir should fail validation');

  const plan = generateDeploymentPlan(sampleConfig);
  const serializedPlan = JSON.stringify(plan);
  assert(plan.steps.length === 7, 'plan should include seven steps');
  assert(plan.target.setupUrl.endsWith('/setup'), 'plan should include setup URL');

  const redacted = redactText(
    `password=${sampleConfig.password} setupToken=${sampleConfig.setupToken} sessionSecret=${sampleConfig.sessionSecret}`,
    sampleConfig,
  );
  assert(!redacted.includes(sampleConfig.password || ''), 'password should be redacted');
  assert(!redacted.includes(sampleConfig.setupToken), 'setupToken should be redacted');
  assert(!redacted.includes(sampleConfig.sessionSecret), 'sessionSecret should be redacted');

  const envPreview = generateRedactedRemoteEnv(sampleConfig);
  assert(!envPreview.includes(sampleConfig.setupToken), 'remote env preview should be redacted');
  assert(!envPreview.includes(sampleConfig.sessionSecret), 'remote env preview should be redacted');

  const commands = plannedRemoteCommands(sampleConfig).join('\n');
  assert(!commands.includes(sampleConfig.setupToken), 'commands should not include setupToken');
  assert(!commands.includes(sampleConfig.sessionSecret), 'commands should not include sessionSecret');
  assert(!serializedPlan.includes(sampleConfig.password || ''), 'plan should not include password');
  assert(!serializedPlan.includes(sampleConfig.setupToken), 'plan should not include setupToken');
  assert(!serializedPlan.includes(sampleConfig.sessionSecret), 'plan should not include sessionSecret');
}
