import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQrMatrix } from '../../src/admin/inviteQr.ts';

const SAMPLE_URL = 'https://0123456789abcdef0123456789abcdef01234567.vx9qn7zr.org/';

test('invite QR encodes current one-time visitor URL shape', () => {
  const matrix = buildQrMatrix(SAMPLE_URL);
  assert.equal(matrix.length, 37);
  assert.ok(matrix.every(row => row.length === 37));
  assert.equal(matrix.flat().filter(Boolean).length, 686);
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[6][6], true);
  assert.equal(matrix[29][8], true);
});

test('invite QR rejects URLs larger than the fixed QR capacity', () => {
  assert.throws(() => buildQrMatrix(`https://example.com/${'a'.repeat(120)}`), /二维码链接过长/);
});
