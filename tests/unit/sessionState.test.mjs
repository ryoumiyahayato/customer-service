import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canArchive,
  canMoveToTrash,
  canPurge,
  canRestore,
  canSendMessage,
  canUnarchive,
  isSessionEnded,
  normalizeStoredStatus,
  restoredActiveStatus,
  sessionBucketOf,
  sessionGroupOf,
} from '../../src/domain/sessionState.ts';

const activePending = { status: 'PENDING' };
const activeOpen = { status: 'OPEN', assigned_operator_id: 'admin_1' };
const archived = { status: 'ARCHIVED', archived_at: '2026-07-31T00:00:00.000Z' };
const legacyClosed = { status: 'CLOSED' };
const trash = { ...archived, deleted_at: '2026-07-31T01:00:00.000Z' };
const purged = { ...trash, purged_at: '2026-07-31T02:00:00.000Z' };

test('classifies active, archived, trash and purged sessions with precedence', () => {
  assert.equal(sessionBucketOf(activePending), 'active');
  assert.equal(sessionBucketOf(activeOpen), 'active');
  assert.equal(sessionBucketOf(archived), 'archived');
  assert.equal(sessionBucketOf(legacyClosed), 'archived');
  assert.equal(sessionBucketOf(trash), 'trash');
  assert.equal(sessionBucketOf(purged), 'purged');
  assert.equal(sessionBucketOf(null), null);
});

test('hides purged sessions from UI groups while preserving other buckets', () => {
  assert.equal(sessionGroupOf(activePending), 'active');
  assert.equal(sessionGroupOf(archived), 'archived');
  assert.equal(sessionGroupOf(trash), 'trash');
  assert.equal(sessionGroupOf(purged), null);
});

test('treats CLOSED only as legacy archived compatibility data', () => {
  assert.equal(normalizeStoredStatus('CLOSED'), 'ARCHIVED');
  assert.equal(normalizeStoredStatus('ARCHIVED'), 'ARCHIVED');
  assert.equal(normalizeStoredStatus('OPEN'), 'OPEN');
  assert.equal(normalizeStoredStatus('PENDING'), 'PENDING');
});

test('restores archived sessions to OPEN when assigned and PENDING when unassigned', () => {
  assert.equal(restoredActiveStatus({ ...archived, assigned_operator_id: 'admin_1' }), 'OPEN');
  assert.equal(restoredActiveStatus({ ...archived, assigned_operator_id: null }), 'PENDING');
});

test('allows messages and archive only for active sessions', () => {
  assert.equal(canSendMessage(activePending), true);
  assert.equal(canSendMessage(activeOpen), true);
  assert.equal(canSendMessage(archived), false);
  assert.equal(canSendMessage(trash), false);
  assert.equal(canSendMessage(purged), false);
  assert.equal(canArchive(activeOpen), true);
  assert.equal(canArchive(archived), false);
});

test('allows lifecycle actions only from their declared source buckets', () => {
  assert.equal(canUnarchive(archived), true);
  assert.equal(canUnarchive(activeOpen), false);
  assert.equal(canMoveToTrash(archived), true);
  assert.equal(canMoveToTrash(trash), false);
  assert.equal(canRestore(trash), true);
  assert.equal(canRestore(archived), false);
  assert.equal(canPurge(trash), true);
  assert.equal(canPurge(purged), false);
});

test('reports all non-active states as ended', () => {
  assert.equal(isSessionEnded(activePending), false);
  assert.equal(isSessionEnded(activeOpen), false);
  assert.equal(isSessionEnded(archived), true);
  assert.equal(isSessionEnded(legacyClosed), true);
  assert.equal(isSessionEnded(trash), true);
  assert.equal(isSessionEnded(purged), true);
  assert.equal(isSessionEnded(null), true);
});
