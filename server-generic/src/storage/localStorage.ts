import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type LocalStorageAdapter = {
  root: string;
  resolveObjectPath: (key: string) => string;
  ensureRoot: () => Promise<void>;
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
      await mkdir(root, { recursive: true });
      const info = await stat(root);
      if (!info.isDirectory()) throw new Error('Storage root is not a directory.');
    },
  };
}
