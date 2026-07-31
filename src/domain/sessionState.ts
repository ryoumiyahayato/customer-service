export type ActiveSessionStatus = 'PENDING' | 'OPEN';
export type NormalizedSessionStatus = ActiveSessionStatus | 'ARCHIVED';
export type StoredSessionStatus = NormalizedSessionStatus | 'CLOSED';
export type SessionBucket = 'active' | 'archived' | 'trash' | 'purged';
export type SessionGroup = Exclude<SessionBucket, 'purged'>;

export type SessionStateInput = {
  status?: string | null;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
};

export function normalizeStoredStatus(status?: string | null): NormalizedSessionStatus {
  if (status === 'OPEN') return 'OPEN';
  if (status === 'PENDING') return 'PENDING';
  return 'ARCHIVED';
}

export function sessionBucketOf(session?: SessionStateInput | null): SessionBucket | null {
  if (!session) return null;
  if (session.purged_at) return 'purged';
  if (session.deleted_at) return 'trash';
  if (session.archived_at || session.status === 'ARCHIVED' || session.status === 'CLOSED') return 'archived';
  return 'active';
}

export function sessionGroupOf(session?: SessionStateInput | null): SessionGroup | null {
  const bucket = sessionBucketOf(session);
  return bucket === 'purged' ? null : bucket;
}

export function isArchivedSession(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function isSessionEnded(session?: SessionStateInput | null): boolean {
  const bucket = sessionBucketOf(session);
  return bucket === null || bucket !== 'active';
}

export function canSendMessage(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'active';
}

export function canArchive(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'active';
}

export function canUnarchive(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function canMoveToTrash(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function canRestore(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'trash';
}

export function canPurge(session?: SessionStateInput | null): boolean {
  return sessionBucketOf(session) === 'trash';
}

export function restoredActiveStatus(session: SessionStateInput): ActiveSessionStatus {
  return session.assigned_operator_id ? 'OPEN' : 'PENDING';
}
