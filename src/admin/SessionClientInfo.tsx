import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../api';
import type { ChatSession } from '../chatModel';
import { getActiveAdminSessionId } from './activeSessionGuard';
import './sessionClientInfo.css';

type SessionListResponse = { sessions?: ChatSession[] };

export default function SessionClientInfo() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [session, setSession] = useState<ChatSession | null>(null);

  useEffect(() => {
    const sync = () => {
      const activeId = getActiveAdminSessionId();
      const actionBar = document.querySelector('.admin .session-action-bar') as HTMLElement | null;
      setTarget(actionBar);
      setSessionId(activeId);
      if (!activeId) setSession(null);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener('focus', sync);
    return () => {
      observer.disconnect();
      removeEventListener('focus', sync);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1', { retryGet: false })
      .then((response) => {
        if (!active) return;
        setSession((response.sessions || []).find((item) => item.id === sessionId) || null);
      })
      .catch(() => { if (active) setSession(null); });
    return () => { active = false; };
  }, [sessionId]);

  if (!target || !session || session.id !== sessionId) return null;

  return createPortal(
    <details className="session-client-info">
      <summary>客户信息</summary>
      <dl>
        <div><dt>设备环境</dt><dd>{session.deviceLabel || '未知'}</dd></div>
        <div><dt>大致位置</dt><dd>{session.approximateLocation || '未知'}</dd></div>
        {session.ipAddress ? <div><dt>网络 IP</dt><dd>{session.ipAddress}</dd></div> : null}
      </dl>
      <small>
        {session.ipAddress
          ? '设备信息仅来自请求头中能够明确识别的字段；位置仅采用 Cloudflare 返回的粗粒度网络位置；IP 仅向超级管理员返回。'
          : '设备信息仅显示请求头中能够明确识别的字段，不猜测未知设备或应用版本；位置仅采用 Cloudflare 返回的粗粒度网络位置。'}
      </small>
    </details>,
    target,
  );
}
