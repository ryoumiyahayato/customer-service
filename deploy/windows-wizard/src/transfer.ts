import type { DeploymentConfig } from './config.js';
import { redactText } from './redact.js';

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
