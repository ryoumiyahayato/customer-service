import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../api';
import './adminUnreadBadge.css';

type SessionSummary = { unreadCount?: number };
type SessionListResponse = { sessions?: SessionSummary[] };

function messageButtons() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('.desktop-tg-rail button, .mobile-bottom-nav button'),
  ].filter(button => button.textContent?.trim() === '消息');
}

export default function AdminUnreadBadge() {
  const [count, setCount] = useState(0);
  const [targets, setTargets] = useState<HTMLButtonElement[]>([]);

  const syncTargets = useCallback(() => {
    setTargets(messageButtons());
  }, []);

  const refresh = useCallback(async () => {
    if (!document.querySelector('.admin')) {
      setCount(0);
      return;
    }
    try {
      const response = await apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1', { retryGet: false });
      const unread = (response.sessions || []).reduce((sum, session) => sum + Math.max(0, Number(session.unreadCount || 0)), 0);
      setCount(unread);
    } catch {
      // Login transitions and replaced sessions are handled by the main admin surface.
    }
  }, []);

  useEffect(() => {
    syncTargets();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [syncTargets]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 1500);
    const onFocus = () => { void refresh(); };
    addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  if (!count || !targets.length) return null;
  const label = count > 99 ? '99+' : String(count);
  return <>{targets.map((target, index) => createPortal(<span className="admin-unread-badge" aria-label={`${count} 条未读消息`}>{label}</span>, target, `${index}`))}</>;
}
