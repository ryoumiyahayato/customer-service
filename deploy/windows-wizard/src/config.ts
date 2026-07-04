import { readFile } from 'node:fs/promises';

export type AuthMethod = 'password' | 'privateKey';

export type DeploymentConfig = {
  serverHost: string;
  sshPort: number;
  sshUser: string;
  authMethod: AuthMethod;
  password?: string;
  privateKeyPath?: string;
  appDomain: string;
  visitorRootDomain: string;
  email: string;
  remoteDir: string;
  appPort: number;
  storagePath: string;
  backupDir: string;
  setupToken: string;
  sessionSecret: string;
};

export type RedactedDeploymentConfig = Omit<DeploymentConfig, 'password' | 'setupToken' | 'sessionSecret'> & {
  password?: string;
  setupToken: string;
  sessionSecret: string;
};

export async function loadDeploymentConfig(filePath: string): Promise<DeploymentConfig> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as DeploymentConfig;
}

export function redactConfig(config: DeploymentConfig): RedactedDeploymentConfig {
  return {
    ...config,
    password: config.password ? '[REDACTED]' : undefined,
    setupToken: '[REDACTED]',
    sessionSecret: '[REDACTED]',
  };
}
