import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../api';
import { sessionGroupOf, type ChatSession } from '../chatModel';
import './adminUnreadBadge.css';

type SessionListResponse = { sessions?: ChatSession[] };

export function useAdminUnreadCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || document.visibilityState !== 'visible' || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1', {
        retryGet: false,
        timeoutMs: 5000,
      });
      const unread = (response.sessions || [])
        .filter(session => sessionGroupOf(session) === 'active')
        .reduce((sum, session) => sum + Math.max(0, Number(session.unreadCount || 0)), 0);
      setCount(previous => previous === unread ? previous : unread);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setCount(0);
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh]);

  return count;
}

export function AdminUnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  const label = count > 99 ? '99+' : String(count);
  return <span className="admin-unread-badge" aria-label={`${count} 条未读消息`}>{label}</span>;
}
