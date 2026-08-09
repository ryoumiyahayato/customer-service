import { createReadStream } from 'node:fs';
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LocalStorageAdapter = {
  root: string;
  resolveObjectPath: (key: string) => string;
  ensureRoot: () => Promise<void>;
  statObject: (key: string) => Promise<{ size: number }>;
  writeObject: (key: string, content: Buffer) => Promise<void>;
  readObjectStream: (key: string) => ReturnType<typeof createReadStream>;
  deleteObject: (key: string) => Promise<void>;
};

export function createLocalStorage(rootPath: string): LocalStorageAdapter {
  const root = path.resolve(rootPath);

  function resolveObjectPath(key: string) {
    const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const target = path.resolve(root, normalizedKey);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('Invalid storage path.');
    }
    return target;
  }

  return {
    root,
    resolveObjectPath,
    async ensureRoot() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await chmod(root, 0o700);
      const info = await stat(root);
      if (!info.isDirectory()) throw new Error('Storage root is not a directory.');
    },
    async writeObject(key, content) {
      const target = resolveObjectPath(key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(target), 0o700);
      await writeFile(target, content, { mode: 0o600 });
      await chmod(target, 0o600);
    },
    async statObject(key) {
      const info = await stat(resolveObjectPath(key));
      if (!info.isFile()) throw new Error('Storage object is not a file.');
      return { size: info.size };
    },
    readObjectStream(key) {
      return createReadStream(resolveObjectPath(key));
    },
    async deleteObject(key) {
      const target = resolveObjectPath(key);
      await rm(target, { force: true });
    },
  };
}
