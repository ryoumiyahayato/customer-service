import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canArchive,
  canSendMessage,
  isSessionEnded,
  sessionBucketOf,
} from '../../src/domain/sessionState.ts';

test('treats unrecognized or missing stored states as ended', () => {
  for (const session of [
    { status: 'UNKNOWN' },
    { status: 'BROKEN' },
    { status: '' },
    { status: null },
    { status: undefined },
    {},
  ]) {
    assert.equal(sessionBucketOf(session), 'archived');
    assert.equal(canSendMessage(session), false);
    assert.equal(canArchive(session), false);
    assert.equal(isSessionEnded(session), true);
  }

  assert.equal(sessionBucketOf({ status: 'PENDING' }), 'active');
  assert.equal(sessionBucketOf({ status: 'OPEN' }), 'active');
  assert.equal(sessionBucketOf({ status: 'CLOSED' }), 'archived');
});
