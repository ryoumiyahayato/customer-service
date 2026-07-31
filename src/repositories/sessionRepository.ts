export type SessionRecord = {
  id: string;
  user_id: string;
  status: string;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
  [key: string]: unknown;
};

export type SqlRunResult = {
  meta?: {
    changes?: number | null;
  };
};

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T>(): Promise<T | null> | T | null;
  run(): Promise<SqlRunResult> | SqlRunResult;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

export class SessionRepository {
  constructor(private readonly database: SqlDatabase) {}

  findById(sessionId: string) {
    return this.database.prepare('SELECT * FROM sessions WHERE id=?')
      .bind(sessionId)
      .first<SessionRecord>();
  }

  assign(
    sessionId: string,
    actorId: string,
    timestamp: string,
    expectedOperatorId: string | null = null,
  ) {
    return this.database.prepare(
      `UPDATE sessions
          SET assigned_operator_id=?,
              last_operator_id=?,
              status='OPEN',
              updated_at=?
        WHERE id=?
          AND deleted_at IS NULL
          AND purged_at IS NULL
          AND archived_at IS NULL
          AND status IN ('PENDING','OPEN')
          AND (? IS NULL OR assigned_operator_id=?)`,
    ).bind(actorId, actorId, timestamp, sessionId, expectedOperatorId, expectedOperatorId).run();
  }

  archive(
    sessionId: string,
    actorId: string,
    timestamp: string,
    expectedOperatorId: string | null = null,
  ) {
    return this.database.prepare(
      `UPDATE sessions
          SET status='ARCHIVED',
              closed_at=COALESCE(closed_at,?),
              archived_at=COALESCE(archived_at,?),
              archived_by=?,
              updated_at=?
        WHERE id=?
          AND deleted_at IS NULL
          AND purged_at IS NULL
          AND archived_at IS NULL
          AND status IN ('PENDING','OPEN')
          AND (? IS NULL OR assigned_operator_id=?)`,
    ).bind(timestamp, timestamp, actorId, timestamp, sessionId, expectedOperatorId, expectedOperatorId).run();
  }

  unarchive(
    sessionId: string,
    timestamp: string,
    expectedOperatorId: string | null = null,
  ) {
    return this.database.prepare(
      `UPDATE sessions
          SET archived_at=NULL,
              archived_by=NULL,
              closed_at=NULL,
              status=CASE WHEN assigned_operator_id IS NULL THEN 'PENDING' ELSE 'OPEN' END,
              updated_at=?
        WHERE id=?
          AND deleted_at IS NULL
          AND purged_at IS NULL
          AND (archived_at IS NOT NULL OR status IN ('ARCHIVED','CLOSED'))
          AND (? IS NULL OR assigned_operator_id=?)`,
    ).bind(timestamp, sessionId, expectedOperatorId, expectedOperatorId).run();
  }

  moveToTrash(
    sessionId: string,
    actorId: string,
    timestamp: string,
    expectedOperatorId: string | null = null,
  ) {
    return this.database.prepare(
      `UPDATE sessions
          SET status='ARCHIVED',
              archived_at=COALESCE(archived_at,?),
              closed_at=COALESCE(closed_at,?),
              deleted_at=?,
              deleted_by=?,
              updated_at=?
        WHERE id=?
          AND deleted_at IS NULL
          AND purged_at IS NULL
          AND (archived_at IS NOT NULL OR status IN ('ARCHIVED','CLOSED'))
          AND (? IS NULL OR assigned_operator_id=?)`,
    ).bind(
      timestamp,
      timestamp,
      timestamp,
      actorId,
      timestamp,
      sessionId,
      expectedOperatorId,
      expectedOperatorId,
    ).run();
  }

  restore(
    sessionId: string,
    timestamp: string,
    expectedOperatorId: string | null = null,
  ) {
    return this.database.prepare(
      `UPDATE sessions
          SET deleted_at=NULL,
              deleted_by=NULL,
              status='ARCHIVED',
              archived_at=COALESCE(archived_at,?),
              closed_at=COALESCE(closed_at,?),
              updated_at=?
        WHERE id=?
          AND deleted_at IS NOT NULL
          AND purged_at IS NULL
          AND (? IS NULL OR assigned_operator_id=?)`,
    ).bind(timestamp, timestamp, timestamp, sessionId, expectedOperatorId, expectedOperatorId).run();
  }
}
