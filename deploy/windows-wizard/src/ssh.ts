import type { DeploymentConfig } from './config.js';
import { redactText } from './redact.js';

export type SshExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type SshClient = {
  testConnection: () => Promise<boolean>;
  exec: (command: string) => Promise<SshExecResult>;
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
