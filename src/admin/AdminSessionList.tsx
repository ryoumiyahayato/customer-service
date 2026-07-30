import { StatusBlock } from '../ui/StatusBlock';
import type { ChatSession, SessionGroup } from '../chatModel';
import { setActiveAdminSessionId } from './activeSessionGuard';

type Session = ChatSession;

type AdminSessionListProps = {
  sessions: Session[];
  currentSessionId?: string;
  sessionGroup: SessionGroup;
  sessionGroupCounts: Record<SessionGroup, number>;
  onGroupChange: (group: SessionGroup) => void;
  onSelectSession: (session: Session) => void;
  customerAvatar: (session: Session) => string;
  customerName: (session: Session) => string;
  formatTime: (value?: string) => string;
  maxItems?: number;
  listClassName?: string;
  tabsClassName?: string;
  emptyClassName?: string;
};

const sessionGroups: Array<{ key: SessionGroup; label: string }> = [
  { key: 'active', label: '进行中' },
  { key: 'archived', label: '已归档' },
  { key: 'trash', label: '回收站' },
];

export default function AdminSessionList({
  sessions,
  currentSessionId,
  sessionGroup,
  sessionGroupCounts,
  onGroupChange,
  onSelectSession,
  customerAvatar,
  customerName,
  formatTime,
  maxItems,
  listClassName,
  tabsClassName,
  emptyClassName,
}: AdminSessionListProps) {
  const visibleSessions = typeof maxItems === 'number' ? sessions.slice(0, maxItems) : sessions;

  function selectSession(session: Session) {
    setActiveAdminSessionId(session.id);
    onSelectSession(session);
  }

  return (
    <>
      <div className={`session-group-tabs${tabsClassName ? ` ${tabsClassName}` : ''}`}>
        {sessionGroups.map(group => (
          <button
            key={group.key}
            type="button"
            className={sessionGroup === group.key ? 'active' : ''}
            onClick={() => onGroupChange(group.key)}
          >
            {group.label} <b>{sessionGroupCounts[group.key]}</b>
          </button>
        ))}
      </div>
      <div className={listClassName}>
        {visibleSessions.map(session => (
          <button
            type="button"
            key={session.id}
            className={`session conversation-item${currentSessionId === session.id ? ' active' : ''}`}
            onClick={() => selectSession(session)}
          >
            <div className="avatar-dot">{customerAvatar(session)}</div>
            <div className="session-main"><b>{customerName(session)}</b><p>{session.deleted_at ? '回收站' : session.archived_at || session.status === 'ARCHIVED' || session.status === 'CLOSED' ? '已归档' : '进行中'}</p></div>
            <div className="session-meta">
              <small>{formatTime(session.updated_at)}</small>
              {(session.unread_count ?? 0) > 0 && <span className="badge">{session.unread_count}</span>}
            </div>
          </button>
        ))}
        {sessions.length === 0 && <StatusBlock className={emptyClassName}>当前分组暂无会话</StatusBlock>}
      </div>
    </>
  );
}
