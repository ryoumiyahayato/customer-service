import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createLocalStorage } = await import('../../server-generic/src/storage/localStorage.ts');

test('local storage creates private objects and refuses unsafe existing roots', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX owner and mode checks are validated in the Linux Docker smoke');
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'customer-chat-storage-'));
  const unsafeRoot = await mkdtemp(path.join(os.tmpdir(), 'customer-chat-storage-unsafe-'));
  try {
    const storage = createLocalStorage(root);
    await storage.ensureRoot();
    assert.equal((await stat(root)).mode & 0o7777, 0o700);

    await storage.writeObject('attachments/smoke.bin', Buffer.from('private attachment'));
    const directory = path.join(root, 'attachments');
    const object = path.join(directory, 'smoke.bin');
    assert.equal((await stat(directory)).mode & 0o7777, 0o700);
    assert.equal((await stat(object)).mode & 0o7777, 0o600);

    await chmod(unsafeRoot, 0o755);
    await assert.rejects(
      createLocalStorage(unsafeRoot).ensureRoot(),
      /Storage root permissions are unsafe.*Expected owner-only access/,
    );

    const unsafeObject = path.join(root, 'attachments', 'unsafe.bin');
    await writeFile(unsafeObject, 'must not be overwritten', { mode: 0o644 });
    await assert.rejects(storage.writeObject('attachments/unsafe.bin', Buffer.from('replacement')), /permissions are unsafe/);
    assert.equal(await readFile(unsafeObject, 'utf8'), 'must not be overwritten');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(unsafeRoot, { recursive: true, force: true });
  }
});
