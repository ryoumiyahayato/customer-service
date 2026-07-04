import type { DeploymentConfig } from './config.js';
import { redactText } from './redact.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function commandCreateRemoteDir(config: DeploymentConfig): string {
  return `mkdir -p ${shellQuote(config.remoteDir)}`;
}

export function commandChmodEnv(config: DeploymentConfig): string {
  return `chmod 600 ${shellQuote(`${config.remoteDir}/.env`)}`;
}

export function commandChmodScripts(config: DeploymentConfig): string {
  const scripts = ['install.sh', 'healthcheck.sh', 'backup.sh', 'restore.sh', 'upgrade.sh']
    .map((script) => shellQuote(`${config.remoteDir}/${script}`))
    .join(' ');
  return `chmod +x ${scripts}`;
}

export function commandRunInstall(config: DeploymentConfig): string {
  return `cd ${shellQuote(config.remoteDir)} && ./install.sh`;
}

export function commandRunHealthcheck(config: DeploymentConfig): string {
  return `cd ${shellQuote(config.remoteDir)} && ./healthcheck.sh`;
}

export function generateRemoteEnv(config: DeploymentConfig): string {
  return [
    `APP_DOMAIN=${config.appDomain}`,
    `VISITOR_ROOT_DOMAIN=${config.visitorRootDomain}`,
    `APP_PORT=${config.appPort}`,
    `STORAGE_DRIVER=local`,
    `STORAGE_PATH=${config.storagePath}`,
    `BACKUP_DIR=${config.backupDir}`,
    `SETUP_TOKEN=${config.setupToken}`,
    `SESSION_SECRET=${config.sessionSecret}`,
    `LOG_LEVEL=info`,
    `RUN_SERVER_MIGRATIONS=0`,
  ].join('\n');
}

export function generateRedactedRemoteEnv(config: DeploymentConfig): string {
  return redactText(generateRemoteEnv(config), config);
}

export function plannedRemoteCommands(config: DeploymentConfig): string[] {
  return [
    commandCreateRemoteDir(config),
    commandChmodEnv(config),
    commandChmodScripts(config),
    commandRunInstall(config),
    commandRunHealthcheck(config),
  ];
}
