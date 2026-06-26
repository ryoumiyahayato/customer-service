import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { apiFetch, ApiError } from './api';
import './styles.css';

type Message = any;
type Session = any;
type Admin = any;
type VisitorAccount = any;

const formatTime = (ts?: string) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const INVALID_LINK_TEXT = '\u94fe\u63a5\u5df2\u5931\u6548\uff0c\u8bf7\u8054\u7cfb\u5ba2\u670d\u91cd\u65b0\u83b7\u53d6';
const newClientMessageId = () => `cm_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

/* ========== VISITOR CHAT PAGE ========== */
function VisitorChat() {
  const [sessionId, setSessionId] = useState<string>(() => localStorage.getItem('chat_session_id') || '');
  const [visitorId, setVisitorId] = useState<string>(() => localStorage.getItem('chat_visitor_id') || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<'idle' | 'text' | 'image'>('idle');
  const [online, setOnline] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [authModal, setAuthModal] = useState<'login' | 'register' | false>(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authDisplay, setAuthDisplay] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [account, setAccount] = useState<VisitorAccount | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [networkBanner, setNetworkBanner] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [quote, setQuote] = useState<Message | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [recallLoading, setRecallLoading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');
  const [accessError, setAccessError] = useState('');
  const inviteToken = useMemo(() => { const m = location.pathname.match(/^\/g\/([^/]+)/); return m ? decodeURIComponent(m[1]) : ''; }, []);
  const sendingRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<any>(null);

  useEffect(() => { const on = () => setIsMobile(window.innerWidth < 768); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  useEffect(() => { const tou = () => setIsMobile(true); addEventListener('touchstart', tou, { once: true }); return () => removeEventListener('touchstart', tou); }, []);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  const connect = useCallback(async () => {
    try {
      const endpoint = inviteToken ? `/api/guest/${encodeURIComponent(inviteToken)}` : '/api/visitor';
      const res: any = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ visitorId }) });
      if (res.visitorId && res.visitorId !== visitorId) { setVisitorId(res.visitorId); localStorage.setItem('chat_visitor_id', res.visitorId); }
      if (res.account) setAccount(res.account);
      if (res.session) { setSessionId(res.session.id); localStorage.setItem('chat_session_id', res.session.id); }
      if (res.messages) setMessages(res.messages);
      setAccessError(''); setOnline(true); setConnecting(false);
      return res.session?.id;
    } catch (e: any) { setAccessError(e?.status === 410 || e?.status === 403 ? INVALID_LINK_TEXT : (e?.message || INVALID_LINK_TEXT)); setConnecting(false); setOnline(false); return null; }
  }, [visitorId, inviteToken]);

  useEffect(() => { connect(); }, []);

  const wsConnect = useCallback((sid: string) => {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/conversations/${sid}`);
    ws.onopen = () => { setOnline(true); setReconnecting(false); };
    ws.onclose = () => { setOnline(false); setReconnecting(true); reconnectTimer.current = setTimeout(() => { if (sessionId) wsConnect(sessionId); }, 3000); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'message:new') { setMessages(prev => [...prev, d.message]); }
        else if (d.type === 'message:updated') { setMessages(prev => prev.map(m => m.id === d.message.id ? d.message : m)); }
        else if (d.type === 'message:deleted') { setMessages(prev => prev.map(m => m.id === d.messageId ? { ...m, deleted_at: new Date().toISOString() } : m)); }
      } catch {}
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [sessionId]);

  useEffect(() => { if (!sessionId) return; wsConnect(sessionId); return () => { wsRef.current?.close(); clearTimeout(reconnectTimer.current); }; }, [sessionId]);

  useEffect(() => { const f = (e: StorageEvent) => { if (e.key === 'chat_visitor_id' && e.newValue && e.newValue !== visitorId) window.location.reload(); }; addEventListener('storage', f); return () => removeEventListener('storage', f); }, [visitorId]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (networkBanner) { const t = setTimeout(() => setNetworkBanner(false), 10000); return () => clearTimeout(t); } }, [networkBanner]);

  const send = async () => {
    if (accessError || !sessionId || sendingRef.current || sending !== 'idle') return;
    const content = text.trim();
    if (!content && !quote) return;
    sendingRef.current = true; setSending(quote ? 'text' : 'text');
    try {
      const clientMessageId = newClientMessageId();
      await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content, senderType: 'VISITOR', quoteMessageId: quote?.id || null }) });
      setText(''); setQuote(null);
    } catch (e: any) { showToast(e?.message || '发送失败'); setNetworkBanner(true); }
    sendingRef.current = false; setSending('idle');
  };

  const upload = async (file: File) => {
    if (accessError || !sessionId || sendingRef.current || sending !== 'idle') return;
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', sessionId);
      const res: any = await apiFetch(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', body: fd });
      await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'VISITOR' }) });
    } catch (e: any) { showToast(e?.message || '发送失败'); setNetworkBanner(true); }
    sendingRef.current = false; setSending('idle');
  };

  const doDelete = async (msg: Message) => {
    if (deleteLoading) return; setDeleteLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/delete`, { method: 'POST' }); }
    catch (e: any) { showToast(e?.message || '删除失败'); }
    setDeleteLoading(null);
  };

  const doRecall = async (msg: Message) => {
    if (recallLoading) return; setRecallLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/recall`, { method: 'POST' }); }
    catch (e: any) { showToast(e?.message || '撤回失败'); }
    setRecallLoading(null);
  };

  const auth = async () => {
    if (authLoading) return; setAuthLoading(true); setAuthError('');
    try {
      const res: any = authTab === 'login'
        ? await apiFetch('/api/account/login', { method: 'POST', body: JSON.stringify({ username: authUser, password: authPass }) })
        : await apiFetch('/api/account/register', { method: 'POST', body: JSON.stringify({ username: authUser, password: authPass, displayName: authDisplay }) });
      if (res.type === 'user') { setAccount(res.account); setAuthModal(false); connect(); }
    } catch (e: any) { setAuthError(e?.message || '操作失败'); }
    setAuthLoading(false);
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

  return (
    <div className={`chat-page${!isMobile ? ' is-desktop' : ''}`}>
      <header className="chat-header">
        <div className="status-light"><span className="status-dot" style={{ background: online ? '#22c55e' : '#94a3b8', color: online ? '#22c55e' : '#94a3b8' }} />{reconnecting ? '重连中...' : online ? '在线客服' : '连接中...'}</div>
        <div className="header-right">
          {account ? <span className="visitor-label">{account.display_name}</span> : <button className="auth-entry-btn" onClick={() => { setAuthModal('login'); setAuthTab('login'); }}>登录/注册</button>}
        </div>
      </header>
      {networkBanner && <div className="network-banner">网络不稳定，部分操作可能失败 <button onClick={() => setNetworkBanner(false)}>关闭</button></div>}
      {toast && <div className="network-banner">{toast} <button onClick={() => setToast('')}>关闭</button></div>}
      <div className="msgs">
        {connecting && <div className="empty-state"><span className="spinner" /> 正在连接客服...</div>}
        {accessError && <div className="empty-state">{accessError}</div>}
        {!accessError && !connecting && messages.length === 0 && <div className="empty-state">你好！有什么可以帮助你的？</div>}
        {messages.map(m => (
          m.deleted_at ? (
            <div key={m.id} className={'msg ' + (isOwn(m) ? 'user' : 'agent')}><span className="recalled">消息已删除</span></div>
          ) : (
            <div key={m.id} className={'msg ' + (isOwn(m) ? 'user' : 'agent')} onContextMenu={(e) => handleContextMenu(e, m)}
              onTouchStart={isMobile && !m.deleted_at ? handleLongPress(m) : undefined}>
              {m.quote_message_id && <div className="quote-box">{[messages.find(x => x.id === m.quote_message_id)].map(q => q ? (q.status === 'recalled' ? '消息已撤回' : q.message_type === 'image' ? '[图片]' : q.content || '[未知消息]') : '引用消息不可用').join('')}</div>}
              {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.message_type === 'image' && m.image_path ? <img src={m.image_path} alt="图片" loading="lazy" /> : <span>{m.content || '[未知消息]'}</span>}
            </div>
          )
        ))}
        {sending === 'text' && <div className="msg user sending-msg"><div className="sending-dots"><span /><span /><span /></div></div>}
        {sending === 'image' && <div className="msg user sending-msg"><span className="spinner" /> 发送图片中...</div>}
        <div ref={messagesEnd} />
      </div>
      <div className="composer">
        {quote && <div className="quote-compose" style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: 8, color: 'var(--muted)', fontSize: 12 }}>{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)} <button onClick={() => setQuote(null)} style={{ minHeight: 'auto', padding: '3px 8px', borderRadius: 8, fontSize: 12, background: '#64748b' }}>取消</button></div>}
        <label className="upload-btn"><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={!!accessError || !sessionId || sending !== 'idle'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />📎</label>
        <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !sendingRef.current) { e.preventDefault(); send(); } }} disabled={!!accessError || !sessionId || sending !== 'idle'} placeholder="输入消息" rows={1} />
        <button className="send-btn" onClick={send} disabled={!!accessError || !sessionId || sending !== 'idle' || (!text.trim() && !quote)}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button>
      </div>

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

      {/* Auth modal */}
      {authModal && <div className="auth-overlay" onClick={e => { if (e.target === e.currentTarget) setAuthModal(false); }}>
        <div className="auth-modal">
          <div className="auth-modal-header"><h3>{authTab === 'login' ? '登录' : '注册'}</h3><button className="auth-close-btn" onClick={() => setAuthModal(false)}>✕</button></div>
          <div className="auth-tabs">
            <button className={authTab === 'login' ? 'active' : ''} onClick={() => { setAuthTab('login'); setAuthError(''); }}>登录</button>
            <button className={authTab === 'register' ? 'active' : ''} onClick={() => { setAuthTab('register'); setAuthError(''); }}>注册</button>
          </div>
          <form className="auth-form" onSubmit={e => { e.preventDefault(); auth(); }}>
            <input placeholder="用户名" value={authUser} onChange={e => setAuthUser(e.target.value)} required autoComplete="username" />
            <input type="password" placeholder="密码（至少8位）" value={authPass} onChange={e => setAuthPass(e.target.value)} required autoComplete={authTab === 'login' ? 'current-password' : 'new-password'} />
            {authTab === 'register' && <input placeholder="显示名称（可选）" value={authDisplay} onChange={e => setAuthDisplay(e.target.value)} />}
            {authError && <p className="form-error">{authError}</p>}
            <button disabled={authLoading}>{authLoading ? '处理中...' : authTab === 'login' ? '登录' : '注册'}</button>
          </form>
        </div>
      </div>}
    </div>
  );
}

/* ========== ADMIN PAGE ========== */
function AdminPage() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<string>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cur, setCur] = useState<Session | null>(null);
  const [selectedMsgs, setSelectedMsgs] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<'idle' | 'text' | 'image'>('idle');
  const [quote, setQuote] = useState<Message | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [recallLoading, setRecallLoading] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth <= 820);
  const [mobileView, setMobileView] = useState<'dir' | 'chat' | 'panel'>('dir');
  const [operators, setOperators] = useState<any[]>([]);
  const [createOpLoading, setCreateOpLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [disableOpLoading, setDisableOpLoading] = useState<string | null>(null);
  const [staffText, setStaffText] = useState('');
  const [staffSending, setStaffSending] = useState(false);
  const [staffMsgs, setStaffMsgs] = useState<any[]>([]);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const isSuper = admin?.role === 'SUPER_ADMIN';
  const sendingRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const wsRefs = useRef<{ admin?: WebSocket; conv?: WebSocket; staff?: WebSocket }>({});
  const reconnectTimers = useRef<{ admin?: any; conv?: any; staff?: any }>({});

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  useEffect(() => { const on = () => setIsNarrow(window.innerWidth <= 820); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);

  const fetchAdmin = async () => {
    try { const res: any = await apiFetch('/api/auth/me'); if (res.disabled) { setDisabled(true); } setAdmin(res.admin); } catch (e: any) { if (e?.status !== 401) showToast(e?.message || '获取管理员信息失败'); } setLoading(false);
  };
  useEffect(() => { fetchAdmin(); }, []);

  const fetchSessions = async () => {
    try { const res: any = await apiFetch(`/api/sessions${includeDeleted ? '?includeDeleted=1' : ''}`); setSessions(res.sessions || []); } catch {}
  };
  useEffect(() => { if (admin) fetchSessions(); }, [admin, includeDeleted]);

  const fetchMsgs = async (sid: string) => {
    setLoadingMsgs(sid);
    try { const res: any = await apiFetch(`/api/sessions/${sid}/messages`); setSelectedMsgs(res.messages || []); } catch {}
    setLoadingMsgs(null);
  };

  const selectSession = (s: Session) => { setCur(s); fetchMsgs(s.id); if (isNarrow) setMobileView('chat'); };

  const wsAdmin = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/admin`);
    ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'sessions:changed') fetchSessions(); } catch {} };
    ws.onclose = () => { reconnectTimers.current.admin = setTimeout(() => wsAdmin(), 5000); };
    wsRefs.current.admin = ws;
  }, []);

  const wsConv = useCallback((sid: string) => {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/conversations/${sid}`);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'message:new') { setSelectedMsgs(prev => [...prev, d.message]); if (d.session) { setCur((c: any) => c?.id === d.session.id ? d.session : c); } }
        else if (d.type === 'message:updated') { setSelectedMsgs(prev => prev.map(m => m.id === d.message.id ? d.message : m)); }
        else if (d.type === 'message:deleted') { setSelectedMsgs(prev => prev.map(m => m.id === d.messageId ? { ...m, deleted_at: new Date().toISOString() } : m)); }
        else if (d.type === 'session:updated' && d.session?.id === cur?.id) { setCur(d.session); }
      } catch {}
    };
    ws.onclose = () => { reconnectTimers.current.conv = setTimeout(() => { if (cur) wsConv(cur.id); }, 5000); };
    wsRefs.current.conv = ws;
  }, [cur?.id]);

  const wsStaff = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/staff`);
    ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'staff:new') setStaffMsgs(prev => [...prev, d.message]); } catch {} };
    ws.onclose = () => { reconnectTimers.current.staff = setTimeout(() => wsStaff(), 5000); };
    wsRefs.current.staff = ws;
  }, []);

  useEffect(() => { if (!admin) return; wsAdmin(); return () => { wsRefs.current.admin?.close(); clearTimeout(reconnectTimers.current.admin); }; }, [admin]);
  useEffect(() => { if (!cur || !admin) return; wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); wsConv(cur.id); return () => { wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); }; }, [cur?.id, admin]);
  useEffect(() => { if (!admin || view !== 'staffChat') return; wsRefs.current.staff?.close(); wsStaff(); return () => { wsRefs.current.staff?.close(); clearTimeout(reconnectTimers.current.staff); }; }, [admin, view]);

  useEffect(() => { const iv = setInterval(() => { if (admin) { fetchSessions(); if (cur) fetchMsgs(cur.id); } }, 15000); return () => clearInterval(iv); }, [admin, cur]);

  const send = async () => {
    if (sendingRef.current || sending !== 'idle' || !cur) return;
    const content = text.trim();
    if (!content && !quote) return;
    sendingRef.current = true; setSending(quote ? 'text' : 'text');
    try {
      const clientMessageId = newClientMessageId();
      await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: cur.id, clientMessageId, content, senderType: 'OPERATOR', quoteMessageId: quote?.id || null }) });
      setText(''); setQuote(null);
    } catch (e: any) { showToast(e?.message || '发送失败'); }
    sendingRef.current = false; setSending('idle');
  };

  const upload = async (file: File) => {
    if (sendingRef.current || sending !== 'idle' || !cur) return;
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', cur.id);
      const res: any = await apiFetch(`/api/upload?sessionId=${encodeURIComponent(cur.id)}`, { method: 'POST', body: fd });
      await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: cur.id, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'OPERATOR' }) });
    } catch (e: any) { showToast(e?.message || '发送失败'); }
    sendingRef.current = false; setSending('idle');
  };

  const doDelete = async (msg: Message) => {
    if (deleteLoading) return; setDeleteLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/delete`, { method: 'POST' }); }
    catch (e: any) { showToast(e?.message || '删除失败'); }
    setDeleteLoading(null);
  };

  const doRecall = async (msg: Message) => {
    if (recallLoading) return; setRecallLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/recall`, { method: 'POST' }); }
    catch (e: any) { showToast(e?.message || '撤回失败'); }
    setRecallLoading(null);
  };

  const quoteText = (qid: string) => {
    const q = selectedMsgs.find(m => m.id === qid);
    return q ? (q.status === 'recalled' ? '消息已撤回' : q.message_type === 'image' ? '[图片]' : (q.content || '').slice(0, 60)) : '引用消息不可用';
  };

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => { e.preventDefault(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); };
  const handleLongPress = useCallback((msg: Message) => (e: React.TouchEvent) => {
    const timer = setTimeout(() => { setContextMenu({ msg, x: e.touches[0].clientX, y: e.touches[0].clientY }); }, 500);
    const clear = () => { clearTimeout(timer); e.target?.removeEventListener('touchend', clear); e.target?.removeEventListener('touchmove', clear); };
    e.target.addEventListener('touchend', clear, { once: true }); e.target.addEventListener('touchmove', clear, { once: true });
  }, []);

  const isOwnMsg = (m: Message) => m.sender_type === 'OPERATOR' && admin && m.sender_id === admin.id;
  const adminMenuItems = (msg: Message) => {
    const items: { label: string; action: () => void; disabled?: boolean }[] = [];
    if (msg.status !== 'recalled' && !msg.deleted_at) items.push({ label: '引用', action: () => { setQuote(msg); setContextMenu(null); } });
    if (isOwnMsg(msg) && msg.status !== 'recalled' && !msg.deleted_at) items.push({ label: '撤回', action: () => { doRecall(msg); setContextMenu(null); }, disabled: recallLoading === msg.id });
    if (isOwnMsg(msg) && !msg.deleted_at) items.push({ label: '删除', action: () => { doDelete(msg); setContextMenu(null); }, disabled: deleteLoading === msg.id });
    return items;
  };

  const assignSession = async (s: Session) => {
    try { await apiFetch(`/api/sessions/${s.id}/assign`, { method: 'POST' }); } catch {}
  };

  const handleSessionAction = async (s: Session, action: string) => {
    try { await apiFetch(`/api/sessions/${s.id}/${action}`, { method: 'POST' }); } catch {}
  };

  const updateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setProfileLoading(true);
    const fd = new FormData(e.currentTarget);
    try { await apiFetch('/api/admins/profile', { method: 'PATCH', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) }); showToast('更新成功'); }
    catch (e: any) { showToast(e?.message || '更新失败'); }
    setProfileLoading(false);
  };

  const doCreateOperator = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setCreateOpLoading(true);
    const fd = new FormData(e.currentTarget);
    try { await apiFetch('/api/admins', { method: 'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) }); showToast('创建成功'); e.currentTarget.reset(); fetchOps(); }
    catch (e: any) { showToast(e?.message || '创建失败'); }
    setCreateOpLoading(false);
  };

  const disableOp = async (op: any, hard?: boolean) => {
    setDisableOpLoading(hard ? '删除中...' : '禁用中...');
    try { await apiFetch('/api/admins/operators', { method: 'DELETE', body: JSON.stringify({ id: op.id, hard }) }); fetchOps(); }
    catch (e: any) { showToast(e?.message || '操作失败'); }
    setDisableOpLoading(null);
  };

  const fetchOps = async () => {
    try { const res: any = await apiFetch('/api/admins/operators'); setOperators(res.operators || []); } catch {}
  };

  const fetchStaff = async () => {
    try { const res: any = await apiFetch('/api/staff-chat'); setStaffMsgs(res.messages || []); } catch {}
  };

  useEffect(() => { if (isSuper) fetchOps(); }, [isSuper]);
  useEffect(() => { if (view === 'staffChat') fetchStaff(); }, [view]);

  const sendStaff = async (e: React.FormEvent) => {
    e.preventDefault(); if (staffSending || !staffText.trim()) return; setStaffSending(true);
    try { await apiFetch('/api/staff-chat', { method: 'POST', body: JSON.stringify({ content: staffText }) }); setStaffText(''); }
    catch (e: any) { showToast(e?.message || '发送失败'); }
    setStaffSending(false);
  };

  const sendButtonLabel = sending === 'text' ? '发送中...' : '发送';
  const uploadButtonLabel = sending === 'image' ? '上传中...' : '📎';
  const staffButtonLabel = staffSending ? '发送中...' : '发送';

  if (loading) return <div className="admin-loading-page"><div className="admin-loading-card"><span className="spinner" /> 加载中...</div></div>;
  if (!admin && !loading) return <AdminLogin />;
  if (disabled) return <div className="admin-loading-page"><div className="admin-loading-card">此账号已被禁用</div></div>;

  return (
    <div className={`admin${isNarrow ? ' is-narrow' : ''}`}>
      {/* Desktop sidebar */}
      <aside className="side desktop-side">
        <div className="brand"><h2>客服后台</h2><span>{admin?.username}</span></div>
        <nav className="side-nav">
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => { setView('sessions'); if (isNarrow) setMobileView('dir'); }}>会话</button>
          {isSuper && <button className={view === 'operators' ? 'active' : ''} onClick={() => { setView('operators'); if (isNarrow) setMobileView('panel'); }}>客服管理</button>}
          <button className={view === 'staffChat' ? 'active' : ''} onClick={() => { setView('staffChat'); if (isNarrow) setMobileView('panel'); }}>内部消息</button>
        </nav>
        <div className="folder">
          <div className="folder-head" onClick={() => setIncludeDeleted(!includeDeleted)}>
            会话列表 <b>{sessions.length}</b>
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>{includeDeleted ? '含已删除' : '活跃'}</span>
          </div>
          <div className="folder-body">
            {sessions.slice(0, isNarrow ? sessions.length : 30).map(s => (
              <button key={s.id} className={`session conversation-item${cur?.id === s.id ? ' active' : ''}`} onClick={() => selectSession(s)}>
                <div className="avatar-dot">{s.display_name?.[0] || '访'}</div>
                <div className="session-main"><b>{s.display_name || '访客'}</b><p>{s.status}</p></div>
                <div className="session-meta">
                  <small>{formatTime(s.updated_at)}</small>
                  {s.unread_count > 0 && <span className="badge">{s.unread_count}</span>}
                  {s.deleted_at && <em>已删除</em>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile topbar */}
      {isNarrow && (
        <div className="mobile-admin-topbar">
          <button className="mobile-dir-btn" onClick={() => setDirOpen(true)}>☰ 目录</button>
          <div className="mobile-topbar-title">{view === 'sessions' ? (cur ? cur.display_name || '访客' : '会话') : view === 'operators' ? '客服管理' : '内部消息'}</div>
          <div className="mobile-topbar-actions">
            {cur && view === 'sessions' && <button className="primary-action" onClick={() => assignSession(cur)}>接管</button>}
          </div>
        </div>
      )}

      {/* Mobile directory overlay */}
      {isNarrow && dirOpen && (
        <div className="mobile-dir-overlay" onClick={() => setDirOpen(false)}>
          <div className="mobile-dir-panel" onClick={e => e.stopPropagation()}>
            <div className="mobile-dir-header"><h3>目录</h3><button onClick={() => setDirOpen(false)}>✕</button></div>
            <div className="mobile-dir-list">
              <button className={`mobile-dir-item${view === 'sessions' ? ' active' : ''}`} onClick={() => { setView('sessions'); setMobileView('dir'); setDirOpen(false); }}>会话</button>
              {isSuper && <button className={`mobile-dir-item${view === 'operators' ? ' active' : ''}`} onClick={() => { setView('operators'); setMobileView('panel'); setDirOpen(false); }}>客服管理</button>}
              <button className={`mobile-dir-item${view === 'staffChat' ? ' active' : ''}`} onClick={() => { setView('staffChat'); setMobileView('panel'); setDirOpen(false); }}>内部消息</button>
            </div>
          </div>
        </div>
      )}

      <main className="main">
        {isNarrow ? (
          /* MOBILE CONTENT */
          <>
            {view === 'sessions' && mobileView === 'dir' && (
              <div className="mobile-session-list-view">
                <div className="session-list-area">
                  {sessions.map(s => (
                    <button key={s.id} className={`session conversation-item${cur?.id === s.id ? ' active' : ''}`} onClick={() => selectSession(s)}>
                      <div className="avatar-dot">{s.display_name?.[0] || '访'}</div>
                      <div className="session-main"><b>{s.display_name || '访客'}</b><p>{s.status}</p></div>
                      <div className="session-meta">
                        <small>{formatTime(s.updated_at)}</small>
                        {s.unread_count > 0 && <span className="badge">{s.unread_count}</span>}
                        {s.deleted_at && <em>已删除</em>}
                      </div>
                    </button>
                  ))}
                  {sessions.length === 0 && <div className="empty-state">暂无会话</div>}
                </div>
              </div>
            )}
            {view === 'sessions' && mobileView === 'chat' && cur && (
              <div className="mobile-chat-workspace">
                <section className="chat-panel">
                  {toast && <div className="notice">{toast}<button className="notice-dismiss" onClick={() => setToast('')}>关闭</button></div>}
                  <div className="msgs">
                    {loadingMsgs === cur.id && <div className="empty-state"><span className="spinner" /> 加载中</div>}
                    {selectedMsgs.length === 0 && !loadingMsgs && <div className="empty-state">暂无消息</div>}
                    {selectedMsgs.map(m => (
                      m.deleted_at ? (
                        <div key={m.id} className={'msg ' + (isOwnMsg(m) ? 'me' : '')}><span className="recalled">消息已删除</span></div>
                      ) : (
                        <div key={m.id} className={'msg ' + (isOwnMsg(m) ? 'me' : '')}
                          onContextMenu={(e) => handleContextMenu(e, m)}
                          onTouchStart={handleLongPress(m)}>
                          {m.quote_message_id && <div className="quote-box">{quoteText(m.quote_message_id)}</div>}
                          {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.message_type === 'image' && m.image_path ? <img src={m.image_path} alt="聊天图片" loading="lazy" /> : <span>{m.content || '[未知消息]'}</span>}
                          <div className="time">{formatTime(m.created_at)} {m.sender_type === 'OPERATOR' && (m.is_read ? '已读' : '未读')}</div>
                        </div>
                      )
                    ))}
                  </div>
                  <div className="composer">
                    {quote && <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 40)}<button onClick={() => setQuote(null)}>取消</button></div>}
                    <label className="file-btn">{uploadButtonLabel}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={sending !== 'idle'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                    <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !sendingRef.current) { e.preventDefault(); send(); } }} disabled={sending !== 'idle'} placeholder="输入消息" rows={1} />
                    <button onClick={send} disabled={sending !== 'idle' || (!text.trim() && !quote)}>{sendButtonLabel}</button>
                  </div>
                </section>
              </div>
            )}
            {view === 'sessions' && mobileView === 'chat' && !cur && (
              <div className="mobile-chat-workspace"><div className="empty-state">请选择一个会话</div></div>
            )}
            {view === 'operators' && isSuper && (
              <div className="mobile-panel-workspace">
                <div className="admin-panel">
                  <h3>修改超级管理员</h3>
                  <form onSubmit={updateProfile} className="mini-form">
                    <input name="username" placeholder="新用户名" autoComplete="off" />
                    <input name="password" type="password" placeholder="新密码" autoComplete="new-password" />
                    <button disabled={profileLoading}>{profileLoading ? '保存中...' : '保存'}</button>
                  </form>
                  <h3 className="panel-title">创建客服</h3>
                  <form onSubmit={doCreateOperator} className="mini-form">
                    <input name="username" placeholder="用户名" required autoComplete="off" />
                    <input name="password" type="password" placeholder="密码（至少8位）" required autoComplete="new-password" />
                    <button disabled={createOpLoading}>{createOpLoading ? '创建中...' : '创建'}</button>
                  </form>
                  <h3 className="panel-title">客服</h3>
                  <div className="operator-list">
                    {operators.length ? operators.map(op => (
                      <div className="operator-row" key={op.id}>
                        <div><b>{op.username}</b><span>{op.is_disabled ? '已禁用' : op.online ? '在线' : '离线'}{op.last_seen_at ? ' · ' + new Date(op.last_seen_at).toLocaleString() : ''}</span></div>
                        {op.is_disabled ? <button className="btn danger" onClick={() => disableOp(op, true)} disabled={!!disableOpLoading}>{disableOpLoading === '删除中...' ? '删除中...' : '删除'}</button> : <button className="btn danger" onClick={() => disableOp(op)} disabled={!!disableOpLoading}>{disableOpLoading === '禁用中...' ? '禁用中...' : '禁用'}</button>}
                      </div>
                    )) : <div className="empty-state">暂无客服账号</div>}
                  </div>
                </div>
              </div>
            )}
            {view === 'staffChat' && (
              <div className="mobile-panel-workspace">
                <section className="chat-panel" style={{ height: '100%' }}>
                  <div className="msgs">
                    {staffMsgs.length === 0 ? <div className="empty-state">暂无内部消息</div> : staffMsgs.map(m => (
                      <div key={m.id} className={'msg ' + (m.sender_admin_id === admin.id ? 'me' : '')}><b>{m.sender_name}</b><div>{m.content}</div><div className="time">{formatTime(m.created_at)}</div></div>
                    ))}
                  </div>
                  <form className="composer staff-composer" onSubmit={sendStaff}>
                    <input type="text" value={staffText} onChange={e => setStaffText(e.target.value)} disabled={staffSending} placeholder="输入内部消息..." />
                    <button disabled={staffSending || !staffText.trim()}>{staffButtonLabel}</button>
                  </form>
                </section>
              </div>
            )}
          </>
        ) : (
          /* DESKTOP CONTENT */
          <>
            {view === 'sessions' ? (
              <div className="workspace">
                <section className="chat-panel">
                  {toast && <div className="notice">{toast}<button className="notice-dismiss" onClick={() => setToast('')}>关闭</button></div>}
                  <div className="msgs">
                    {loadingMsgs === cur?.id ? <div className="empty-state"><span className="spinner" /> 正在加载消息</div> : null}
                    {!loadingMsgs && selectedMsgs.length === 0 && cur && !cur.deleted_at ? <div className="empty-state">暂无消息</div> : null}
                    {!cur ? <div className="empty-state">请选择一个会话</div> : null}
                    {selectedMsgs.map(m => (
                      m.deleted_at ? (
                        <div key={m.id} className={'msg ' + (isOwnMsg(m) ? 'me' : '')}><span className="recalled">消息已删除</span></div>
                      ) : (
                        <div key={m.id} className={'msg ' + (isOwnMsg(m) ? 'me' : '')}
                          onContextMenu={(e) => handleContextMenu(e, m)}
                          onTouchStart={handleLongPress(m)}>
                          {m.quote_message_id && <div className="quote-box">{quoteText(m.quote_message_id)}</div>}
                          {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.message_type === 'image' && m.image_path ? <img src={m.image_path} alt="聊天图片" loading="lazy" /> : <span>{m.content || '[未知消息]'}</span>}
                          <div className="time">{formatTime(m.created_at)} {m.sender_type === 'OPERATOR' ? (m.is_read ? '已读' : '未读') : ''}</div>
                        </div>
                      )
                    ))}
                  </div>
                  {cur && !cur.deleted_at ? (
                    <div className="composer">
                      {quote ? <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)}<button onClick={() => setQuote(null)}>取消</button></div> : null}
                      <label className="file-btn">{uploadButtonLabel}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={sending !== 'idle'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                      <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !sendingRef.current) { e.preventDefault(); send(); } }} disabled={sending !== 'idle'} placeholder="输入消息" rows={1} />
                      <button onClick={send} disabled={sending !== 'idle' || (!text.trim() && !quote)}>{sendButtonLabel}</button>
                    </div>
                  ) : (
                    <div className="empty-state">{cur?.deleted_at ? '会话已删除' : '请选择一个访客会话'}</div>
                  )}
                </section>
              </div>
            ) : null}
            {view === 'operators' && isSuper ? (
              <div className="workspace">
                <aside className="admin-panel wide">
                  <h3>修改超级管理员</h3>
                  <form onSubmit={updateProfile} className="mini-form">
                    <input name="username" placeholder="新用户名" autoComplete="off" />
                    <input name="password" type="password" placeholder="新密码" autoComplete="new-password" />
                    <button disabled={profileLoading}>{profileLoading ? '保存中...' : '保存'}</button>
                  </form>
                  <h3 className="panel-title">创建客服</h3>
                  <form onSubmit={doCreateOperator} className="mini-form">
                    <input name="username" placeholder="用户名" required autoComplete="off" />
                    <input name="password" type="password" placeholder="密码（至少8位）" required autoComplete="new-password" />
                    <button disabled={createOpLoading}>{createOpLoading ? '创建中...' : '创建'}</button>
                  </form>
                  <h3 className="panel-title">客服</h3>
                  <div className="operator-list">
                    {operators.length ? operators.map(op => (
                      <div className="operator-row" key={op.id}>
                        <div><b>{op.username}</b><span>{op.is_disabled ? '已禁用' : op.online ? '在线' : '离线'}{op.last_seen_at ? ' · ' + new Date(op.last_seen_at).toLocaleString() : ''}</span></div>
                        {op.is_disabled ? <button className="btn danger" onClick={() => disableOp(op, true)} disabled={!!disableOpLoading}>{disableOpLoading === '删除中...' ? '删除中...' : '删除'}</button> : <button className="btn danger" onClick={() => disableOp(op)} disabled={!!disableOpLoading}>{disableOpLoading === '禁用中...' ? '禁用中...' : '禁用'}</button>}
                      </div>
                    )) : <div className="empty-state">暂无客服账号</div>}
                  </div>
                </aside>
              </div>
            ) : null}
            {view === 'staffChat' ? (
              <div className="workspace">
                <section className="chat-panel">
                  <div className="msgs">
                    {staffMsgs.length === 0 ? <div className="empty-state">暂无内部消息</div> : staffMsgs.map(m => (
                      <div key={m.id} className={'msg ' + (m.sender_admin_id === admin.id ? 'me' : '')}><b>{m.sender_name}</b><div>{m.content}</div><div className="time">{formatTime(m.created_at)}</div></div>
                    ))}
                  </div>
                  <form className="composer staff-composer" onSubmit={sendStaff}>
                    <input type="text" value={staffText} onChange={e => setStaffText(e.target.value)} disabled={staffSending} placeholder="输入内部消息..." />
                    <button disabled={staffSending || !staffText.trim()}>{staffButtonLabel}</button>
                  </form>
                </section>
              </div>
            ) : null}
          </>
        )}
      </main>

      {/* Context menu */}
      {contextMenu && (() => {
        const items = adminMenuItems(contextMenu.msg);
        if (items.length === 0) { setContextMenu(null); return null; }
        const mx = Math.min(contextMenu.x, window.innerWidth - 180);
        const my = Math.min(contextMenu.y, window.innerHeight - items.length * 44 - 10);
        return <div className="context-menu-overlay" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'transparent' }}>
          <div className="context-menu" style={{ position: 'fixed', left: mx, top: my, zIndex: 200, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 8px 32px var(--shadow)', padding: 6, display: 'grid', gap: 2, minWidth: 150 }}>
            {items.map((it, i) => <button key={i} onClick={it.action} disabled={it.disabled} style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 14, minHeight: 40, width: '100%', border: 0, cursor: it.disabled ? 'not-allowed' : 'pointer' }}>{it.label}{it.disabled && <span className="spinner" style={{ marginLeft: 8 }} />}</button>)}
          </div>
        </div>;
      })()}
    </div>
  );
}

function AdminLogin() {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); if (loading) return; setLoading(true); setError('');
    try { await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) }); window.location.reload(); }
    catch (e: any) { setError(e?.message || '登录失败'); }
    setLoading(false);
  };
  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <h2>客服后台</h2>
        <p className="admin-login-sub">请使用管理员账号登录</p>
        <form className="admin-login-form" onSubmit={login}>
          <input placeholder="用户名" value={user} onChange={e => setUser(e.target.value)} required autoComplete="username" />
          <input type="password" placeholder="密码" value={pass} onChange={e => setPass(e.target.value)} required autoComplete="current-password" />
          {error && <p className="form-error">{error}</p>}
          <button disabled={loading}>{loading ? '登录中...' : '登录'}</button>
        </form>
      </div>
    </div>
  );
}

export default function App() { const [path, setPath] = useState(location.pathname); useEffect(() => { const on = () => setPath(location.pathname); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []); return path.startsWith('/admin') ? <AdminPage /> : <VisitorChat />; }
