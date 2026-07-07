import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getActiveAdminSessionId, messageBelongsToActiveSession } from './activeSessionGuard';
import { LoadingState, StatusBlock } from '../ui/StatusBlock';

type AdminMessageListProps<T> = {
  messages: T[];
  renderMessage: (message: T) => ReactNode;
  loading?: boolean;
  emptyText?: ReactNode;
  showEmpty?: boolean;
};

export default function AdminMessageList<T>({
  messages,
  renderMessage,
  loading = false,
  emptyText,
  showEmpty = false,
}: AdminMessageListProps<T>) {
  const activeSessionId = getActiveAdminSessionId();
  const filteredMessages = useMemo(
    () => activeSessionId ? messages.filter(message => messageBelongsToActiveSession(message, activeSessionId)) : messages,
    [activeSessionId, messages],
  );
  const hasCrossSessionMessages = Boolean(activeSessionId && messages.length > 0 && filteredMessages.length !== messages.length);
  const [safeSessionId, setSafeSessionId] = useState(activeSessionId);
  const [safeMessages, setSafeMessages] = useState<T[]>(filteredMessages);

  useEffect(() => {
    if (safeSessionId !== activeSessionId) {
      setSafeSessionId(activeSessionId);
      setSafeMessages(filteredMessages);
      return;
    }
    if (!hasCrossSessionMessages) setSafeMessages(filteredMessages);
  }, [activeSessionId, filteredMessages, hasCrossSessionMessages, safeSessionId]);

  const displayMessages = safeSessionId === activeSessionId ? safeMessages : filteredMessages;
  const waitingForActiveMessages = hasCrossSessionMessages && displayMessages.length === 0;
  const showLoading = loading || waitingForActiveMessages;

  return (
    <div className="msgs">
      {showLoading ? <LoadingState>正在加载会话消息...</LoadingState> : null}
      {!showLoading && showEmpty && displayMessages.length === 0 && emptyText ? <StatusBlock>{emptyText}</StatusBlock> : null}
      {!showLoading ? displayMessages.map(renderMessage) : null}
    </div>
  );
}
