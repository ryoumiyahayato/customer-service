import type { DeploymentConfig } from './config.js';

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAbsoluteLinuxPath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0') && !value.includes('..');
}

export function validateDeploymentConfig(config: DeploymentConfig): ValidationResult {
  const errors: string[] = [];

  if (config.mode && config.mode !== 'mock' && config.mode !== 'real') {
    errors.push('mode must be mock or real');
  }
  if (config.dryRun !== undefined && typeof config.dryRun !== 'boolean') {
    errors.push('dryRun must be a boolean');
  }
  if (config.runMigrations !== undefined && typeof config.runMigrations !== 'boolean') {
    errors.push('runMigrations must be a boolean');
  }
  if (!isNonEmpty(config.host)) errors.push('host is required');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('port must be between 1 and 65535');
  }
  if (!isNonEmpty(config.username)) errors.push('username is required');
  if (config.authMethod !== 'password' && config.authMethod !== 'privateKey') {
    errors.push('authMethod must be password or privateKey');
  }
  if (!isNonEmpty(config.appDomain)) errors.push('appDomain is required');
  if (!isNonEmpty(config.visitorRootDomain)) errors.push('visitorRootDomain is required');
  if (!isNonEmpty(config.remoteBaseDir) || !isAbsoluteLinuxPath(config.remoteBaseDir)) {
    errors.push('remoteBaseDir must be an absolute Linux path');
  }
  if (config.authMethod === 'password' && !isNonEmpty(config.passwordEnv)) {
    errors.push('password auth requires passwordEnv');
  }
  if (config.authMethod === 'privateKey' && !isNonEmpty(config.privateKeyPath)) {
    errors.push('privateKey auth requires privateKeyPath');
  }
  if (isNonEmpty(config.passwordEnv) && isNonEmpty(config.privateKeyPath)) {
    errors.push('passwordEnv and privateKeyPath are mutually exclusive');
  }
  if (config.hostKeySha256 !== undefined && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(config.hostKeySha256.trim())) {
    errors.push('hostKeySha256 must be an OpenSSH SHA256 fingerprint');
  }
  if (config.mode === 'real' && !isNonEmpty(config.hostKeySha256)) {
    errors.push('real mode requires hostKeySha256');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertValidDeploymentConfig(config: DeploymentConfig): void {
  const result = validateDeploymentConfig(config);
  if (!result.ok) throw new Error(`Invalid deployment config: ${result.errors.join('; ')}`);
}
