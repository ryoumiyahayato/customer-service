import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
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

  function currentIdentity() {
    return {
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gid: typeof process.getgid === 'function' ? process.getgid() : null,
    };
  }

  function unsafeRootError(detail: string): Error {
    return new Error(
      `Storage root permissions are unsafe. Expected owner-only access. ${detail} Fix the host directory ownership/mode before starting the service.`,
    );
  }

  function isNotFound(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
  }

  async function assertPrivateDirectory(target: string, label: string) {
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error(`${label} is not a directory.`);

    if (process.platform !== 'win32') {
      const mode = info.mode & 0o7777;
      const identity = currentIdentity();
      if (mode !== 0o700) throw unsafeRootError(`${label} must have mode 0700.`);
      if (identity.uid !== null && info.uid !== identity.uid) {
        throw unsafeRootError(`${label} must be owned by the application UID.`);
      }
      if (identity.gid !== null && info.gid !== identity.gid) {
        throw unsafeRootError(`${label} must use the application GID.`);
      }
    }

    try {
      await access(target, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      throw unsafeRootError(`${label} is not usable by the application process.`);
    }
  }

  async function assertPrivateFile(target: string, label: string) {
    const info = await stat(target);
    if (!info.isFile()) throw new Error(`${label} is not a regular file.`);

    if (process.platform !== 'win32') {
      const mode = info.mode & 0o7777;
      const identity = currentIdentity();
      if (mode !== 0o600) throw new Error(`${label} permissions are unsafe. Expected mode 0600.`);
      if (identity.uid !== null && info.uid !== identity.uid) {
        throw new Error(`${label} ownership is unsafe. Expected the application UID.`);
      }
      if (identity.gid !== null && info.gid !== identity.gid) {
        throw new Error(`${label} group ownership is unsafe. Expected the application GID.`);
      }
    }
  }

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
      await assertPrivateDirectory(root, 'Storage root');
    },
    async writeObject(key, content) {
      const target = resolveObjectPath(key);
      const directory = path.dirname(target);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(directory, 'Storage object directory');

      try {
        await assertPrivateFile(target, 'Existing storage object');
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }

      await writeFile(target, content, { mode: 0o600 });
      await assertPrivateFile(target, 'Storage object');
    },
    async statObject(key) {
      const target = resolveObjectPath(key);
      await assertPrivateFile(target, 'Storage object');
      const info = await stat(target);
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
