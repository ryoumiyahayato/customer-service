import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ApiError, apiFetch } from '../api';
import ChatMessageText from '../ChatMessageText';
import { copyText, getErrorMessage } from '../compat';
import DesktopAdminPolish from './DesktopAdminPolish';
import AdminMobileShell from './AdminMobileShell';
import SessionClientInfo from './SessionClientInfo';
import SuperAdminStaffClearControl from './SuperAdminStaffClearControl';
import { AdminWorkspaceProvider, type AdminCapabilities, type AdminCoreView, type AdminMobileView } from './AdminWorkspaceContext';
import AdminLogin from './AdminLogin';
import AdminMessageList from './AdminMessageList';
import AdminSessionList from './AdminSessionList';
import { getActiveAdminSessionId, messageBelongsToActiveSession, setActiveAdminSessionId } from './activeSessionGuard';
import { InlineNotice } from '../ui/Notice';
import { LoadingState, StatusBlock } from '../ui/StatusBlock';
import {
  fallbackDelay,
  isArchivedSession,
  isSessionEnded,
  parseChatRealtimeEvent,
  sessionGroupOf,
  lastServerMessageTime,
  localMessageId,
  markMessageFailed,
  mergeMessage,
  mergeMessages,
  messageSessionId,
  newClientMessageId,
  recordChatMetric,
  type AdminIdentity,
  type ChatMessage,
  type ChatRealtimeEvent,
  type ChatSession,
  type ClearHistoryPlan,
  type OperatorSummary,
  type SessionGroup,
  type StaffMessage,
} from '../chatModel';
import '../styles.css';

type Message = ChatMessage;
type Session = ChatSession;
type Admin = AdminIdentity;
type AuthMeResponse = { admin: Admin | null; disabled?: boolean };
type SessionListResponse = { sessions?: Session[] };
type MessageListResponse = { messages?: Message[] };
type MessageMutationResponse = { message?: Message; session?: Session };
type UploadResponse = { path: string };
type SessionMutationResponse = { session: Session };
type ClearHistoryDryRunResponse = { counts?: Partial<ClearHistoryPlan['counts']> };
type ClearHistoryResponse = { failed?: { r2Objects?: number } };
type OperatorListResponse = { operators?: OperatorSummary[] };
type StaffMessageListResponse = { messages?: StaffMessage[] };

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

const formatTime = (ts?: string) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const sessionEnded = isSessionEnded;
const fallbackCustomerName = (session?: Session | null) => {
  const source = String(session?.visitorKey || session?.userId || session?.id || '');
  if (!source) return '客户';
  let hash = 0;
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
  return `客户${String(hash || 1).padStart(4, '0')}`;
};
const applyReadReceipt = (messages: Message[], messageIds: string[] = [], readAt?: string) => {
  if (!messageIds.length) return messages;
  const ids = new Set(messageIds);
  return messages.map((message) => ids.has(message.id)
    ? { ...message, isRead: true, status: message.status === 'sent' ? 'read' : message.status, readAt: message.readAt || readAt || new Date().toISOString() }
    : message);
};
const eventSessionId = (event: ChatRealtimeEvent, fallbackSessionId: string) => {
  if (event.type === 'message:new' || event.type === 'message_created' || event.type === 'message:updated') {
    return event.message.sessionId || event.sessionId || fallbackSessionId;
  }
  if (event.type === 'session:updated') return event.session.id || event.sessionId || fallbackSessionId;
  if (event.type === 'messages:read' || event.type === 'message:deleted') return event.sessionId || fallbackSessionId;
  return fallbackSessionId;
};

/* ========== ADMIN DASHBOARD ========== */
export default function AdminDashboard() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AdminCoreView>('sessions');
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
  const [mobileView, setMobileView] = useState<AdminMobileView>('dir');
  const [operators, setOperators] = useState<OperatorSummary[]>([]);
  const [createOpLoading, setCreateOpLoading] = useState(false);
  const [disableOpLoading, setDisableOpLoading] = useState<string | null>(null);
  const [staffText, setStaffText] = useState('');
  const [staffSending, setStaffSending] = useState(false);
  const [staffMsgs, setStaffMsgs] = useState<StaffMessage[]>([]);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');
  const [sessionGroup, setSessionGroup] = useState<SessionGroup>('active');
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const [sessionActionLoading, setSessionActionLoading] = useState<string | null>(null);
  const [clearHistoryPlan, setClearHistoryPlan] = useState<ClearHistoryPlan | null>(null);
  const [clearHistoryLoading, setClearHistoryLoading] = useState(false);
  const [convOnline, setConvOnline] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [capabilities, setCapabilities] = useState<AdminCapabilities>({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });
  const isSuper = admin?.role === 'SUPER_ADMIN';
  const currentSessionEnded = sessionEnded(cur);
  const sessionGroupCounts = useMemo(() => ({
    active: sessions.filter(s => sessionGroupOf(s) === 'active').length,
    archived: sessions.filter(s => sessionGroupOf(s) === 'archived').length,
    trash: sessions.filter(s => sessionGroupOf(s) === 'trash').length,
  }), [sessions]);
  const visibleSessions = useMemo(() => sessions.filter(s => sessionGroupOf(s) === sessionGroup), [sessionGroup, sessions]);
  const unreadCount = useMemo(() => sessions.filter(s => sessionGroupOf(s) === 'active').reduce((sum, session) => sum + Math.max(0, Number(session.unreadCount || 0)), 0), [sessions]);
  const customerName = useCallback((session?: Session | null) => String(session?.customerRemarkName || '').trim() || fallbackCustomerName(session), []);
  const customerAvatar = useCallback((session?: Session | null) => {
    const remark = String(session?.customerRemarkName || '').trim();
    if (remark) return remark.slice(0, 1);
    return customerName(session).replace(/\D/g, '').slice(-1) || '客';
  }, [customerName]);
  const currentCustomerName = customerName(cur);
  const openView = useCallback((nextView: AdminCoreView, nextMobileView?: AdminMobileView) => {
    setView(nextView);
    if (nextMobileView) setMobileView(nextMobileView);
  }, []);
  const currentCustomerAvatar = customerAvatar(cur);
  const sendingRef = useRef(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedMsgsRef = useRef<Message[]>([]);
  const curRef = useRef<Session | null>(null);
  const convOnlineRef = useRef(false);
  const activeSessionIdRef = useRef('');
  const messageLoadRequestIdRef = useRef(0);
  const messageSyncRequestIdRef = useRef(0);
  const messageFallbackMissesRef = useRef(0);
  const wsRefs = useRef<{ admin?: WebSocket; conv?: WebSocket; staff?: WebSocket }>({});
  const reconnectTimers = useRef<Partial<Record<'admin' | 'conv' | 'staff', ReturnType<typeof setTimeout>>>>({});
  const messageFallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearActiveSessionState = useCallback(() => {
    activeSessionIdRef.current = '';
    setActiveAdminSessionId(null);
    messageLoadRequestIdRef.current += 1;
    messageSyncRequestIdRef.current += 1;
    clearTimeout(messageFallbackTimer.current);
    messageFallbackMissesRef.current = 0;
    selectedMsgsRef.current = [];
    curRef.current = null;
    setLoadingMsgs(null);
    setSelectedMsgs([]);
    setQuote(null);
    setContextMenu(null);
    setConvOnline(false);
  }, []);

  const resetAdminState = useCallback(() => {
    wsRefs.current.admin?.close();
    wsRefs.current.conv?.close();
    wsRefs.current.staff?.close();
    clearActiveSessionState();
    setAdmin(null);
    setSessions([]);
    setCur(null);
    setStaffMsgs([]);
    setView('sessions');
    setMobileView('dir');
    setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });
  }, [clearActiveSessionState]);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);
  const handleAuthExpired = useCallback(() => {
    resetAdminState();
    showToast('登录已过期，请重新登录');
  }, [resetAdminState, showToast]);
  const focusMessageInput = useCallback(() => {
    messageInputRef.current?.focus();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      setTimeout(() => messageInputRef.current?.focus(), 0);
    });
  }, []);

  const isActiveAdminSession = useCallback((sid: string) => Boolean(sid && activeSessionIdRef.current === sid && getActiveAdminSessionId() === sid), []);
  const isLatestMessageLoad = useCallback((sid: string, requestId: number) => isActiveAdminSession(sid) && requestId === messageLoadRequestIdRef.current, [isActiveAdminSession]);
  const isLatestMessageSync = useCallback((sid: string, requestId: number) => isActiveAdminSession(sid) && requestId === messageSyncRequestIdRef.current, [isActiveAdminSession]);
  const filterMessagesForSession = useCallback((messages: Message[] = [], sid: string) => messages.filter(message => messageBelongsToActiveSession(message, sid)), []);

  useEffect(() => { const on = () => setIsNarrow(window.innerWidth <= 820); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  useEffect(() => { selectedMsgsRef.current = selectedMsgs; }, [selectedMsgs]);
  useEffect(() => { curRef.current = cur; }, [cur]);
  useEffect(() => { convOnlineRef.current = convOnline; }, [convOnline]);
  useEffect(() => { setRemarkDraft(String(cur?.customerRemarkName || '').slice(0, 40)); }, [cur?.id, cur?.customerRemarkName]);

  const fetchAdmin = useCallback(async () => {
    try { const res = await apiFetch<AuthMeResponse>('/api/auth/me'); if (res.disabled) { setDisabled(true); } setAdmin(res.admin); } catch (error) { if (isUnauthorized(error)) resetAdminState(); else showToast(getErrorMessage(error, '获取管理员信息失败')); } setLoading(false);
  }, [resetAdminState, showToast]);
  useEffect(() => { fetchAdmin(); }, [fetchAdmin]);

  useEffect(() => {
    let active = true;
    if (!admin) {
      setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });
      return () => { active = false; };
    }
    if (admin.role === 'SUPER_ADMIN') {
      setCapabilities({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true });
      return () => { active = false; };
    }
    apiFetch<{ capabilities?: Partial<AdminCapabilities> }>('/api/admin/capabilities', { retryGet: false })
      .then(response => {
        if (!active) return;
        setCapabilities({
          canCreateInvites: response.capabilities?.canCreateInvites === true,
          canUseStaffChat: response.capabilities?.canUseStaffChat === true,
          canUploadImages: response.capabilities?.canUploadImages === true,
        });
      })
      .catch(() => { if (active) setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false }); });
    return () => { active = false; };
  }, [admin?.id, admin?.role]);

  useEffect(() => {
    if (!admin) return;
    let inFlight = false;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      try {
        await apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false, timeoutMs: 5000 });
      } catch (error) {
        if (isUnauthorized(error)) handleAuthExpired();
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void heartbeat(); }, 2500);
    const onFocus = () => { void heartbeat(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [admin?.id, handleAuthExpired]);

  const fetchSessions = async () => {
    try { const res = await apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1'); setSessions(res.sessions || []); } catch (error) { if (isUnauthorized(error)) handleAuthExpired(); }
  };
  useEffect(() => { if (admin) fetchSessions(); }, [admin]);

  const fetchMsgs = async (sid: string) => {
    const requestId = ++messageLoadRequestIdRef.current;
    setLoadingMsgs(sid);
    try {
      const res = await apiFetch<MessageListResponse>(`/api/sessions/${sid}/messages`);
      if (!isLatestMessageLoad(sid, requestId)) return;
      const messages = filterMessagesForSession(res.messages || [], sid);
      setSelectedMsgs(mergeMessages([], messages));
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, unreadCount: 0 } : s));
    } catch (error) {
      if (isUnauthorized(error)) handleAuthExpired();
    } finally {
      if (isLatestMessageLoad(sid, requestId)) setLoadingMsgs(null);
    }
  };

  const syncSelectedMsgs = useCallback(async (sid: string) => {
    if (!isActiveAdminSession(sid)) return 0;
    const requestId = ++messageSyncRequestIdRef.current;
    const started = performance.now();
    const after = lastServerMessageTime(selectedMsgsRef.current.filter(message => messageBelongsToActiveSession(message, sid)));
    const url = `/api/sessions/${encodeURIComponent(sid)}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const res = await apiFetch<MessageListResponse>(url, { retryGet: false });
    if (!isLatestMessageSync(sid, requestId)) return 0;
    const messages = filterMessagesForSession(res?.messages || [], sid);
    const count = messages.length;
    recordChatMetric('fallback_fetch_ms', started, { merge_messages_count: count });
    if (count) setSelectedMsgs(prev => mergeMessages(filterMessagesForSession(prev, sid), messages));
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, unreadCount: 0 } : s));
    return count;
  }, [filterMessagesForSession, isActiveAdminSession, isLatestMessageSync]);

  const selectSession = (s: Session) => {
    activeSessionIdRef.current = s.id;
    setActiveAdminSessionId(s.id);
    messageLoadRequestIdRef.current += 1;
    messageSyncRequestIdRef.current += 1;
    clearTimeout(messageFallbackTimer.current);
    messageFallbackMissesRef.current = 0;
    selectedMsgsRef.current = [];
    setSelectedMsgs([]);
    setLoadingMsgs(s.id);
    setQuote(null);
    setContextMenu(null);
    setConvOnline(false);
    setCur(s);
    fetchMsgs(s.id);
    if (isNarrow) setMobileView('chat');
  };

  const wsAdmin = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/admin`);
    ws.onmessage = (e) => { try { const d = parseChatRealtimeEvent(JSON.parse(e.data)); if (d?.type === 'sessions:changed') fetchSessions(); } catch {} };
    ws.onclose = () => { reconnectTimers.current.admin = setTimeout(() => wsAdmin(), 5000); };
    wsRefs.current.admin = ws;
  }, []);

  const wsConv = useCallback((sid: string) => {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const connectStarted = performance.now();
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/conversations/${sid}`);
    ws.onopen = () => {
      if (!isActiveAdminSession(sid)) { ws.close(); return; }
      recordChatMetric('ws_connect_ms', connectStarted);
      clearTimeout(messageFallbackTimer.current);
      messageFallbackMissesRef.current = 0;
      setConvOnline(true);
    };
    ws.onmessage = (e) => {
      try {
        const d = parseChatRealtimeEvent(JSON.parse(e.data));
        if (!d) return;
        const sidFromEvent = eventSessionId(d, sid);
        const eventSession = d.type === 'session:updated'
          ? d.session
          : d.type === 'message:new' || d.type === 'message_created'
            ? d.session
            : undefined;
        if (sidFromEvent && sidFromEvent !== sid) {
          if (eventSession) setSessions(prev => prev.map(session => session.id === eventSession.id ? { ...session, ...eventSession } : session));
          return;
        }
        if (!isActiveAdminSession(sid)) {
          if (eventSession) setSessions(prev => prev.map(session => session.id === eventSession.id ? { ...session, ...eventSession } : session));
          return;
        }
        if (d.type === 'message:new' || d.type === 'message_created') {
          if (!messageBelongsToActiveSession(d.message, sid)) return;
          setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message));
          const sessionUpdate = d.session;
          if (sessionUpdate) setCur(current => current?.id === sessionUpdate.id ? sessionUpdate : current);
        } else if (d.type === 'message:updated') {
          if (!messageBelongsToActiveSession(d.message, sid)) return;
          setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message));
        } else if (d.type === 'messages:read') {
          setSelectedMsgs(prev => applyReadReceipt(filterMessagesForSession(prev, sid), d.messageIds, d.readAt));
        } else if (d.type === 'message:deleted') {
          setSelectedMsgs(prev => filterMessagesForSession(prev, sid).map(message =>
            message.id === d.messageId ? { ...message, deletedAt: new Date().toISOString() } : message
          ));
        } else if (d.type === 'session:updated') {
          setCur(current => current?.id === d.session.id ? { ...current, ...d.session } : current);
        }
      } catch {}
    };
    ws.onerror = () => ws.close();
    ws.onclose = (e) => {
      console.debug('[chat_metric]', 'ws_close_code', e.code, { reason_length: e.reason?.length || 0 });
      if (isActiveAdminSession(sid)) {
        setConvOnline(false);
        reconnectTimers.current.conv = setTimeout(() => wsConv(sid), 5000);
      }
    };
    wsRefs.current.conv = ws;
  }, [filterMessagesForSession, isActiveAdminSession]);

  const wsStaff = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/staff`);
    ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'staff:new') setStaffMsgs(prev => [...prev, d.message]); } catch {} };
    ws.onclose = () => { reconnectTimers.current.staff = setTimeout(() => wsStaff(), 5000); };
    wsRefs.current.staff = ws;
  }, []);

  useEffect(() => { if (!admin) return; wsAdmin(); return () => { if (wsRefs.current.admin) wsRefs.current.admin.onclose = null; wsRefs.current.admin?.close(); clearTimeout(reconnectTimers.current.admin); }; }, [admin]);
  useEffect(() => { if (!cur || !admin) return; setConvOnline(false); if (wsRefs.current.conv) wsRefs.current.conv.onclose = null; wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); wsConv(cur.id); return () => { if (wsRefs.current.conv) wsRefs.current.conv.onclose = null; wsRefs.current.conv?.close(); clearTimeout(reconnectTimers.current.conv); }; }, [cur?.id, admin, wsConv]);
  useEffect(() => { if (!admin || view !== 'staffChat') return; if (wsRefs.current.staff) wsRefs.current.staff.onclose = null; wsRefs.current.staff?.close(); wsStaff(); return () => { if (wsRefs.current.staff) wsRefs.current.staff.onclose = null; wsRefs.current.staff?.close(); clearTimeout(reconnectTimers.current.staff); }; }, [admin, view]);

  const scheduleMessageFallback = useCallback((sid: string, delay = 0) => {
    clearTimeout(messageFallbackTimer.current);
    messageFallbackTimer.current = setTimeout(async () => {
      if (!sid || !isActiveAdminSession(sid) || convOnlineRef.current || sessionEnded(curRef.current)) return;
      try {
        const count = await syncSelectedMsgs(sid);
        if (!isActiveAdminSession(sid)) return;
        messageFallbackMissesRef.current = count ? 0 : messageFallbackMissesRef.current + 1;
      } catch {
        if (!isActiveAdminSession(sid)) return;
        messageFallbackMissesRef.current += 1;
      }
      if (!convOnlineRef.current && isActiveAdminSession(sid)) scheduleMessageFallback(sid, fallbackDelay(messageFallbackMissesRef.current));
    }, delay);
  }, [isActiveAdminSession, syncSelectedMsgs]);

  useEffect(() => {
    clearTimeout(messageFallbackTimer.current);
    if (!admin || !cur || currentSessionEnded || convOnline) return;
    messageFallbackMissesRef.current = 0;
    scheduleMessageFallback(cur.id, 0);
    return () => clearTimeout(messageFallbackTimer.current);
  }, [admin, convOnline, cur?.id, currentSessionEnded, scheduleMessageFallback]);

  useEffect(() => {
    const syncIfVisible = () => {
      const sid = curRef.current?.id;
      if (document.visibilityState === 'hidden' || !sid || !isActiveAdminSession(sid) || sessionEnded(curRef.current) || convOnlineRef.current) return;
      syncSelectedMsgs(sid).catch(() => {});
    };
    addEventListener('focus', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);
    return () => { removeEventListener('focus', syncIfVisible); document.removeEventListener('visibilitychange', syncIfVisible); };
  }, [isActiveAdminSession, syncSelectedMsgs]);

  const send = async () => {
    if (!cur || currentSessionEnded) return;
    const sid = cur.id;
    const content = text.trim();
    if (!content && !quote) return;
    const currentQuote = quote;
    const clientMessageId = newClientMessageId();
    const tempId = localMessageId(clientMessageId);
    const optimisticMessage: Message = {
      id: tempId,
      sessionId: sid,
      senderType: 'OPERATOR',
      senderId: admin?.id || '',
      content,
      messageType: 'text',
      imagePath: null,
      status: 'sending',
      createdAt: new Date().toISOString(),
      readAt: null,
      isRead: false,
      quoteMessageId: currentQuote?.id || null,
      clientMessageId: clientMessageId,
      recalledAt: null,
      deletedAt: null,
      imagePurgedAt: null
    };
    if (!isActiveAdminSession(sid)) return;
    setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), optimisticMessage));
    setText('');
    setQuote(null);
    focusMessageInput();
    try {
      const postStarted = performance.now();
      const res = await apiFetch<MessageMutationResponse>('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: sid, clientMessageId, content, senderType: 'OPERATOR', quoteMessageId: currentQuote?.id || null }) });
      recordChatMetric('api_post_total_ms', postStarted);
      if (!isActiveAdminSession(sid)) return;
      if (res?.message && messageBelongsToActiveSession(res.message, sid)) setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), res.message));
      const updatedSession = res.session;
      if (updatedSession) setCur(c => c?.id === updatedSession.id ? updatedSession : c);
      syncSelectedMsgs(sid).catch(() => {});
    } catch (error) { if (isActiveAdminSession(sid)) setSelectedMsgs(prev => markMessageFailed(prev, tempId)); showToast(getErrorMessage(error, '发送失败')); }
  };

  const upload = async (file: File) => {
    if (sending === 'image' || !cur || currentSessionEnded) return;
    const sid = cur.id;
    let tempId = '';
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', sid);
      const res = await apiFetch<UploadResponse>(`/api/upload?sessionId=${encodeURIComponent(sid)}`, { method: 'POST', body: fd });
      if (!isActiveAdminSession(sid)) return;
      tempId = localMessageId(clientMessageId);
      setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), { id: tempId, sessionId: sid, senderType: 'OPERATOR', senderId: admin?.id || '', content: '', messageType: 'image', imagePath: res.path, status: 'sending', createdAt: new Date().toISOString(), readAt: null, isRead: false, quoteMessageId: null, clientMessageId: clientMessageId, recalledAt: null, deletedAt: null, imagePurgedAt: null }));
      const msgRes = await apiFetch<MessageMutationResponse>('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId: sid, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'OPERATOR' }) });
      if (!isActiveAdminSession(sid)) return;
      if (msgRes?.message && messageBelongsToActiveSession(msgRes.message, sid)) setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), msgRes.message));
      const updatedSession = msgRes.session;
      if (updatedSession) setCur(c => c?.id === updatedSession.id ? updatedSession : c);
    } catch (error) { if (tempId && isActiveAdminSession(sid)) setSelectedMsgs(prev => markMessageFailed(prev, tempId)); showToast(getErrorMessage(error, '发送失败')); }
    sendingRef.current = false; setSending('idle');
  };

  const doDelete = async (msg: Message) => {
    if (deleteLoading) return; setDeleteLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/delete`, { method: 'POST' }); }
    catch (error) { showToast(getErrorMessage(error, '删除失败')); }
    setDeleteLoading(null);
  };

  const doRecall = async (msg: Message) => {
    if (recallLoading) return; setRecallLoading(msg.id);
    try { await apiFetch(`/api/messages/${msg.id}/recall`, { method: 'POST' }); }
    catch (error) { showToast(getErrorMessage(error, '撤回失败')); }
    setRecallLoading(null);
  };

  const quoteText = (qid: string) => {
    const q = selectedMsgs.find(m => m.id === qid && (!cur?.id || messageSessionId(m) === cur.id || !messageSessionId(m)));
    return q ? (q.status === 'recalled' ? '消息已撤回' : q.messageType === 'image' ? '[图片]' : (q.content || '').slice(0, 60)) : '引用消息不可用';
  };

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => { e.preventDefault(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); };
  const handleLongPress = useCallback((msg: Message) => (e: React.TouchEvent) => {
    const timer = setTimeout(() => { setContextMenu({ msg, x: e.touches[0].clientX, y: e.touches[0].clientY }); }, 500);
    const clear = () => { clearTimeout(timer); e.target?.removeEventListener('touchend', clear); e.target?.removeEventListener('touchmove', clear); };
    e.target.addEventListener('touchend', clear, { once: true }); e.target.addEventListener('touchmove', clear, { once: true });
  }, []);

  const isOwnMsg = (m: Message) => m.senderType === 'OPERATOR' && admin && m.senderId === admin.id;
  const adminMenuItems = (msg: Message) => {
    const items: { label: string; action: () => void; disabled?: boolean }[] = [];
    if (msg.status !== 'recalled' && !msg.deletedAt && msg.messageType !== 'image' && msg.content) {
      items.push({
        label: '复制文本',
        action: () => {
          copyText(String(msg.content || '')).then(() => showToast('已复制')).catch((error) => showToast(getErrorMessage(error, '复制失败')));
          setContextMenu(null);
        },
      });
    }
    if (msg.status !== 'recalled' && !msg.deletedAt) items.push({ label: '引用', action: () => { setQuote(msg); setContextMenu(null); } });
    if (isOwnMsg(msg) && msg.status !== 'recalled' && !msg.deletedAt) items.push({ label: '撤回', action: () => { doRecall(msg); setContextMenu(null); }, disabled: recallLoading === msg.id });
    if (isOwnMsg(msg) && !msg.deletedAt) items.push({ label: '删除', action: () => { doDelete(msg); setContextMenu(null); }, disabled: deleteLoading === msg.id });
    return items;
  };

  const renderSelectedMessage = (m: Message) => {
    const own = isOwnMsg(m);
    return (
      <div key={m.id} className={`msg-row${own ? ' own' : ''}`}>
        {!own && <div className="message-avatar customer-avatar" aria-hidden="true">{currentCustomerAvatar}</div>}
        {m.deletedAt ? (
          <div className={'msg ' + (own ? 'me' : '')}><span className="recalled">消息已删除</span></div>
        ) : (
          <div className={'msg ' + (own ? 'me' : '')}
            onContextMenu={(e) => handleContextMenu(e, m)}
            onTouchStart={handleLongPress(m)}>
            {m.quoteMessageId && <div className="quote-box">{quoteText(m.quoteMessageId)}</div>}
            {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.messageType === 'image' && m.imagePath ? <a className="message-image-link" href={m.imagePath} target="_blank" rel="noreferrer"><img src={m.imagePath} alt="聊天图片" loading="lazy" /></a> : <ChatMessageText text={m.content || ''} />}
            <div className={`time message-status${m.status === 'failed' ? ' failed' : m.status === 'sending' ? ' sending' : ''}`}>{m.status === 'sending' ? '发送中...' : m.status === 'failed' ? '发送失败，请稍后重试' : `${formatTime(m.createdAt)} ${own ? (m.isRead ? '客户已读' : '未读') : ''}`}</div>
          </div>
        )}
      </div>
    );
  };


  const closeSession = async (s: Session) => {
    if (closingSessionId || sessionEnded(s)) return;
    if (!window.confirm('确认结束该会话？结束后访客不能继续发送消息或上传图片。')) return;
    setClosingSessionId(s.id);
    try {
      await apiFetch(`/api/sessions/${s.id}/close`, { method: 'POST' });
      setQuote(null);
      await fetchSessions();
      setCur((c: Session | null) => c?.id === s.id ? { ...c, status: 'ARCHIVED', archivedAt: new Date().toISOString(), assignedOperatorId: null } : c);
      setSessionGroup('archived');
      showToast('会话已结束');
    } catch (error) {
      showToast(getErrorMessage(error, '结束会话失败，请稍后重试'));
    } finally {
      setClosingSessionId(null);
    }
  };

  const applySessionUpdate = useCallback((session?: Session | null) => {
    if (!session?.id) return;
    setSessions(prev => prev.map(s => s.id === session.id ? { ...s, ...session } : s));
    setCur((c: Session | null) => c?.id === session.id ? { ...c, ...session } : c);
  }, []);

  const moveSessionToTrash = async (s: Session) => {
    if (!s || sessionActionLoading || s.deletedAt || !isArchivedSession(s)) return;
    setSessionActionLoading(`delete:${s.id}`);
    try {
      const res = await apiFetch<SessionMutationResponse>(`/api/sessions/${s.id}/delete`, { method: 'POST' });
      applySessionUpdate(res.session);
      setSessionGroup('trash');
      await fetchSessions();
      showToast('会话已移入回收站');
    } catch (error) {
      showToast(getErrorMessage(error, '移入回收站失败'));
    } finally {
      setSessionActionLoading(null);
    }
  };

  const restoreDeletedSession = async (s: Session) => {
    if (!s || sessionActionLoading || !s.deletedAt) return;
    setSessionActionLoading(`restore:${s.id}`);
    try {
      const res = await apiFetch<SessionMutationResponse>(`/api/sessions/${s.id}/restore`, { method: 'POST' });
      applySessionUpdate(res.session);
      setSessionGroup(sessionGroupOf(res.session) || 'archived');
      await fetchSessions();
      showToast('会话已恢复');
    } catch (error) {
      showToast(getErrorMessage(error, '恢复失败'));
    } finally {
      setSessionActionLoading(null);
    }
  };

  const canClearHistorySession = (session?: Session | null) => Boolean(isSuper && session && !session.purgedAt && (session.deletedAt || isArchivedSession(session)));

  const startClearHistory = async (session: Session) => {
    if (!canClearHistorySession(session) || clearHistoryLoading) return;
    setClearHistoryLoading(true);
    try {
      const res = await apiFetch<ClearHistoryDryRunResponse>(`/api/sessions/${session.id}/clear-history/dry-run`, { method: 'POST' });
      setClearHistoryPlan({
        session,
        counts: {
          messages: res.counts?.messages ?? 0,
          attachments: res.counts?.attachments ?? 0,
          r2Objects: res.counts?.r2Objects ?? 0,
        },
      });
    } catch (error) {
      showToast(getErrorMessage(error, '清空历史预检查失败'));
    } finally {
      setClearHistoryLoading(false);
    }
  };

  const executeClearHistory = async () => {
    if (!clearHistoryPlan || clearHistoryLoading) return;
    const sessionId = clearHistoryPlan.session.id;
    setClearHistoryLoading(true);
    try {
      const res = await apiFetch<ClearHistoryResponse>(`/api/sessions/${sessionId}/clear-history`, { method: 'POST', body: JSON.stringify({ confirm: 'CLEAR_HISTORY' }) });
      await fetchSessions();
      if (cur?.id === sessionId) await fetchMsgs(sessionId);
      setClearHistoryPlan(null);
      const failed = Number(res?.failed?.r2Objects || 0);
      showToast(failed ? `历史已部分清空，${failed} 个附件清理失败，可重试` : '历史已清空');
    } catch (error) {
      showToast(getErrorMessage(error, '清空历史失败'));
    } finally {
      setClearHistoryLoading(false);
    }
  };

  const renderClearHistoryButton = (session?: Session | null) => {
    if (!session || !canClearHistorySession(session)) return null;
    return <button type="button" className="danger session-action-btn clear-history-btn" onClick={() => startClearHistory(session)} disabled={clearHistoryLoading}>清空历史</button>;
  };

  const renderSessionLifecycleActions = (session?: Session | null) => {
    if (!session) return null;
    const bucket = sessionGroupOf(session);
    if (bucket === 'trash') return <>
      <button type="button" className="secondary session-action-btn" onClick={() => restoreDeletedSession(session)} disabled={sessionActionLoading === `restore:${session.id}`}>{sessionActionLoading === `restore:${session.id}` ? '恢复中...' : '恢复'}</button>
      {renderClearHistoryButton(session)}
    </>;
    if (bucket === 'archived') return <>
      <button type="button" className="secondary session-action-btn trash-action-btn" onClick={() => moveSessionToTrash(session)} disabled={sessionActionLoading === `delete:${session.id}`}>{sessionActionLoading === `delete:${session.id}` ? '移入中...' : '移入回收站'}</button>
      {renderClearHistoryButton(session)}
    </>;
    if (!currentSessionEnded) return <button type="button" className="danger close-session-btn" onClick={() => closeSession(session)} disabled={closingSessionId === session.id}>{closingSessionId === session.id ? '结束中...' : '结束会话'}</button>;
    return null;
  };

  const applyCustomerRemark = useCallback((sessionId: string, remarkName: string | null) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, customerRemarkName: remarkName } : s));
    setCur((c: Session | null) => c?.id === sessionId ? { ...c, customerRemarkName: remarkName } : c);
  }, []);

  const saveCustomerRemark = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cur || remarkSaving) return;
    const remarkName = remarkDraft.trim().slice(0, 40);
    setRemarkSaving(true);
    try {
      const res = await apiFetch<SessionMutationResponse>(`/api/sessions/${cur.id}/customer-remark`, { method: 'PATCH', body: JSON.stringify({ remarkName }) });
      const nextRemark = res?.session?.customerRemarkName || null;
      applyCustomerRemark(cur.id, nextRemark);
      setRemarkDraft(nextRemark || '');
      showToast(nextRemark ? '备注已保存' : '备注已清除');
      fetchSessions();
    } catch (error) {
      showToast(getErrorMessage(error, '备注保存失败'));
    } finally {
      setRemarkSaving(false);
    }
  };

  const renderCustomerRemarkEditor = () => {
    if (!cur) return null;
    const currentRemark = String(cur.customerRemarkName || '');
    const changed = remarkDraft.trim() !== currentRemark;
    return (
      <form className="customer-remark-form" onSubmit={saveCustomerRemark} autoComplete="off">
        <label htmlFor="customer-remark-input">备注</label>
        <input
          id="customer-remark-input"
          name="customerRemark"
          type="text"
          value={remarkDraft}
          maxLength={40}
          placeholder={fallbackCustomerName(cur)}
          onChange={e => setRemarkDraft(e.target.value.slice(0, 40))}
          disabled={remarkSaving}
        />
        <button type="submit" disabled={remarkSaving || !changed}>{remarkSaving ? '保存中...' : '保存'}</button>
      </form>
    );
  };


  const doCreateOperator = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setCreateOpLoading(true);
    const fd = new FormData(e.currentTarget);
    try { await apiFetch('/api/admins', { method: 'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) }); showToast('创建成功'); e.currentTarget.reset(); fetchOps(); }
    catch (error) { showToast(getErrorMessage(error, '创建失败')); }
    setCreateOpLoading(false);
  };

  const disableOp = async (op: OperatorSummary) => {
    setDisableOpLoading('禁用中...');
    try { await apiFetch('/api/admins/operators', { method: 'DELETE', body: JSON.stringify({ id: op.id }) }); await fetchOps(); }
    catch (error) { showToast(getErrorMessage(error, '操作失败')); }
    setDisableOpLoading(null);
  };

  const fetchOps = async () => {
    try { const res = await apiFetch<OperatorListResponse>('/api/admins/operators'); setOperators(res.operators || []); } catch {}
  };

  const fetchStaff = async () => {
    try { const res = await apiFetch<StaffMessageListResponse>('/api/staff-chat'); setStaffMsgs(res.messages || []); } catch {}
  };

  useEffect(() => { if (isSuper) fetchOps(); }, [isSuper]);
  useEffect(() => { if (view === 'staffChat') fetchStaff(); }, [view]);

  const sendStaff = async (e: React.FormEvent) => {
    e.preventDefault(); if (staffSending || !staffText.trim()) return; setStaffSending(true);
    try { await apiFetch('/api/staff-chat', { method: 'POST', body: JSON.stringify({ content: staffText }) }); setStaffText(''); }
    catch (error) { showToast(getErrorMessage(error, '发送失败')); }
    setStaffSending(false);
  };

  const logout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      resetAdminState();
    } catch (error) {
      showToast(getErrorMessage(error, '退出登录失败，请刷新后重试'));
    } finally {
      setLogoutLoading(false);
    }
  };

  const sendButtonLabel = '发送';
  const uploadButtonLabel = sending === 'image' ? '上传中...' : '📎';
  const staffButtonLabel = staffSending ? '发送中...' : '发送';

  if (loading) return <div className="admin-loading-page"><LoadingState className="admin-loading-card">正在加载后台...</LoadingState></div>;
  if (!admin && !loading) return <AdminLogin onLoginSuccess={() => { setLoading(true); return fetchAdmin(); }} />;
  if (disabled) return <div className="admin-loading-page"><div className="admin-loading-card">此账号已被禁用</div></div>;

  const workspaceValue = { admin: admin!, sessions, currentSession: cur, currentCustomerName, operators, capabilities, unreadCount, view, mobileView, isNarrow, openView, setMobileView, refreshSessions: fetchSessions, logout, logoutLoading };

  return (
    <AdminWorkspaceProvider value={workspaceValue}>
      <>
    <div className={`admin${isNarrow ? ' is-narrow' : ''}`}>
      {toast && <div className="admin-global-toast">{toast}<button type="button" onClick={() => setToast('')}>×</button></div>}
      {clearHistoryPlan && <div className="modal-backdrop">
        <div className="danger-modal">
          <h3>清空历史</h3>
          <p>将清空该会话的历史消息及相关附件。执行前请确认当前会话不再需要保留记录。</p>
          <div className="clear-history-summary">
            <span>消息数量：<b>{clearHistoryPlan.counts.messages}</b></span>
            <small>相关附件也会被清理。</small>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setClearHistoryPlan(null)} disabled={clearHistoryLoading}>取消</button>
            <button type="button" className="danger" onClick={executeClearHistory} disabled={clearHistoryLoading}>{clearHistoryLoading ? '清空中...' : '确认清空'}</button>
          </div>
        </div>
      </div>}
      <aside className="side desktop-side">
        {view === 'sessions' && <div className="folder">
          <div className="folder-head">
            会话列表 <b>{visibleSessions.length}</b>
          </div>
          <AdminSessionList
            sessions={visibleSessions}
            currentSessionId={cur?.id}
            sessionGroup={sessionGroup}
            sessionGroupCounts={sessionGroupCounts}
            onGroupChange={setSessionGroup}
            onSelectSession={selectSession}
            customerAvatar={customerAvatar}
            customerName={customerName}
            formatTime={formatTime}
            maxItems={isNarrow ? visibleSessions.length : 30}
            listClassName="folder-body"
            emptyClassName="small-empty"
          />
        </div>}
      </aside>


      <main className="main">
        {isNarrow ? (
          <>
            {view === 'sessions' && mobileView === 'dir' && (
              <div className="mobile-session-list-view">
                <div className="session-list-area">
                  <AdminSessionList
                    sessions={visibleSessions}
                    currentSessionId={cur?.id}
                    sessionGroup={sessionGroup}
                    sessionGroupCounts={sessionGroupCounts}
                    onGroupChange={setSessionGroup}
                    onSelectSession={selectSession}
                    customerAvatar={customerAvatar}
                    customerName={customerName}
                    formatTime={formatTime}
                    tabsClassName="mobile-session-tabs"
                  />
                </div>
              </div>
            )}
            {view === 'sessions' && mobileView === 'chat' && cur && (
              <div className="mobile-chat-workspace">
                <section className="chat-panel">
                  <div className="session-action-bar">
                    <div><b>{currentCustomerName}</b><span>{sessionGroupOf(cur) === 'archived' ? '已归档' : sessionGroupOf(cur) === 'trash' ? '回收站' : currentSessionEnded ? '已结束' : '进行中'}</span></div>
                    {renderCustomerRemarkEditor()}
                    {renderSessionLifecycleActions(cur)}
                    <SessionClientInfo session={cur} />
                  </div>
                  {toast && <InlineNotice onDismiss={() => setToast('')}>{toast}</InlineNotice>}
                  <AdminMessageList
                    messages={selectedMsgs}
                    renderMessage={renderSelectedMessage}
                    loading={loadingMsgs === cur.id}
                    showEmpty={selectedMsgs.length === 0 && !loadingMsgs}
                    emptyText={currentSessionEnded ? '历史已清空' : '暂无消息，发送第一条回复开始沟通。'}
                  />
                  {currentSessionEnded ? <div className="session-ended-state">{sessionGroupOf(cur) === 'trash' ? '会话在回收站中。' : '会话已归档，消息输入已关闭。'}</div> : <form className="composer" autoComplete="off" onSubmit={e => { e.preventDefault(); send(); }}>
                    {quote && <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.messageType === 'image' ? '[图片]' : (quote.content || '').slice(0, 40)}<button type="button" onClick={() => setQuote(null)}>取消</button></div>}
                    <label className="file-btn">{uploadButtonLabel}<input type="file" name="image" accept="image/jpeg,image/png,image/webp" disabled={sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                    <textarea ref={messageInputRef} name="message" autoComplete="off" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="输入消息" rows={1} />
                    <button type="submit" onMouseDown={e => e.preventDefault()} disabled={!text.trim() && !quote}>{sendButtonLabel}</button>
                  </form>}
                </section>
              </div>
            )}
            {view === 'sessions' && mobileView === 'chat' && !cur && (
              <div className="mobile-chat-workspace"><StatusBlock>请选择一个会话查看沟通记录。</StatusBlock></div>
            )}
            {view === 'operators' && isSuper && (
              <div className="mobile-panel-workspace">
                <div className="admin-panel">
                  <h3 className="panel-title">创建客服</h3>
                  <form onSubmit={doCreateOperator} className="mini-form" autoComplete="off">
                    <input name="username" placeholder="用户名" required autoComplete="off" />
                    <input name="password" type="password" placeholder="密码（至少8位）" required autoComplete="new-password" />
                    <button type="submit" disabled={createOpLoading}>{createOpLoading ? '创建中...' : '创建'}</button>
                  </form>
                  <h3 className="panel-title">客服</h3>
                  <div className="operator-list">
                    {operators.length ? operators.map(op => (
                      <div className="operator-row" key={op.id}>
                        <div><b>{op.username}</b><span>{op.isDisabled ? '已禁用' : op.online ? '在线' : '离线'}{op.lastSeenAt ? ' · ' + new Date(op.lastSeenAt).toLocaleString() : ''}</span></div>
                        {op.isDisabled ? <span className="muted">已禁用</span> : <button type="button" className="btn danger" onClick={() => disableOp(op)} disabled={!!disableOpLoading}>{disableOpLoading === '禁用中...' ? '禁用中...' : '禁用'}</button>}
                      </div>
                    )) : <StatusBlock>暂无客服账号，可先创建一个客服账号。</StatusBlock>}
                  </div>
                </div>
              </div>
            )}
            {view === 'staffChat' && (
              <div className="mobile-panel-workspace">
                <section className="chat-panel" style={{ height: '100%' }}>
                  <SuperAdminStaffClearControl isSuper={isSuper} onCleared={fetchStaff} />
                  <div className="msgs">
                    {staffMsgs.length === 0 ? <StatusBlock>暂无内部消息，发送一条同步团队状态。</StatusBlock> : staffMsgs.map(m => (
                      <div key={m.id} className={'msg ' + (m.senderAdminId === admin?.id ? 'me' : '')}><b>{m.senderName}</b><div>{m.content}</div><div className="time">{formatTime(m.createdAt)}</div></div>
                    ))}
                  </div>
                  <form className="composer staff-composer" autoComplete="off" onSubmit={sendStaff}>
                    <input type="text" name="message" autoComplete="off" value={staffText} onChange={e => setStaffText(e.target.value)} disabled={staffSending} placeholder="输入内部消息..." />
                    <button type="submit" disabled={staffSending || !staffText.trim()}>{staffButtonLabel}</button>
                  </form>
                </section>
              </div>
            )}
          </>
        ) : (
          <>
            {view === 'sessions' ? (
              <div className="workspace">
                <section className="chat-panel">
                  {cur ? <div className="session-action-bar">
                    <div><b>{currentCustomerName}</b><span>{sessionGroupOf(cur) === 'archived' ? '已归档' : sessionGroupOf(cur) === 'trash' ? '回收站' : currentSessionEnded ? '已结束' : '进行中'}</span></div>
                    {renderCustomerRemarkEditor()}
                    {renderSessionLifecycleActions(cur)}
                    <SessionClientInfo session={cur} />
                  </div> : null}
                  {toast && <InlineNotice onDismiss={() => setToast('')}>{toast}</InlineNotice>}
                  <AdminMessageList
                    messages={selectedMsgs}
                    renderMessage={renderSelectedMessage}
                    loading={loadingMsgs === cur?.id}
                    showEmpty={(!loadingMsgs && selectedMsgs.length === 0 && cur && !cur.deletedAt) || !cur}
                    emptyText={cur ? (currentSessionEnded ? '历史已清空' : '暂无消息，选中输入框即可开始回复。') : '请选择左侧会话查看沟通记录。'}
                  />
                  {cur && !currentSessionEnded ? (
                    <form className="composer" autoComplete="off" onSubmit={e => { e.preventDefault(); send(); }}>
                      {quote ? <div className="quote-compose">{quote.status === 'recalled' ? '消息已撤回' : quote.messageType === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)}<button type="button" onClick={() => setQuote(null)}>取消</button></div> : null}
                      <label className="file-btn">{uploadButtonLabel}<input type="file" name="image" accept="image/jpeg,image/png,image/webp" disabled={sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>
                      <textarea ref={messageInputRef} name="message" autoComplete="off" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="输入消息" rows={1} />
                      <button type="submit" onMouseDown={e => e.preventDefault()} disabled={!text.trim() && !quote}>{sendButtonLabel}</button>
                    </form>
                  ) : (
                    <StatusBlock>{cur ? (sessionGroupOf(cur) === 'trash' ? '会话在回收站中。' : '会话已归档，消息输入已关闭。') : '请选择一个访客会话查看沟通记录。'}</StatusBlock>
                  )}
                </section>
              </div>
            ) : null}
            {view === 'operators' && isSuper ? (
              <div className="workspace">
                <aside className="admin-panel wide">
                  <h3 className="panel-title">创建客服</h3>
                  <form onSubmit={doCreateOperator} className="mini-form" autoComplete="off">
                    <input name="username" placeholder="用户名" required autoComplete="off" />
                    <input name="password" type="password" placeholder="密码（至少8位）" required autoComplete="new-password" />
                    <button type="submit" disabled={createOpLoading}>{createOpLoading ? '创建中...' : '创建'}</button>
                  </form>
                  <h3 className="panel-title">客服</h3>
                  <div className="operator-list">
                    {operators.length ? operators.map(op => (
                      <div className="operator-row" key={op.id}>
                        <div><b>{op.username}</b><span>{op.isDisabled ? '已禁用' : op.online ? '在线' : '离线'}{op.lastSeenAt ? ' · ' + new Date(op.lastSeenAt).toLocaleString() : ''}</span></div>
                        {op.isDisabled ? <span className="muted">已禁用</span> : <button type="button" className="btn danger" onClick={() => disableOp(op)} disabled={!!disableOpLoading}>{disableOpLoading === '禁用中...' ? '禁用中...' : '禁用'}</button>}
                      </div>
                    )) : <StatusBlock>暂无客服账号，可先创建一个客服账号。</StatusBlock>}
                  </div>
                </aside>
              </div>
            ) : null}
            {view === 'staffChat' ? (
              <div className="workspace">
                <section className="chat-panel">
                  <SuperAdminStaffClearControl isSuper={isSuper} onCleared={fetchStaff} />
                  <div className="msgs">
                    {staffMsgs.length === 0 ? <StatusBlock>暂无内部消息，发送一条同步团队状态。</StatusBlock> : staffMsgs.map(m => (
                      <div key={m.id} className={'msg ' + (m.senderAdminId === admin?.id ? 'me' : '')}><b>{m.senderName}</b><div>{m.content}</div><div className="time">{formatTime(m.createdAt)}</div></div>
                    ))}
                  </div>
                  <form className="composer staff-composer" autoComplete="off" onSubmit={sendStaff}>
                    <input type="text" name="message" autoComplete="off" value={staffText} onChange={e => setStaffText(e.target.value)} disabled={staffSending} placeholder="输入内部消息..." />
                    <button type="submit" disabled={staffSending || !staffText.trim()}>{staffButtonLabel}</button>
                  </form>
                </section>
              </div>
            ) : null}
          </>
        )}
      </main>

      {contextMenu && (() => {
        const items = adminMenuItems(contextMenu.msg);
        if (items.length === 0) return null;
        const mx = Math.min(contextMenu.x, window.innerWidth - 180);
        const my = Math.min(contextMenu.y, window.innerHeight - items.length * 44 - 10);
        return <div className="context-menu-overlay" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'transparent' }}>
          <div className="context-menu" style={{ position: 'fixed', left: mx, top: my, zIndex: 200, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 8px 32px var(--shadow)', padding: 6, display: 'grid', gap: 2, minWidth: 150 }}>
            {items.map((it, i) => <button type="button" key={i} onClick={it.action} disabled={it.disabled} style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 14, minHeight: 40, width: '100%', border: 0, cursor: it.disabled ? 'not-allowed' : 'pointer' }}>{it.label}{it.disabled && <span className="spinner" style={{ marginLeft: 8 }} />}</button>)}
          </div>
        </div>;
      })()}
    </div>
        <DesktopAdminPolish />
        <AdminMobileShell />
      </>
    </AdminWorkspaceProvider>
  );
}
