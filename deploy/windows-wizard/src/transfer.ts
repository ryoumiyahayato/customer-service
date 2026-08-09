import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEPLOYMENT_SSH_PASSWORD_ENV, type DeploymentConfig } from './config.js';
import { Client, type SFTPWrapper } from 'ssh2';
import { redactText } from './redact.js';
import { readFile } from 'node:fs/promises';
import { createHostKeyVerifier } from './sshHostKey.js';

export type TransferResult = {
  ok: true;
  summary: string;
};

export type FileTransfer = {
  uploadFile: (localPath: string, remotePath: string) => Promise<TransferResult>;
  uploadDirectory: (localDir: string, remoteDir: string) => Promise<TransferResult>;
  uploadText: (content: string, remotePath: string) => Promise<TransferResult>;
};

export function createMockTransfer(config: DeploymentConfig): FileTransfer {
  return {
    async uploadFile(localPath, remotePath) {
      return { ok: true, summary: redactText(`mock upload file ${localPath} -> ${remotePath}`, config) };
    },
    async uploadDirectory(localDir, remoteDir) {
      return { ok: true, summary: redactText(`mock upload directory ${localDir} -> ${remoteDir}`, config) };
    },
    async uploadText(_content, remotePath) {
      return { ok: true, summary: redactText(`mock upload text -> ${remotePath}`, config) };
    },
  };
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'logs', 'storage', 'backup', 'dist']);
const EXCLUDED_FILES = new Set(['.env']);

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, fullPath)));
    else if (entry.isFile()) files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
  }
  return files.sort();
}

export async function listUploadFiles(localDir: string): Promise<string[]> {
  await stat(localDir);
  return walkFiles(localDir);
}

function connectionConfig(config: DeploymentConfig) {
  const base = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: 20_000,
    hostVerifier: createHostKeyVerifier(config.hostKeySha256),
  };

  if (config.authMethod === 'privateKey') {
    if (!config.privateKeyPath) throw new Error('privateKeyPath is required for privateKey auth.');
    return readFile(config.privateKeyPath, 'utf8').then((privateKey) => ({ ...base, privateKey }));
  }

  const password = process.env[DEPLOYMENT_SSH_PASSWORD_ENV];
  if (!password) throw new Error(`${DEPLOYMENT_SSH_PASSWORD_ENV} is not set.`);
  return Promise.resolve({ ...base, password });
}

async function connectSftp(config: DeploymentConfig): Promise<{ client: Client; sftp: SFTPWrapper }> {
  const client = new Client();
  const sshConfig = await connectionConfig(config);
  return await new Promise((resolve, reject) => {
    client
      .once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) reject(new Error(`SFTP startup failed: ${redactText(error.message, config)}`));
          else resolve({ client, sftp });
        });
      })
      .once('error', (error) => reject(new Error(`SSH connection failed: ${redactText(error.message, config)}`)))
      .connect(sshConfig);
  });
}

async function ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split('/').filter(Boolean);
  let current = remoteDir.startsWith('/') ? '/' : '';
  for (const part of parts) {
    current = current === '/' ? `/${part}` : `${current}/${part}`;
    const exists = await new Promise<boolean>((resolve) => {
      sftp.stat(current, (error) => resolve(!error));
    });
    if (exists) continue;
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(current, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export function createRealTransfer(config: DeploymentConfig): FileTransfer {
  return {
    async uploadFile(localPath, remotePath) {
      const { client, sftp } = await connectSftp(config);
      try {
        await ensureRemoteDir(sftp, path.posix.dirname(remotePath));
        await new Promise<void>((resolve, reject) => {
          sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()));
        });
        return { ok: true, summary: redactText(`uploaded ${path.basename(localPath)} -> ${remotePath}`, config) };
      } finally {
        client.end();
      }
    },
    async uploadDirectory(localDir, remoteDir) {
      const files = await listUploadFiles(localDir);
      const { client, sftp } = await connectSftp(config);
      try {
        for (const relativePath of files) {
          const localPath = path.join(localDir, relativePath);
          const remotePath = `${remoteDir}/${relativePath}`;
          await ensureRemoteDir(sftp, path.posix.dirname(remotePath));
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()));
          });
        }
        return { ok: true, summary: `uploaded ${files.length} deploy/linux file(s)` };
      } finally {
        client.end();
      }
    },
    async uploadText(content, remotePath) {
      const { client, sftp } = await connectSftp(config);
      try {
        await ensureRemoteDir(sftp, path.posix.dirname(remotePath));
        await new Promise<void>((resolve, reject) => {
          const stream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
          stream.on('error', reject);
          stream.on('finish', resolve);
          stream.end(content);
        });
        return { ok: true, summary: redactText(`uploaded text -> ${remotePath}`, config) };
      } finally {
        client.end();
      }
    },
  };
}
