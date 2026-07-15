import path from 'node:path';
import { access } from 'node:fs/promises';
import { normalizeDeploymentConfig, type DeploymentConfig } from './config.js';
import { generateDeploymentPlan } from './deployPlan.js';
import { createMockSshClient, createRealSshClient, type SshClient } from './ssh.js';
import { createMockTransfer, createRealTransfer, listUploadFiles, type FileTransfer } from './transfer.js';
import { commandChmodScripts, commandCreateRemoteDir, commandRunInstall, commandRunInstallSelfCheck } from './remoteCommands.js';
import { createWizardLogger, type WizardLogger } from './logs.js';
import { redactText } from './redact.js';
import { assertValidDeploymentConfig } from './validation.js';
import { fileURLToPath } from 'node:url';

export type DeployOptions = {
  real: boolean;
  dryRun: boolean;
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function localLinuxDeployDir(): string {
  return path.join(repoRoot(), 'deploy', 'linux');
}

function createClients(config: DeploymentConfig, real: boolean): { ssh: SshClient; transfer: FileTransfer } {
  return real
    ? { ssh: createRealSshClient(config), transfer: createRealTransfer(config) }
    : { ssh: createMockSshClient(config), transfer: createMockTransfer(config) };
}

async function ensureLinuxDeployExists(localDir: string) {
  try {
    await access(localDir);
  } catch {
    throw new Error(`Local deploy/linux directory was not found at ${localDir}.`);
  }
}

async function execOrThrow(ssh: SshClient, command: string, logger: WizardLogger, config: DeploymentConfig) {
  logger.info(`remote$ ${redactText(command, config)}`);
  const result = await ssh.exec(command, (chunk) => logger.info(chunk.trimEnd()));
  if (result.code !== 0) {
    throw new Error(`Remote command failed with exit code ${result.code}: ${redactText(result.stderr || result.stdout, config)}`);
  }
}

export async function runDeployment(config: DeploymentConfig, options: DeployOptions) {
  assertValidDeploymentConfig(config);
  const normalized = normalizeDeploymentConfig(config);
  const logger = createWizardLogger(config);
  const localDir = localLinuxDeployDir();
  await ensureLinuxDeployExists(localDir);

  const plan = generateDeploymentPlan(config);
  const files = await listUploadFiles(localDir);
  const shouldConnect = options.real && normalized.mode === 'real' && !options.dryRun && !normalized.dryRun;

  logger.info(`Deployment mode: ${shouldConnect ? 'real SSH' : 'dry-run/mock'}`);
  logger.info(`Remote deploy directory: ${normalized.remoteLinuxDir}`);
  logger.info(`Upload file count: ${files.length}`);
  for (const file of files) logger.info(`upload: ${file}`);

  if (!shouldConnect) {
    logger.info('No real SSH connection will be opened. Use --real with dryRun=false in the plan to connect.');
    logger.info(JSON.stringify(plan, null, 2));
    return {
      ok: true,
      realSshExecuted: false,
      uploadedFiles: files,
      plan,
    };
  }

  const { ssh, transfer } = createClients(config, true);
  try {
    logger.info('Testing SSH connection...');
    await ssh.testConnection();
    await execOrThrow(ssh, commandCreateRemoteDir(normalized), logger, config);

    logger.info('Uploading deploy/linux...');
    const upload = await transfer.uploadDirectory(localDir, normalized.remoteLinuxDir);
    logger.info(upload.summary);

    await execOrThrow(ssh, commandChmodScripts(normalized), logger, config);
    await execOrThrow(ssh, commandRunInstallSelfCheck(normalized), logger, config);
    await execOrThrow(ssh, commandRunInstall(normalized), logger, config);

    return {
      ok: true,
      realSshExecuted: true,
      uploadedFiles: files,
      plan,
    };
  } finally {
    await ssh.dispose();
  }
}
