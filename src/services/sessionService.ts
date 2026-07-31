import { DomainError } from '../http/errors';
import { SessionRepository, type SessionRecord } from '../repositories/sessionRepository';

export type SessionAction = 'assign' | 'close' | 'archive' | 'unarchive' | 'delete' | 'restore';
export type SessionActor = { id: string; role: string };

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly canManage: (actor: SessionActor, session: SessionRecord) => boolean,
  ) {}

  async execute(actor: SessionActor, sessionId: string, action: SessionAction, timestamp: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new DomainError('SESSION_NOT_FOUND', 404);
    if (!this.canManage(actor, session)) throw new DomainError('FORBIDDEN', 403);

    const result = action === 'assign'
      ? await this.assign(session, actor, timestamp)
      : action === 'close' || action === 'archive'
        ? await this.archive(session, actor, timestamp)
        : action === 'unarchive'
          ? await this.unarchive(session, timestamp)
          : action === 'delete'
            ? await this.moveToTrash(session, actor, timestamp)
            : await this.restore(session, timestamp);

    if (Number(result.meta?.changes || 0) !== 1) {
      throw new DomainError('SESSION_STATE_CONFLICT', 409);
    }
    const updated = await this.sessions.findById(sessionId);
    if (!updated) throw new DomainError('INTERNAL_ERROR', 500);
    return updated;
  }

  private assign(session: SessionRecord, actor: SessionActor, timestamp: string) {
    return this.sessions.assign(session.id, actor.id, timestamp);
  }

  private archive(session: SessionRecord, actor: SessionActor, timestamp: string) {
    return this.sessions.archive(session.id, actor.id, timestamp);
  }

  private unarchive(session: SessionRecord, timestamp: string) {
    return this.sessions.unarchive(session.id, timestamp);
  }

  private moveToTrash(session: SessionRecord, actor: SessionActor, timestamp: string) {
    return this.sessions.moveToTrash(session.id, actor.id, timestamp);
  }

  private restore(session: SessionRecord, timestamp: string) {
    return this.sessions.restore(session.id, timestamp);
  }
}
