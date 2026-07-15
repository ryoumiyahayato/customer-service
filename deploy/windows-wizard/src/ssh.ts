import type { DeploymentConfig } from './config.js';
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import { redactText } from './redact.js';
import { createHostKeyVerifier } from './sshHostKey.js';

export type SshExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type SshClient = {
  testConnection: () => Promise<boolean>;
  exec: (command: string, onOutput?: (chunk: string) => void) => Promise<SshExecResult>;
  dispose: () => Promise<void>;
};

export function createMockSshClient(config: DeploymentConfig): SshClient {
  return {
    async testConnection() {
      return true;
    },
    async exec(command) {
      return {
        code: 0,
        stdout: redactText(`mock exec: ${command}`, config),
        stderr: '',
      };
    },
    async dispose() {
      return;
    },
  };
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

  if (!config.passwordEnv) throw new Error('passwordEnv is required for password auth.');
  const password = process.env[config.passwordEnv];
  if (!password) throw new Error(`Password environment variable ${config.passwordEnv} is not set.`);
  return Promise.resolve({ ...base, password });
}

async function connect(config: DeploymentConfig): Promise<Client> {
  const client = new Client();
  const sshConfig = await connectionConfig(config);
  return await new Promise((resolve, reject) => {
    client
      .once('ready', () => resolve(client))
      .once('error', (error) => reject(new Error(`SSH connection failed: ${redactText(error.message, config)}`)))
      .connect(sshConfig);
  });
}

export function createRealSshClient(config: DeploymentConfig): SshClient {
  let clientPromise: Promise<Client> | null = null;
  const getClient = () => {
    clientPromise ||= connect(config);
    return clientPromise;
  };

  return {
    async testConnection() {
      await getClient();
      return true;
    },
    async exec(command, onOutput) {
      const client = await getClient();
      return await new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) {
            reject(new Error(`Remote command failed to start: ${redactText(error.message, config)}`));
            return;
          }

          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          stream
            .on('close', (code: number | null) => {
              const stdout = redactText(Buffer.concat(stdoutChunks).toString('utf8'), config);
              const stderr = redactText(Buffer.concat(stderrChunks).toString('utf8'), config);
              if (stdout) onOutput?.(stdout);
              if (stderr) onOutput?.(stderr);
              resolve({
                code: code ?? 0,
                stdout,
                stderr,
              });
            })
            .on('data', (chunk: Buffer) => {
              stdoutChunks.push(Buffer.from(chunk));
            });
          stream.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(Buffer.from(chunk));
          });
        });
      });
    },
    async dispose() {
      const client = await clientPromise?.catch(() => null);
      client?.end();
    },
  };
}
