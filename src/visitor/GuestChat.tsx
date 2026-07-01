import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { apiFetch } from '../api';
import LinkExpired from '../common/LinkExpired';
import '../styles.css';

type Message = any;
type Session = any;

const formatTime = (ts?: string) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const INVITE_NOT_FOUND = 'invite-not-found';
const SERVER_ERROR_TEXT = '\u670d\u52a1\u5668\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
const SESSION_ENDED_ERROR = '\u4f1a\u8bdd\u5df2\u7ed3\u675f';
const inviteConsumeRequests = new Map<string, Promise<any>>();
const newClientMessageId = () => `cm_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const localMessageId = (clientMessageId: string) => `local-${clientMessageId}`;
const isMessageCreatedEvent = (type?: string) => type === 'message:new' || type === 'message_created';
const mergeMessage = (messages: Message[], message?: Message) => {
  if (!message) return messages;
  const idx = messages.findIndex(m =>
    (message.id && m.id === message.id) ||
    (message.client_message_id && m.client_message_id === message.client_message_id)
  );
  if (idx < 0) return [...messages, message];
  const next = messages.slice();
  next[idx] = message;
  return next;
};
const mergeMessages = (messages: Message[], incoming: Message[] = []) => incoming.reduce(mergeMessage, messages);
const markMessageFailed = (messages: Message[], id: string) => messages.map(m => m.id === id ? { ...m, status: 'failed' } : m);
const lastServerMessageTime = (messages: Message[]) => messages.reduce((latest, msg) => {
  if (!msg.created_at || String(msg.id || '').startsWith('local-') || msg.status === 'sending' || msg.status === 'failed') return latest;
  return !latest || msg.created_at > latest ? msg.created_at : latest;
}, '');
const fallbackDelay = (misses: number) => misses < 3 ? 2000 : misses < 12 ? 5000 : 10000;
const chatMetric = (name: string, started: number, extra?: Record<string, number | string>) => {
  try { console.debug('[chat_metric]', name, Math.round(performance.now() - started), extra || {}); } catch {}
};
const isNotFoundStatus = (status?: number) => status === 401 || status === 403 || status === 404 || status === 410;
const isSessionGoneError = (error: any) => isNotFoundStatus(error?.status) || (error?.status === 400 && error?.data?.error === SESSION_ENDED_ERROR);
const sessionUnavailable = (session?: any) => !session || session.deleted_at || session.status === 'CLOSED' || session.status === 'ARCHIVED';

/* ========== VISITOR CHAT PAGE ========== */
function VisitorChat({ inviteToken }: { inviteToken?: string } = {}) {
  const [sessionId, setSessionId] = useState<string>(() => localStorage.getItem('chat_session_id') || '');
  const [visitorId, setVisitorId] = useState<string>(() => localStorage.getItem('chat_visitor_id') || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<'idle' | 'text' | 'image'>('idle');
  const [online, setOnline] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [networkBanner, setNetworkBanner] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [quote, setQuote] = useState<Message | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [recallLoading, setRecallLoading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');
  const [accessError, setAccessError] = useState('');
  const resolvedInviteToken = useMemo(() => {
    if (inviteToken) return inviteToken;
    const m = location.pathname.match(/^\/g\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }, [inviteToken]);
  const sendingRef = useRef(false);
  const consumeStartedRef = useRef(false);
  const sessionClosedRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const onlineRef = useRef(false);
  const fallbackMissesRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<any>(null);
  const fallbackTimer = useRef<any>(null);

  useEffect(() => { const on = () => setIsMobile(window.innerWidth < 768); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  useEffect(() => { const tou = () => setIsMobile(true); addEventListener('touchstart', tou, { once: true }); return () => removeEventListener('touchstart', tou); }, []);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { onlineRef.current = online; }, [online]);

  const showNotFound = useCallback(() => {
    sessionClosedRef.current = true;
    setAccessError(INVITE_NOT_FOUND);
    setConnecting(false);
    setOnline(false);
    setReconnecting(false);
    setSessionClosed(true);
    setMessages([]);
    setText('');
    setQuote(null);
    localStorage.removeItem('chat_session_id');
    clearTimeout(reconnectTimer.current);
    clearTimeout(fallbackTimer.current);
    wsRef.current?.close();
  }, []);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);
  const focusMessageInput = useCallback(() => {
    messageInputRef.current?.focus();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      setTimeout(() => messageInputRef.current?.focus(), 0);
    });
  }, []);

  const connect = useCallback(async () => {
    try {
      if (!resolvedInviteToken) {
        showNotFound();
        return null;
      }
      if (consumeStartedRef.current) return sessionId || null;
      consumeStartedRef.current = true;
      const endpoint = `/api/guest/${encodeURIComponent(resolvedInviteToken)}`;
      let request = inviteConsumeRequests.get(resolvedInviteToken);
      if (!request) {
        request = apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ visitorId }) });
        inviteConsumeRequests.set(resolvedInviteToken, request);
      }
      const res: any = await request;
      if (sessionUnavailable(res.session)) {
        showNotFound();
        return null;
      }
      if (res.visitorId && res.visitorId !== visitorId) { setVisitorId(res.visitorId); localStorage.setItem('chat_visitor_id', res.visitorId); }
      if (res.session) { setSessionId(res.session.id); localStorage.setItem('chat_session_id', res.session.id); }
      if (res.messages) setMessages(mergeMessages([], res.messages));
      sessionClosedRef.current = false;
      setSessionClosed(false);
      setAccessError(''); setOnline(false); setConnecting(false);
      return res.session?.id;
    } catch (e: any) {
      if (!isNotFoundStatus(e?.status)) inviteConsumeRequests.delete(resolvedInviteToken);
      if (isNotFoundStatus(e?.status)) {
        showNotFound();
        return null;
      }
      setAccessError(e?.message || SERVER_ERROR_TEXT);
      setConnecting(false);
      setOnline(false);
      return null;
    }
  }, [visitorId, resolvedInviteToken, sessionId, showNotFound]);

  useEffect(() => { connect(); }, [connect]);

  const wsConnect = useCallback((sid: string) => {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const connectStarted = performance.now();
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/conversations/${sid}`);
    ws.onopen = () => { chatMetric('ws_connect_ms', connectStarted); clearTimeout(fallbackTimer.current); fallbackMissesRef.current = 0; setOnline(true); setReconnecting(false); };
    ws.onclose = (e) => { try { console.debug('[chat_metric]', 'ws_close_code', e.code, { reason_length: e.reason?.length || 0 }); } catch {} setOnline(false); if (sessionClosedRef.current) { setReconnecting(false); return; } setReconnecting(true); reconnectTimer.current = setTimeout(() => wsConnect(sid), 5000); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (isMessageCreatedEvent(d.type)) { setMessages(prev => mergeMessage(prev, d.message)); }
        else if (d.type === 'message:updated') { setMessages(prev => mergeMessage(prev, d.message)); }
        else if (d.type === 'message:deleted') { setMessages(prev => prev.map(m => m.id === d.messageId ? { ...m, deleted_at: new Date().toISOString() } : m)); }
        else if (d.type === 'session:updated' && sessionUnavailable(d.session)) { showNotFound(); ws.close(); }
      } catch {}
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [showNotFound]);

  useEffect(() => { if (connecting || accessError || sessionClosed || !sessionId) return; wsConnect(sessionId); return () => { if (wsRef.current) wsRef.current.onclose = null; wsRef.current?.close(); clearTimeout(reconnectTimer.current); }; }, [accessError, connecting, sessionClosed, sessionId, wsConnect]);

  const syncMessages = useCallback(async (sid: string) => {
    const started = performance.now();
    const after = lastServerMessageTime(messagesRef.current);
    const url = `/api/sessions/${encodeURIComponent(sid)}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const res: any = await apiFetch(url, { retryGet: false });
    const count = Array.isArray(res?.messages) ? res.messages.length : 0;
    chatMetric('fallback_fetch_ms', started, { merge_messages_count: count });
    if (count) setMessages(prev => mergeMessages(prev, res.messages));
    return count;
  }, []);

  const scheduleFallback = useCallback((sid: string, delay = 0) => {
    clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(async () => {
      if (!sid || sessionClosedRef.current || onlineRef.current) return;
      try {
        const count = await syncMessages(sid);
        fallbackMissesRef.current = count ? 0 : fallbackMissesRef.current + 1;
      } catch (e: any) {
        fallbackMissesRef.current += 1;
        if (isSessionGoneError(e)) { showNotFound(); return; }
      }
      if (!sessionClosedRef.current && !onlineRef.current) scheduleFallback(sid, fallbackDelay(fallbackMissesRef.current));
    }, delay);
  }, [showNotFound, syncMessages]);

  useEffect(() => {
    clearTimeout(fallbackTimer.current);
    if (connecting || accessError || sessionClosed || !sessionId || online) return;
    fallbackMissesRef.current = 0;
    scheduleFallback(sessionId, 0);
    return () => clearTimeout(fallbackTimer.current);
  }, [accessError, connecting, online, scheduleFallback, sessionClosed, sessionId]);

  useEffect(() => {
    const syncIfVisible = () => {
      if (document.visibilityState === 'hidden' || !sessionId || online || sessionClosed || accessError) return;
      syncMessages(sessionId).catch((e: any) => { if (isSessionGoneError(e)) showNotFound(); });
    };
    addEventListener('focus', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);
    return () => { removeEventListener('focus', syncIfVisible); document.removeEventListener('visibilitychange', syncIfVisible); };
  }, [accessError, online, sessionClosed, sessionId, showNotFound, syncMessages]);

  useEffect(() => { const f = (e: StorageEvent) => { if (e.key === 'chat_visitor_id' && e.newValue && e.newValue !== visitorId) window.location.reload(); }; addEventListener('storage', f); return () => removeEventListener('storage', f); }, [visitorId]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (networkBanner) { const t = setTimeout(() => setNetworkBanner(false), 10000); return () => clearTimeout(t); } }, [networkBanner]);

  const send = async () => {
    if (accessError || sessionClosed || !sessionId) return;
    const content = text.trim();
    if (!content && !quote) return;
    const currentQuote = quote;
    const clientMessageId = newClientMessageId();
    const tempId = localMessageId(clientMessageId);
    const optimisticMessage = {
      id: tempId,
      session_id: sessionId,
      sender_type: 'VISITOR',
      sender_id: visitorId,
      content,
      message_type: 'text',
      image_path: null,
      status: 'sending',
      created_at: new Date().toISOString(),
      read_at: null,
      is_read: 0,
      quote_message_id: currentQuote?.id || null,
      client_message_id: clientMessageId
    };
    setMessages(prev => mergeMessage(prev, optimisticMessage));
    setText('');
    setQuote(null);
    focusMessageInput();
    try {
      const postStarted = performance.now();
      const res: any = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content, senderType: 'VISITOR', quoteMessageId: currentQuote?.id || null }) });
      chatMetric('api_post_total_ms', postStarted);
      if (res?.message) setMessages(prev => mergeMessage(prev, res.message));
      syncMessages(sessionId).catch((e: any) => { if (isSessionGoneError(e)) showNotFound(); });
    } catch (e: any) { if (isSessionGoneError(e)) { showNotFound(); } else { setMessages(prev => markMessageFailed(prev, tempId)); showToast(e?.message || '发送失败'); setNetworkBanner(true); } }
  };

  const upload = async (file: File) => {
    if (accessError || sessionClosed || !sessionId || sending === 'image') return;
    let tempId = '';
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', sessionId);
      const res: any = await apiFetch(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', body: fd });
      tempId = localMessageId(clientMessageId);
      setMessages(prev => mergeMessage(prev, { id: tempId, session_id: sessionId, sender_type: 'VISITOR', sender_id: visitorId, content: '', message_type: 'image', image_path: res.path, status: 'sending', created_at: new Date().toISOString(), read_at: null, is_read: 0, quote_message_id: null, client_message_id: clientMessageId }));
      const msgRes: any = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'VISITOR' }) });
      if (msgRes?.message) setMessages(prev => mergeMessage(prev, msgRes.message));
    } catch (e: any) { if (isSessionGoneError(e)) { showNotFound(); } else { if (tempId) setMessages(prev => markMessageFailed(prev, tempId)); showToast(e?.message || '发送失败'); setNetworkBanner(true); } }
    sendingRef.current = false; setSending('idle');
  };

  const doDelete = async (msg: Message) => {
    if (deleteLoading) return; setDeleteLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/delete`, { method: 'POST' }); }
    catch (e: any) { if (isSessionGoneError(e)) showNotFound(); else showToast(e?.message || '删除失败'); }
    setDeleteLoading(null);
  };

  const doRecall = async (msg: Message) => {
    if (recallLoading) return; setRecallLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/recall`, { method: 'POST' }); }
    catch (e: any) { if (isSessionGoneError(e)) showNotFound(); else showToast(e?.message || '撤回失败'); }
    setRecallLoading(null);
  };

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => { e.preventDefault(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); };
  const handleLongPress = useCallback((msg: Message) => (e: React.TouchEvent) => {
    const timer = setTimeout(() => { setContextMenu({ msg, x: e.touches[0].clientX, y: e.touches[0].clientY }); }, 500);
    const clear = () => { clearTimeout(timer); e.target?.removeEventListener('touchend', clear); e.target?.removeEventListener('touchmove', clear); };
    e.target.addEventListener('touchend', clear, { once: true }); e.target.addEventListener('touchmove', clear, { once: true });
  }, []);

  const isOwn = (m: Message) => m.sender_type === 'VISITOR';
  const menuItems = (msg: Message) => {
    const items: { label: string; action: () => void; disabled?: boolean }[] = [];
    if (msg.status !== 'recalled') items.push({ label: '引用', action: () => { setQuote(msg); setContextMenu(null); } });
    if (isOwn(msg) && msg.status !== 'recalled') items.push({ label: '撤回', action: () => { doRecall(msg); setContextMenu(null); }, disabled: recallLoading === msg.id });
    if (isOwn(msg) && !msg.deleted_at) items.push({ label: '删除', action: () => { doDelete(msg); setContextMenu(null); }, disabled: deleteLoading === msg.id });
    return items;
  };

  if (accessError === INVITE_NOT_FOUND || sessionClosed) return <LinkExpired />;
  // Do not render loading/spinner before token/session validation
  if (connecting) return null;
  if (accessError) return <div className="chat-gate-page">{accessError}</div>;

  return (
    <div className={`chat-page${!isMobile ? ' is-desktop' : ''}`}>
      <header className="chat-header">
        <div className="status-light"><span className="status-dot" style={{ background: online ? '#22c55e' : '#94a3b8', color: online ? '#22c55e' : '#94a3b8' }} />{reconnecting ? '重连中...' : online ? '在线客服' : '连接中...'}</div>
        <div className="header-right">
        </div>
      </header>
      {networkBanner && <div className="network-banner">网络不稳定，部分操作可能失败 <button onClick={() => setNetworkBanner(false)}>关闭</button></div>}
      {toast && <div className="network-banner">{toast} <button onClick={() => setToast('')}>关闭</button></div>}
      <div className="msgs">
        {messages.length === 0 && <div className="empty-state">你好！有什么可以帮助你的？</div>}
        {messages.map(m => (
          m.deleted_at ? (
            <div key={m.id} className={'msg ' + (isOwn(m) ? 'user' : 'agent')}><span className="recalled">消息已删除</span></div>
          ) : (
            <div key={m.id} className={'msg ' + (isOwn(m) ? 'user' : 'agent')} onContextMenu={(e) => handleContextMenu(e, m)}
              onTouchStart={isMobile && !m.deleted_at ? handleLongPress(m) : undefined}>
              {m.quote_message_id && <div className="quote-box">{[messages.find(x => x.id === m.quote_message_id)].map(q => q ? (q.status === 'recalled' ? '消息已撤回' : q.message_type === 'image' ? '[图片]' : q.content || '[未知消息]') : '引用消息不可用').join('')}</div>}
              {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.message_type === 'image' && m.image_path ? <img src={m.image_path} alt="图片" loading="lazy" /> : <span>{m.content || '[未知消息]'}</span>}
              {(m.status === 'sending' || m.status === 'failed') && <div className="time">{m.status === 'sending' ? '发送中...' : '发送失败'}</div>}
            </div>
          )
        ))}
        {sending === 'image' && <div className="msg user sending-msg"><span className="spinner" /> 发送图片中...</div>}
        <div ref={messagesEnd} />
      </div>
      <form className="composer" autoComplete="off" onSubmit={e => { e.preventDefault(); send(); }}>
        {quote && <div className="quote-compose" style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: 8, color: 'var(--muted)', fontSize: 12 }}>{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)} <button type="button" onClick={() => setQuote(null)} style={{ minHeight: 'auto', padding: '3px 8px', borderRadius: 8, fontSize: 12, background: '#64748b' }}>取消</button></div>}
        <label className="upload-btn"><input ref={uploadRef} type="file" name="image" accept="image/jpeg,image/png,image/webp" disabled={sessionClosed || !!accessError || !sessionId || sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />📎</label>
        <textarea ref={messageInputRef} name="message" autoComplete="off" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={sessionClosed || !!accessError || !sessionId} placeholder="输入消息" rows={1} />
        <button type="submit" className="send-btn" onMouseDown={e => e.preventDefault()} disabled={sessionClosed || !!accessError || !sessionId || (!text.trim() && !quote)}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button>
      </form>

      {/* Context menu */}
      {contextMenu && (() => {
        const items = menuItems(contextMenu.msg);
        if (items.length === 0) { setContextMenu(null); return null; }
        const mx = Math.min(contextMenu.x, window.innerWidth - 180);
        const my = Math.min(contextMenu.y, window.innerHeight - items.length * 44 - 10);
        return <div className="context-menu-overlay" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}>
          <div className="context-menu" style={{ position: 'fixed', left: mx, top: my, zIndex: 200, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 8px 32px var(--shadow)', padding: 6, display: 'grid', gap: 2, minWidth: 150 }}>
            {items.map((it, i) => <button key={i} onClick={it.action} disabled={it.disabled} style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 14, minHeight: 40, width: '100%', border: 0, cursor: it.disabled ? 'not-allowed' : 'pointer' }}>{it.label}{it.disabled && <span className="spinner" style={{ marginLeft: 8 }} />}</button>)}
          </div>
        </div>;
      })()}

    </div>
  );
}

/* ========== ADMIN PAGE ========== */

type GuestChatProps = {
  token: string;
};

export default function GuestChat({ token }: GuestChatProps) {
  return <VisitorChat inviteToken={token} />;
}
