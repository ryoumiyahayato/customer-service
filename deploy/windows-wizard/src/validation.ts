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

  if (!isNonEmpty(config.serverHost)) errors.push('serverHost is required');
  if (!Number.isInteger(config.sshPort) || config.sshPort < 1 || config.sshPort > 65535) {
    errors.push('sshPort must be between 1 and 65535');
  }
  if (!isNonEmpty(config.sshUser)) errors.push('sshUser is required');
  if (config.authMethod !== 'password' && config.authMethod !== 'privateKey') {
    errors.push('authMethod must be password or privateKey');
  }
  if (!isNonEmpty(config.appDomain)) errors.push('appDomain is required');
  if (!isNonEmpty(config.visitorRootDomain)) errors.push('visitorRootDomain is required');
  if (!isNonEmpty(config.email)) errors.push('email is required');
  if (!isNonEmpty(config.remoteDir) || !isAbsoluteLinuxPath(config.remoteDir)) {
    errors.push('remoteDir must be an absolute Linux path');
  }
  if (!Number.isInteger(config.appPort) || config.appPort < 1 || config.appPort > 65535) {
    errors.push('appPort must be between 1 and 65535');
  }
  if (!isNonEmpty(config.storagePath) || !isAbsoluteLinuxPath(config.storagePath)) {
    errors.push('storagePath must be an absolute Linux path');
  }
  if (!isNonEmpty(config.backupDir) || !isAbsoluteLinuxPath(config.backupDir)) {
    errors.push('backupDir must be an absolute Linux path');
  }
  if (config.authMethod === 'password' && !isNonEmpty(config.password)) {
    errors.push('password auth requires password');
  }
  if (config.authMethod === 'privateKey' && !isNonEmpty(config.privateKeyPath)) {
    errors.push('privateKey auth requires privateKeyPath');
  }
  if (isNonEmpty(config.password) && isNonEmpty(config.privateKeyPath)) {
    errors.push('password and privateKeyPath are mutually exclusive');
  }
  if (!isNonEmpty(config.setupToken)) errors.push('setupToken is required');
  if (!isNonEmpty(config.sessionSecret)) errors.push('sessionSecret is required');

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertValidDeploymentConfig(config: DeploymentConfig): void {
  const result = validateDeploymentConfig(config);
  if (!result.ok) throw new Error(`Invalid deployment config: ${result.errors.join('; ')}`);
}
