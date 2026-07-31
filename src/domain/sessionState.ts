export type ActiveSessionStatus = 'PENDING' | 'OPEN';
export type NormalizedSessionStatus = ActiveSessionStatus | 'ARCHIVED';
export type StoredSessionStatus = NormalizedSessionStatus | 'CLOSED';
export type SessionBucket = 'active' | 'archived' | 'trash' | 'purged';
export type SessionGroup = Exclude<SessionBucket, 'purged'>;

export type SessionStateInput = {
  status?: string | null;
  assignedOperatorId?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  purgedAt?: string | null;
};

export type StoredSessionStateInput = {
  status?: string | null;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
};

export type SessionStateLike = SessionStateInput | StoredSessionStateInput;

function canonicalState(session: SessionStateLike): SessionStateInput {
  const stored = session as StoredSessionStateInput;
  const domain = session as SessionStateInput;
  return {
    status: session.status,
    assignedOperatorId: domain.assignedOperatorId ?? stored.assigned_operator_id ?? null,
    archivedAt: domain.archivedAt ?? stored.archived_at ?? null,
    deletedAt: domain.deletedAt ?? stored.deleted_at ?? null,
    purgedAt: domain.purgedAt ?? stored.purged_at ?? null,
  };
}

export function normalizeStoredStatus(status?: string | null): NormalizedSessionStatus {
  if (status === 'OPEN') return 'OPEN';
  if (status === 'PENDING') return 'PENDING';
  return 'ARCHIVED';
}

export function sessionBucketOf(session?: SessionStateLike | null): SessionBucket | null {
  if (!session) return null;
  const state = canonicalState(session);
  if (state.purgedAt) return 'purged';
  if (state.deletedAt) return 'trash';
  if (state.archivedAt || state.status === 'ARCHIVED' || state.status === 'CLOSED') {
    return 'archived';
  }
  if (state.status === 'PENDING' || state.status === 'OPEN') {
    return 'active';
  }
  return 'archived';
}

export function sessionGroupOf(session?: SessionStateLike | null): SessionGroup | null {
  const bucket = sessionBucketOf(session);
  return bucket === 'purged' ? null : bucket;
}

export function isArchivedSession(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function isSessionEnded(session?: SessionStateLike | null): boolean {
  const bucket = sessionBucketOf(session);
  return bucket === null || bucket !== 'active';
}

export function canSendMessage(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'active';
}

export function canArchive(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'active';
}

export function canUnarchive(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function canMoveToTrash(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'archived';
}

export function canRestore(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'trash';
}

export function canPurge(session?: SessionStateLike | null): boolean {
  return sessionBucketOf(session) === 'trash';
}

export function restoredActiveStatus(session: SessionStateLike): ActiveSessionStatus {
  return canonicalState(session).assignedOperatorId ? 'OPEN' : 'PENDING';
}
