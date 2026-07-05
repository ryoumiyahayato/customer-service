import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type AuthMethod = 'password' | 'privateKey';
export type DeploymentMode = 'mock' | 'real';

export type DeploymentConfig = {
  mode?: DeploymentMode;
  dryRun?: boolean;
  runMigrations?: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  passwordEnv?: string;
  privateKeyPath?: string;
  appDomain: string;
  visitorRootDomain: string;
  remoteBaseDir: string;
};

export type NormalizedDeploymentConfig = Required<Pick<DeploymentConfig, 'mode' | 'dryRun' | 'runMigrations'>> &
  Omit<DeploymentConfig, 'mode' | 'dryRun' | 'runMigrations'> & {
    remoteLinuxDir: string;
    privateKeyLabel?: string;
  };

export type RedactedDeploymentConfig = Omit<NormalizedDeploymentConfig, 'privateKeyPath'> & {
  privateKeyPath?: string;
};

export async function loadDeploymentConfig(filePath: string): Promise<DeploymentConfig> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as DeploymentConfig;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeDeploymentConfig(config: DeploymentConfig): NormalizedDeploymentConfig {
  const remoteBaseDir = trimTrailingSlash(config.remoteBaseDir || '');
  const remoteLinuxDir = `${remoteBaseDir}/customer-chat/deploy/linux`;
  const privateKeyLabel = config.privateKeyPath ? path.basename(config.privateKeyPath) : undefined;

  return {
    ...config,
    mode: config.mode || 'mock',
    dryRun: config.dryRun ?? true,
    runMigrations: config.runMigrations ?? false,
    remoteBaseDir,
    remoteLinuxDir,
    privateKeyLabel,
  };
}

export function redactConfig(config: DeploymentConfig | NormalizedDeploymentConfig): RedactedDeploymentConfig {
  const normalized = 'remoteLinuxDir' in config ? config : normalizeDeploymentConfig(config);
  return {
    ...normalized,
    privateKeyPath: normalized.privateKeyPath ? `[basename:${path.basename(normalized.privateKeyPath)}]` : undefined,
  };
}
