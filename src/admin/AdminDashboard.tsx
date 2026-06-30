import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';
import InviteLinkPanel from './InviteLinkPanel';
import AdminLogin from './AdminLogin';
import '../styles.css';

type Message = any;
type Session = any;
type Admin = any;

const formatTime = (ts?: string) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
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
const sessionEnded = (session?: Session | null) => Boolean(!session || session.deleted_at || session.status === 'CLOSED' || session.status === 'ARCHIVED');

/* ========== ADMIN DASHBOARD ========== */
export default function AdminDashboard() {
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
  const [mobileInviteOpen, setMobileInviteOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const isSuper = admin?.role === 'SUPER_ADMIN';
  const currentSessionEnded = sessionEnded(cur);
  const sendingRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const wsRefs = useRef<{ admin?: WebSocket; conv?: WebSocket; staff?: WebSocket }>({});
  const reconnectTimers = useRef<{ admin?: any; conv?: any; staff?: any }>({});

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  useEffect(() => { const on = () => setIsNarrow(window.innerWidth <= 820); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);

  const fetchAdmin = useCallback(async () => {
    try { const res: any = await apiFetch('/api/auth/me'); if (res.disabled) { setDisabled(true); } setAdmin(res.admin); } catch (e: any) { if (e?.status !== 401) showToast(e?.message || '获取管理员信息失败'); } setLoading(false);
  }, [showToast]);
  useEffect(() => { fetchAdmin(); }, [fetchAdmin]);

  const fetchSessions = async () => {
    try { const res: any = await apiFetch(`/api/sessions${includeDeleted ? '?includeDeleted=1' : ''}`); setSessions(res.sessions || []); } catch {}
  };
  useEffect(() => { if (admin) fetchSessions(); }, [admin, includeDeleted]);

  const fetchMsgs = async (sid: string) => {
    setLoadingMsgs(sid);
    try { const res: any = await apiFetch(`/api/sessions/${sid}/messages`); setSelectedMsgs(mergeMessages([], res.messages || [])); } catch {}
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
        if (isMessageCreatedEvent(d.type)) { setSelectedMsgs(prev => mergeMessage(prev, d.message)); if (d.session) { setCur((c: any) => c?.id === d.session.id ? d.session : c); } }
        else if (d.type === 'message:updated') { setSelectedMsgs(prev => mergeMessage(prev, d.message)); }
        else if (d.type === 'message:deleted') { setSelectedMsgs(prev => prev.map(m => m.id === d.messageId ? { ...m, deleted_at: new Date().toISOString() } : m)); }
        else if (d.type === 'session:updated') { setCur((c: any) => c?.id === d.session?.id ? d.session : c); }
      } catch {}
    };
    ws.onclose = () => { reconnectTimers.current.conv = setTimeout(() => wsConv(sid), 5000); };
    wsRefs.current.conv = ws;
  }, []);

  const wsStaff = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/staff`);
    ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'staff:new') setStaffMsgs(prev => [...prev, d.message]); } catch {} };
    ws.onclose = () => { reconnectTimers.current.staff = setTimeout(() => wsStaff(), 5000); };
    wsRefs.current.staff = ws;
  }, []);

  useEffect(() => { if (!admin) return; wsAdmin(); return () => { if (wsRefs.current.admin) wsRefs.current.admin.onclose = null; wsRefs.current.admin?.close(); clearTimeout(reconnectTimers.current.admin); }; }, [admin]);
  useEffect(() => { if (!cur || !admin) return; if (wsRefs.current.conv) wsRefs.current.conv.onclose = null; wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); wsConv(cur.id); return () => { if (wsRefs.current.conv) wsRefs.current.conv.onclose = null; wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); }; }, [cur?.id, admin, wsConv]);
  useEffect(() => { if (!admin || view !== 'staffChat') return; if (wsRefs.current.staff) wsRefs.current.staff.onclose = null; wsRefs.current.staff?.close(); wsStaff(); return () => { if (wsRefs.current.staff) wsRefs.current.staff.onclose = null; wsRefs.current.staff?.close(); clearTimeout(reconnectTimers.current.staff); }; }, [admin, view]);

  const send = async () => {
    if (!cur || currentSessionEnded) return;
    const content = text.trim();
    if (!content && !quote) return;
    const currentQuote = quote;
    const clientMessageId = newClientMessageId();
    const tempId = localMessageId(clientMessageId);
    const optimisticMessage = {
      id: tempId,
      session_id: cur.id,
      sender_type: 'OPERATOR',
      sender_id: admin?.id || '',
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
    setSelectedMsgs(prev => mergeMessage(prev, optimisticMessage));
    setText('');
    setQuote(null);
    try {
      const res: any = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: cur.id, clientMessageId, content, senderType: 'OPERATOR', quoteMessageId: currentQuote?.id || null }) });
      if (res?.message) setSelectedMsgs(prev => mergeMessage(prev, res.message));
      if (res?.session) setCur((c: any) => c?.id === res.session.id ? res.session : c);
    } catch (e: any) { setSelectedMsgs(prev => markMessageFailed(prev, tempId)); showToast(e?.message || '发送失败'); }
  };

  const upload = async (file: File) => {
    if (sending === 'image' || !cur || currentSessionEnded) return;
    let tempId = '';
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', cur.id);
      const res: any = await apiFetch(`/api/upload?sessionId=${encodeURIComponent(cur.id)}`, { method: 'POST', body: fd });
      tempId = localMessageId(clientMessageId);
      setSelectedMsgs(prev => mergeMessage(prev, { id: tempId, session_id: cur.id, sender_type: 'OPERATOR', sender_id: admin?.id || '', content: '', message_type: 'image', image_path: res.path, status: 'sending', created_at: new Date().toISOString(), read_at: null, is_read: 0, quote_message_id: null, client_message_id: clientMessageId }));
      const msgRes: any = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: cur.id, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'OPERATOR' }) });
      if (msgRes?.message) setSelectedMsgs(prev => mergeMessage(prev, msgRes.message));
      if (msgRes?.session) setCur((c: any) => c?.id === msgRes.session.id ? msgRes.session : c);
    } catch (e: any) { if (tempId) setSelectedMsgs(prev => markMessageFailed(prev, tempId)); showToast(e?.message || '发送失败'); }
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

  const closeSession = async (s: Session) => {
    if (closingSessionId || sessionEnded(s)) return;
    if (!window.confirm('确认结束该会话？结束后访客不能继续发送消息或上传图片。')) return;
    setClosingSessionId(s.id);
    try {
      await apiFetch(`/api/sessions/${s.id}/close`, { method: 'POST' });
      setQuote(null);
      await fetchSessions();
      setCur((c: Session | null) => c?.id === s.id ? { ...c, status: 'CLOSED', assigned_operator_id: null } : c);
      showToast('会话已结束');
    } catch (e: any) {
      showToast(e?.message || '结束会话失败，请稍后重试');
    } finally {
      setClosingSessionId(null);
    }
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


  const logout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      wsRefs.current.admin?.close();
      wsRefs.current.conv?.close();
      wsRefs.current.staff?.close();
      setAdmin(null);
      setSessions([]);
      setCur(null);
      setSelectedMsgs([]);
      setStaffMsgs([]);
      setView('sessions');
      setMobileView('dir');
      setDirOpen(false);
      setMobileInviteOpen(false);
    } catch (e: any) {
      showToast(e?.message || '\u9000\u51fa\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5');
    } finally {
      setLogoutLoading(false);
    }
  };

  const sendButtonLabel = '发送';
  const uploadButtonLabel = sending === 'image' ? '上传中...' : '📎';
  const staffButtonLabel = staffSending ? '发送中...' : '发送';

  if (loading) return <div className="admin-loading-page"><div className="admin-loading-card"><span className="spinner" /> 加载中...</div></div>;
  if (!admin && !loading) return <AdminLogin onLoginSuccess={() => { setLoading(true); return fetchAdmin(); }} />;
  if (disabled) return <div className="admin-loading-page"><div className="admin-loading-card">此账号已被禁用</div></div>;

  return (
    <div className={`admin${isNarrow ? ' is-narrow' : ''}`}>
      {toast && <div className="admin-global-toast">{toast}<button onClick={() => setToast('')}>×</button></div>}
      {/* Desktop sidebar */}
      <aside className="side desktop-side">
        <div className="brand">
          <div><h2>{'\u5ba2\u670d\u540e\u53f0'}</h2><span>{admin?.username}</span></div>
          <button className="logout-btn" onClick={logout} disabled={logoutLoading}>{logoutLoading ? '\u9000\u51fa\u4e2d...' : '\u9000\u51fa'}</button>
        </div>
        <nav className="side-nav">
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => { setView('sessions'); if (isNarrow) setMobileView('dir'); }}>会话</button>
          {isSuper && <button className={view === 'operators' ? 'active' : ''} onClick={() => { setView('operators'); if (isNarrow) setMobileView('panel'); }}>客服管理</button>}
          <button className={view === 'staffChat' ? 'active' : ''} onClick={() => { setView('staffChat'); if (isNarrow) setMobileView('panel'); }}>内部消息</button>
        </nav>
        <InviteLinkPanel adminRole={admin?.role} operators={operators} />
        {view === 'sessions' && <div className="folder">
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
        </div>}
      </aside>

      {/* Mobile topbar */}
      {isNarrow && (
        <div className="mobile-admin-topbar">
          <button className="mobile-dir-btn" onClick={() => setDirOpen(true)}>☰ 目录</button>
          <div className="mobile-topbar-title">{view === 'sessions' ? (cur ? cur.display_name || '访客' : '会话') : view === 'operators' ? '客服管理' : '内部消息'}</div>
          <div className="mobile-topbar-actions">
            <button onClick={() => setMobileInviteOpen(true)}>{'\u9080\u8bf7'}</button>
            {cur && view === 'sessions' && !currentSessionEnded && <button className="primary-action" onClick={() => assignSession(cur)}>接管</button>}
            {cur && view === 'sessions' && !currentSessionEnded && <button className="danger close-session-btn" onClick={() => closeSession(cur)} disabled={closingSessionId === cur.id}>{closingSessionId === cur.id ? '结束中' : '结束'}</button>}
            <button className="logout-btn" onClick={logout} disabled={logoutLoading}>{logoutLoading ? '\u9000\u51fa\u4e2d' : '\u9000\u51fa'}</button>
          </div>
        </div>
      )}


      {isNarrow && mobileInviteOpen && (
        <div className="mobile-dir-overlay" onClick={() => setMobileInviteOpen(false)}>
          <div className="mobile-dir-panel invite-mobile-panel" onClick={e => e.stopPropagation()}>
            <div className="mobile-dir-header"><h3>{'\u8bbf\u5ba2\u9080\u8bf7\u94fe\u63a5'}</h3><button onClick={() => setMobileInviteOpen(false)}>{'\u5173\u95ed'}</button></div>
            <InviteLinkPanel adminRole={admin?.role} operators={operators} />
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
                  <div className="session-action-bar">
                    <div><b>{cur.display_name || '访客'}</b><span>{currentSessionEnded ? '已结束' : cur.status}</span></div>
                    {!currentSessionEnded ? <button className="danger close-session-btn" onClick={() => closeSession(cur)} disabled={closingSessionId === cur.id}>{closingSessionId === cur.id ? '结束中...' : '结束会话'}</button> : <span className="ended-chip">会话已结束</span>}
                  </div>
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
                          <div className="time">{m.status === 'sending' ? '发送中...' : m.status === 'failed' ? '发送失败' : `${formatTime(m.created_at)} ${m.sender_type === 'OPERATOR' ? (m.is_read ? '已读' : '未读') : ''}`}</div>
                        </div>
                      )
                    ))}
                  </div>
                  {currentSessionEnded ? <div className="session-ended-state">会话已结束</div> : <div className="composer">
                    {quote && <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 40)}<button onClick={() => setQuote(null)}>取消</button></div>}
                    <label className="file-btn">{uploadButtonLabel}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                    <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="输入消息" rows={1} />
                    <button onClick={send} disabled={!text.trim() && !quote}>{sendButtonLabel}</button>
                  </div>}
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
                  {cur ? <div className="session-action-bar">
                    <div><b>{cur.display_name || '访客'}</b><span>{currentSessionEnded ? '已结束' : cur.status}</span></div>
                    {!currentSessionEnded ? <button className="danger close-session-btn" onClick={() => closeSession(cur)} disabled={closingSessionId === cur.id}>{closingSessionId === cur.id ? '结束中...' : '结束会话'}</button> : <span className="ended-chip">会话已结束</span>}
                  </div> : null}
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
                          <div className="time">{m.status === 'sending' ? '发送中...' : m.status === 'failed' ? '发送失败' : `${formatTime(m.created_at)} ${m.sender_type === 'OPERATOR' ? (m.is_read ? '已读' : '未读') : ''}`}</div>
                        </div>
                      )
                    ))}
                  </div>
                  {cur && !currentSessionEnded ? (
                    <div className="composer">
                      {quote ? <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)}<button onClick={() => setQuote(null)}>取消</button></div> : null}
                      <label className="file-btn">{uploadButtonLabel}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                      <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="输入消息" rows={1} />
                      <button onClick={send} disabled={!text.trim() && !quote}>{sendButtonLabel}</button>
                    </div>
                  ) : (
                    <div className="empty-state">{cur ? '会话已结束' : '请选择一个访客会话'}</div>
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
