import type { DesktopClientConfig, DesktopClientMode } from './config.js';

const FORBIDDEN_PROTOCOLS = new Set(['file:', 'javascript:', 'data:']);
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'code',
  'session',
  'cookie',
  'password',
  'secret',
  'setupToken',
  'SETUP_TOKEN',
  'ENCRYPTION_KEY',
  'key',
]);

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

function validateHttpUrl(value: string, field: string, errors: string[]): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${field} must be a valid URL`);
    return;
  }

  if (FORBIDDEN_PROTOCOLS.has(url.protocol) || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    errors.push(`${field} must use http or https`);
  }

  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key) || /token|code|session|cookie|password|secret/i.test(key)) {
      errors.push(`${field} should not include sensitive query parameter: ${key}`);
    }
  }
}

function isMode(value: unknown): value is DesktopClientMode {
  return value === 'admin' || value === 'visitor' || value === 'auto';
}

function isStartMode(value: unknown): boolean {
  return value === undefined || value === 'admin' || value === 'visitor';
}

export function validateDesktopClientConfig(config: DesktopClientConfig): ValidationResult {
  const errors: string[] = [];
  if (!config.appName || typeof config.appName !== 'string') errors.push('appName is required');
  if (config.windowTitle !== undefined && typeof config.windowTitle !== 'string') errors.push('windowTitle must be string');
  if (!config.adminUrl || typeof config.adminUrl !== 'string') {
    errors.push('adminUrl is required');
  } else {
    validateHttpUrl(config.adminUrl, 'adminUrl', errors);
  }

  if (config.visitorRootUrl) validateHttpUrl(config.visitorRootUrl, 'visitorRootUrl', errors);
  if (!isMode(config.mode)) errors.push('mode must be admin, visitor, or auto');
  if (!isStartMode(config.startMode)) errors.push('startMode must be admin or visitor');
  if (typeof config.rememberWindowState !== 'boolean') errors.push('rememberWindowState must be boolean');
  if (typeof config.allowExternalOpen !== 'boolean') errors.push('allowExternalOpen must be boolean');

  return { ok: errors.length === 0, errors };
}

export function assertValidDesktopClientConfig(config: DesktopClientConfig): void {
  const result = validateDesktopClientConfig(config);
  if (!result.ok) throw new Error(`Invalid desktop client config: ${result.errors.join('; ')}`);
}
