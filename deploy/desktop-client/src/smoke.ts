import type { DesktopClientConfig } from './config.js';
import { generateClientPlan } from './clientPlan.js';
import { redactText, redactUrl } from './redact.js';
import { openClientTarget } from './launcher.js';
import { createMemoryConfigStore, exampleConfig } from './storage.js';
import { validateDesktopClientConfig } from './validation.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const validConfig: DesktopClientConfig = {
  appName: '客服系统',
  windowTitle: '客服系统',
  adminUrl: 'https://admin.example.com/?token=abc&view=home',
  visitorRootUrl: 'https://visitor.example.com/',
  startMode: 'admin',
  mode: 'auto',
  rememberWindowState: true,
  allowExternalOpen: false,
};

export async function runSmoke(): Promise<void> {
  const cleanConfig = { ...validConfig, adminUrl: 'https://admin.example.com/' };
  assert(validateDesktopClientConfig(cleanConfig).ok, 'valid URL should pass');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'file:///tmp/app.html' }).ok, 'file URL should fail');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'javascript:alert(1)' }).ok, 'javascript URL should fail');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'data:text/html,hi' }).ok, 'data URL should fail');
  assert(!validateDesktopClientConfig(validConfig).ok, 'sensitive query should fail validation');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'http://admin.example.com/' }).ok, 'remote HTTP should fail');
  assert(validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'http://127.0.0.1:8788/' }).ok, 'local HTTP should pass');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'https://alice:secret@admin.example.com/' }).ok, 'URL credentials should fail');
  assert(!validateDesktopClientConfig({ ...cleanConfig, adminUrl: 'https://admin.example.com/#token=secret' }).ok, 'URL fragments should fail');

  const redactedUrl = redactUrl(validConfig.adminUrl);
  assert(!redactedUrl.includes('abc'), 'token query should be redacted');
  assert(redactText('cookie=session-value').includes('[REDACTED]'), 'cookie log should be redacted');
  assert(redactText('ENCRYPTION_KEY=sample').includes('[REDACTED]'), 'encryption key log should be redacted');
  assert(redactText('BACKUP_SIGNING_KEY=sample').includes('[REDACTED]'), 'backup signing key log should be redacted');
  const credentialUrl = 'https://alice:supersecret@example.com/path#token=leak';
  const redactedCredentialUrl = redactUrl(credentialUrl);
  assert(!redactedCredentialUrl.includes('alice'), 'URL username should be redacted');
  assert(!redactedCredentialUrl.includes('supersecret'), 'URL password should be redacted');
  assert(!redactedCredentialUrl.includes('token=leak'), 'URL fragment should be redacted');
  assert(!redactText(`open ${credentialUrl}`).includes('supersecret'), 'embedded URL credentials should be redacted');

  const plan = generateClientPlan(cleanConfig);
  assert(plan.steps.some((step) => step.id === 'open-target'), 'client plan should include target opening');
  assert(plan.steps.some((step) => step.id === 'window-title'), 'client plan should include window title');
  assert(plan.todos.includes('自动更新 TODO'), 'client plan should include future todos');

  const launch = await openClientTarget(cleanConfig);
  assert(launch.openedUrl === cleanConfig.adminUrl, 'launcher should return target URL');

  const store = createMemoryConfigStore();
  await store.savePublicConfig(exampleConfig);
  const loaded = await store.loadPublicConfig();
  assert(loaded?.adminUrl === exampleConfig.adminUrl, 'public config store should round trip');
}
