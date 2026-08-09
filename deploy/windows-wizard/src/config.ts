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
  privateKeyPath?: string;
  hostKeySha256?: string;
  appDomain: string;
  visitorRootDomain: string;
  remoteBaseDir: string;
};

export const DEPLOYMENT_SSH_PASSWORD_ENV = 'CUSTOMER_SERVICE_DEPLOY_SSH_PASSWORD';

const DEPLOYMENT_CONFIG_KEYS = new Set([
  'mode', 'dryRun', 'runMigrations', 'host', 'port', 'username', 'authMethod',
  'privateKeyPath', 'hostKeySha256', 'appDomain', 'visitorRootDomain', 'remoteBaseDir',
]);

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
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Deployment plan must be a JSON object.');
  const source = parsed as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !DEPLOYMENT_CONFIG_KEYS.has(key));
  if (unknown.length) throw new Error(`Deployment plan contains unsupported fields: ${unknown.join(', ')}`);
  const config: Record<string, unknown> = {};
  for (const key of DEPLOYMENT_CONFIG_KEYS) {
    if (key in source) config[key] = source[key];
  }
  return config as DeploymentConfig;
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
