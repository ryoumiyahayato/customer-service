import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiFetch } from '../api';
import { sessionGroupOf, type ChatSession } from '../chatModel';
import './adminUnreadBadge.css';

type SessionListResponse = { sessions?: ChatSession[] };

function messageButtons() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('.desktop-tg-rail button, .mobile-bottom-nav button'),
  ].filter(button => [...button.children].some(child => (
    child instanceof HTMLSpanElement
    && !child.classList.contains('admin-unread-badge')
    && child.textContent?.trim() === '消息'
  )));
}

function sameTargets(left: HTMLButtonElement[], right: HTMLButtonElement[]) {
  return left.length === right.length && left.every((target, index) => target === right[index]);
}

export default function AdminUnreadBadge() {
  const [count, setCount] = useState(0);
  const [targets, setTargets] = useState<HTMLButtonElement[]>([]);
  const requestInFlightRef = useRef(false);
  const authenticatedOnceRef = useRef(false);
  const reloadingRef = useRef(false);

  const syncTargets = useCallback(() => {
    const nextTargets = messageButtons();
    setTargets(previous => sameTargets(previous, nextTargets) ? previous : nextTargets);
  }, []);

  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible' || requestInFlightRef.current || reloadingRef.current) return;
    requestInFlightRef.current = true;
    try {
      const response = await apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1', {
        retryGet: false,
        timeoutMs: 5000,
      });
      authenticatedOnceRef.current = true;
      const unread = (response.sessions || [])
        .filter(session => sessionGroupOf(session) === 'active')
        .reduce((sum, session) => sum + Math.max(0, Number(session.unreadCount || 0)), 0);
      setCount(previous => previous === unread ? previous : unread);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCount(0);
        if (authenticatedOnceRef.current && !reloadingRef.current) {
          reloadingRef.current = true;
          window.location.reload();
        }
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    syncTargets();
    const timer = window.setInterval(syncTargets, 1000);
    const onResize = () => { syncTargets(); };
    addEventListener('resize', onResize);
    return () => {
      window.clearInterval(timer);
      removeEventListener('resize', onResize);
    };
  }, [syncTargets]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    const onFocus = () => { void refresh(); syncTargets(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        syncTargets();
      }
    };
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, syncTargets]);

  if (!count || !targets.length) return null;
  const label = count > 99 ? '99+' : String(count);
  return <>{targets.map(target => createPortal(
    <span className="admin-unread-badge" aria-label={`${count} 条未读消息`}>{label}</span>,
    target,
    target.closest('.desktop-tg-rail') ? 'desktop-unread' : 'mobile-unread',
  ))}</>;
}
