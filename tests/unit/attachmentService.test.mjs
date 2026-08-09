import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const { AttachmentService } = await import('../../src/services/attachmentService.ts');

function imageFile() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'image.jpg', { type: 'image/jpeg' });
}

test('deletes the uploaded R2 object when the database record cannot be created', async () => {
  const inserted = new Error('database unavailable');
  const uploads = {
    putCalls: [],
    deleteCalls: [],
    async put(key) { this.putCalls.push(key); },
    async delete(key) { this.deleteCalls.push(key); },
  };
  const attachments = {
    async insert() { throw inserted; },
  };
  const service = new AttachmentService(
    attachments,
    uploads,
    () => 'att_1',
    () => '2026-07-31T00:00:00.000Z',
  );

  await assert.rejects(
    service.upload({
      sessionId: 'sess_1',
      file: imageFile(),
      createdByType: 'VISITOR',
      createdById: 'visitor_1',
    }),
    (error) => error === inserted,
  );
  assert.equal(uploads.putCalls.length, 1);
  assert.deepEqual(uploads.deleteCalls, uploads.putCalls);
});

test('keeps the R2 object after a successful database insert', async () => {
  const uploads = {
    putCalls: [],
    deleteCalls: [],
    async put(key) { this.putCalls.push(key); },
    async delete(key) { this.deleteCalls.push(key); },
  };
  const attachments = {
    inserts: [],
    async insert(value) { this.inserts.push(value); },
  };
  const service = new AttachmentService(
    attachments,
    uploads,
    () => 'att_1',
    () => '2026-07-31T00:00:00.000Z',
  );

  const result = await service.upload({
    sessionId: 'sess_1',
    file: imageFile(),
    createdByType: 'VISITOR',
    createdById: 'visitor_1',
  });
  assert.equal(uploads.putCalls.length, 1);
  assert.equal(uploads.deleteCalls.length, 0);
  assert.equal(attachments.inserts.length, 1);
  assert.equal(result.path, `/api/attachments/${uploads.putCalls[0]}`);
});

test('reserves attachment quota before R2 and releases it when the upload fails', async () => {
  const events = [];
  const uploads = {
    async put() { events.push('put'); throw new Error('R2 unavailable'); },
    async delete() { events.push('delete'); },
  };
  const attachments = {
    async reserve() { events.push('reserve'); },
    async releaseReservation() { events.push('release'); },
  };
  const service = new AttachmentService(
    attachments,
    uploads,
    () => 'att-failed',
    () => '2026-07-31T00:00:00.000Z',
  );

  await assert.rejects(
    service.upload({
      sessionId: 'sess-1',
      file: imageFile(),
      createdByType: 'VISITOR',
      createdById: 'visitor-1',
    }),
    /R2 unavailable/,
  );
  assert.deepEqual(events, ['reserve', 'put', 'release', 'delete']);
});
