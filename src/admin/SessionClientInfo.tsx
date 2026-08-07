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
        <div><dt>设备</dt><dd>{session.deviceLabel || '未识别'}</dd></div>
        <div><dt>大致位置</dt><dd>{session.approximateLocation || '未提供'}</dd></div>
        {session.ipAddress ? <div><dt>网络 IP</dt><dd>{session.ipAddress}</dd></div> : null}
      </dl>
      <small>{session.ipAddress ? 'IP 只在超级管理员响应中返回；普通客服无法通过会话列表 API 获取。' : '位置来自 Cloudflare 网络边缘的城市/地区级推测；普通客服不返回访客 IP。'}</small>
    </details>,
    target,
  );
}