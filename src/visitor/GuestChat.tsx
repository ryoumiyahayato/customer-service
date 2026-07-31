import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ApiError, apiFetch } from '../api';
import ChatMessageText from '../ChatMessageText';
import LinkExpired from '../common/LinkExpired';
import { copyText, getErrorMessage } from '../compat';
import GuestComposer from './GuestComposer';
import GuestMessageList from './GuestMessageList';
import { NetworkNotice } from '../ui/Notice';
import {
  fallbackDelay,
  isMessageCreatedEvent,
  isSessionEnded,
  parseChatRealtimeEvent,
  lastServerMessageTime,
  localMessageId,
  markMessageFailed,
  mergeMessage,
  mergeMessages,
  newClientMessageId,
  recordChatMetric,
  type ChatMessage,
  type ChatSession,
} from '../chatModel';
import '../styles.css';

type Message = ChatMessage;
type GuestBootstrapResponse = {
  visitorId?: string;
  session?: ChatSession;
  messages?: Message[];
};
type MessageListResponse = { messages?: Message[] };
type MessageMutationResponse = { message?: Message };
type UploadResponse = { path: string };

const INVITE_NOT_FOUND = 'invite-not-found';
const SERVER_ERROR_TEXT = '\u670d\u52a1\u5668\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
const SESSION_ENDED_ERROR = '\u4f1a\u8bdd\u5df2\u7ed3\u675f';
const inviteConsumeRequests = new Map<string, Promise<GuestBootstrapResponse>>();
const INIT_RETRY_DELAYS = [800, 1600, 3000];
const isUnreadOperatorMessage = (msg: Message, sessionId?: string) =>
    msg?.id &&
    !String(msg.id).startsWith('local-') &&
    (!sessionId || msg.sessionId === sessionId) &&
    msg.senderType === 'OPERATOR' &&
    !msg.isRead &&
    msg.status !== 'sending' &&
    msg.status !== 'failed' &&
    msg.status !== 'recalled' &&
    !msg.deletedAt;
const unreadOperatorMessageIds = (messages: Message[], sessionId?: string) => messages
  .filter((msg) => isUnreadOperatorMessage(msg, sessionId))
  .map((msg) => String(msg.id));
const markMessagesCustomerRead = (messages: Message[], messageIds: string[], readAt = new Date().toISOString()) => {
  const idSet = new Set(messageIds.map((id) => String(id)));
  return messages.map((msg) => idSet.has(String(msg.id))
    ? { ...msg, isRead: 1, status: msg.status === 'sent' ? 'read' : msg.status, readAt: msg.readAt || readAt }
    : msg);
};
const isNotFoundStatus = (status?: number) => status === 401 || status === 403 || status === 404 || status === 410;
const isInviteGoneStatus = (status?: number) => status === 404 || status === 410;
const isSessionGoneError = (error: unknown) =>
  error instanceof ApiError
  && (isNotFoundStatus(error.status) || (error.status === 400 && error.data?.error === SESSION_ENDED_ERROR));
const sessionUnavailable = isSessionEnded;

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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const customerReadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const customerReadInFlight = useRef(false);
  const customerReadSchedulerRef = useRef<(delay?: number) => void>(() => {});
  const initRetryCountRef = useRef(0);

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
    setContextMenu(null);
    localStorage.removeItem('chat_session_id');
    clearTimeout(initRetryTimer.current);
    clearTimeout(reconnectTimer.current);
    clearTimeout(fallbackTimer.current);
    clearTimeout(customerReadTimer.current);
    wsRef.current?.close();
  }, []);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => messagesEnd.current?.scrollIntoView({ behavior, block: 'end' }));
  }, []);
  const focusMessageInput = useCallback(() => {
    messageInputRef.current?.focus();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      setTimeout(() => messageInputRef.current?.focus(), 0);
    });
  }, []);
  const handleComposerFocus = useCallback(() => {
    setTimeout(() => scrollToBottom('auto'), 80);
    setTimeout(() => scrollToBottom('auto'), 260);
  }, [scrollToBottom]);

  useEffect(() => {
    const root = document.documentElement;
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = Math.max(320, Math.floor(viewport?.height || window.innerHeight));
      const offsetTop = Math.max(0, Math.floor(viewport?.offsetTop || 0));
      const keyboardOffset = Math.max(0, Math.floor(window.innerHeight - height - offsetTop));
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--keyboard-bottom-offset', `${keyboardOffset}px`);
    };
    const delayedScroll = () => {
      updateViewport();
      setTimeout(() => scrollToBottom('auto'), 80);
      setTimeout(() => scrollToBottom('auto'), 260);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', delayedScroll);
    window.visualViewport?.addEventListener('scroll', delayedScroll);
    addEventListener('resize', delayedScroll);
    addEventListener('orientationchange', delayedScroll);
    messageInputRef.current?.addEventListener('focus', delayedScroll);
    return () => {
      window.visualViewport?.removeEventListener('resize', delayedScroll);
      window.visualViewport?.removeEventListener('scroll', delayedScroll);
      removeEventListener('resize', delayedScroll);
      removeEventListener('orientationchange', delayedScroll);
      messageInputRef.current?.removeEventListener('focus', delayedScroll);
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--keyboard-bottom-offset');
    };
  }, [scrollToBottom]);

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
        request = apiFetch<GuestBootstrapResponse>(endpoint, { method: 'POST', body: JSON.stringify({ visitorId }) });
        inviteConsumeRequests.set(resolvedInviteToken, request);
      }
      const res = await request;
      if (!res.session) throw new Error(SERVER_ERROR_TEXT);
      if (sessionUnavailable(res.session)) {
        showNotFound();
        return null;
      }
      if (res.visitorId && res.visitorId !== visitorId) { setVisitorId(res.visitorId); localStorage.setItem('chat_visitor_id', res.visitorId); }
      if (res.session) { setSessionId(res.session.id); localStorage.setItem('chat_session_id', res.session.id); }
      if (res.messages) setMessages(mergeMessages([], res.messages));
      sessionClosedRef.current = false;
      setSessionClosed(false);
      initRetryCountRef.current = 0;
      clearTimeout(initRetryTimer.current);
      setAccessError(''); setOnline(false); setConnecting(false);
      return res.session?.id;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      const retryable = !isInviteGoneStatus(status);
      if (retryable) {
        inviteConsumeRequests.delete(resolvedInviteToken);
        consumeStartedRef.current = false;
      }
      if (isInviteGoneStatus(status)) {
        showNotFound();
        return null;
      }
      const retryIndex = initRetryCountRef.current;
      if (retryIndex < INIT_RETRY_DELAYS.length) {
        initRetryCountRef.current += 1;
        setAccessError('连接失败，正在重试...');
        setConnecting(false);
        setOnline(false);
        clearTimeout(initRetryTimer.current);
        initRetryTimer.current = setTimeout(() => {
          setConnecting(true);
          connect();
        }, INIT_RETRY_DELAYS[retryIndex]);
        return null;
      }
      setAccessError(getErrorMessage(error, '连接失败，请检查网络后点击重试'));
      setConnecting(false);
      setOnline(false);
      return null;
    }
  }, [visitorId, resolvedInviteToken, sessionId, showNotFound]);

  useEffect(() => { connect(); return () => clearTimeout(initRetryTimer.current); }, [connect]);

  const retryConnect = useCallback(() => {
    if (accessError === INVITE_NOT_FOUND || sessionClosed) return;
    clearTimeout(initRetryTimer.current);
    initRetryCountRef.current = 0;
    consumeStartedRef.current = false;
    inviteConsumeRequests.delete(resolvedInviteToken);
    setAccessError('');
    setNetworkBanner(false);
    setConnecting(true);
    connect();
  }, [accessError, connect, resolvedInviteToken, sessionClosed]);

  const wsConnect = useCallback((sid: string) => {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const connectStarted = performance.now();
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/conversations/${sid}`);
    ws.onopen = () => { recordChatMetric('ws_connect_ms', connectStarted); clearTimeout(fallbackTimer.current); fallbackMissesRef.current = 0; setOnline(true); setReconnecting(false); };
    ws.onclose = (e) => { console.debug('[chat_metric]', 'ws_close_code', e.code, { reason_length: e.reason?.length || 0 }); setOnline(false); if (sessionClosedRef.current) { setReconnecting(false); return; } setReconnecting(true); reconnectTimer.current = setTimeout(() => wsConnect(sid), 5000); };
    ws.onmessage = (e) => {
      try {
        const d = parseChatRealtimeEvent(JSON.parse(e.data));
        if (!d) return;
        if (isMessageCreatedEvent(d.type)) {
          setMessages(prev => {
            const next = mergeMessage(prev, d.message);
            messagesRef.current = next;
            return next;
          });
          if (document.visibilityState === 'visible' && isUnreadOperatorMessage(d.message, sid)) {
            setTimeout(() => customerReadSchedulerRef.current(180), 0);
          }
        }
        else if (d.type === 'message:updated') { setMessages(prev => { const next = mergeMessage(prev, d.message); messagesRef.current = next; return next; }); }
        else if (d.type === 'message:deleted') { setMessages(prev => { const next = prev.map(m => m.id === d.messageId ? { ...m, deletedAt: new Date().toISOString() } : m); messagesRef.current = next; return next; }); }
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
    const res = await apiFetch<MessageListResponse>(url, { retryGet: false });
    const incoming = Array.isArray(res.messages) ? res.messages : [];
    const count = incoming.length;
    recordChatMetric('fallback_fetch_ms', started, { merge_messages_count: count });
    if (count) {
      setMessages(prev => {
        const next = mergeMessages(prev, incoming);
        messagesRef.current = next;
        return next;
      });
      if (document.visibilityState === 'visible' && unreadOperatorMessageIds(incoming, sid).length) {
        setTimeout(() => customerReadSchedulerRef.current(180), 0);
      }
    }
    return count;
  }, []);

  const markLoadedOperatorMessagesRead = useCallback(async () => {
    if (!sessionId || accessError || sessionClosed || document.visibilityState !== 'visible' || customerReadInFlight.current) return;
    const ids = unreadOperatorMessageIds(messagesRef.current, sessionId);
    if (!ids.length) return;
    customerReadInFlight.current = true;
    try {
      await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/customer-read`, { method: 'POST', body: JSON.stringify({ messageIds: ids }) });
      setMessages(prev => {
        const next = markMessagesCustomerRead(prev, ids);
        messagesRef.current = next;
        return next;
      });
    } catch (error) {
      if (isSessionGoneError(error)) showNotFound();
    } finally {
      customerReadInFlight.current = false;
    }
  }, [accessError, sessionClosed, sessionId, showNotFound]);

  const scheduleCustomerRead = useCallback((delay = 250) => {
    clearTimeout(customerReadTimer.current);
    customerReadTimer.current = setTimeout(() => { markLoadedOperatorMessagesRead(); }, delay);
  }, [markLoadedOperatorMessagesRead]);
  customerReadSchedulerRef.current = scheduleCustomerRead;

  const scheduleFallback = useCallback((sid: string, delay = 0) => {
    clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(async () => {
      if (!sid || sessionClosedRef.current || onlineRef.current) return;
      try {
        const count = await syncMessages(sid);
        fallbackMissesRef.current = count ? 0 : fallbackMissesRef.current + 1;
      } catch (error) {
        fallbackMissesRef.current += 1;
        if (isSessionGoneError(error)) { showNotFound(); return; }
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
      if (document.visibilityState === 'hidden') return;
      setTimeout(() => scrollToBottom('auto'), 120);
      scheduleCustomerRead(120);
      if (!sessionId || online || sessionClosed || accessError) return;
      syncMessages(sessionId).catch((error) => { if (isSessionGoneError(error)) showNotFound(); });
    };
    addEventListener('focus', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);
    return () => { removeEventListener('focus', syncIfVisible); document.removeEventListener('visibilitychange', syncIfVisible); };
  }, [accessError, online, scheduleCustomerRead, scrollToBottom, sessionClosed, sessionId, showNotFound, syncMessages]);

  useEffect(() => {
    if (!unreadOperatorMessageIds(messages, sessionId).length) return;
    scheduleCustomerRead();
    return () => clearTimeout(customerReadTimer.current);
  }, [messages, scheduleCustomerRead, sessionId]);

  useEffect(() => {
    const retryIfVisible = () => {
      if (document.visibilityState === 'hidden' || !accessError || accessError === INVITE_NOT_FOUND || sessionClosed) return;
      retryConnect();
    };
    addEventListener('online', retryIfVisible);
    addEventListener('focus', retryIfVisible);
    document.addEventListener('visibilitychange', retryIfVisible);
    return () => {
      removeEventListener('online', retryIfVisible);
      removeEventListener('focus', retryIfVisible);
      document.removeEventListener('visibilitychange', retryIfVisible);
    };
  }, [accessError, retryConnect, sessionClosed]);

  useEffect(() => { const f = (e: StorageEvent) => { if (e.key === 'chat_visitor_id' && e.newValue && e.newValue !== visitorId) window.location.reload(); }; addEventListener('storage', f); return () => removeEventListener('storage', f); }, [visitorId]);
  useEffect(() => { scrollToBottom('smooth'); }, [messages, scrollToBottom]);
  useEffect(() => { if (networkBanner) { const t = setTimeout(() => setNetworkBanner(false), 10000); return () => clearTimeout(t); } }, [networkBanner]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('touchmove', close, { passive: true });
    document.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchmove', close);
      document.removeEventListener('scroll', close, { capture: true });
    };
  }, [contextMenu]);

  const send = async () => {
    if (accessError || sessionClosed || !sessionId) return;
    const content = text.trim();
    if (!content && !quote) return;
    const currentQuote = quote;
    const clientMessageId = newClientMessageId();
    const tempId = localMessageId(clientMessageId);
    const optimisticMessage: Message = {
      id: tempId,
      sessionId: sessionId,
      senderType: 'VISITOR',
      senderId: visitorId,
      content,
      messageType: 'text',
      imagePath: null,
      status: 'sending',
      createdAt: new Date().toISOString(),
      readAt: null,
      isRead: 0,
      quoteMessageId: currentQuote?.id || null,
      clientMessageId: clientMessageId
    };
    setMessages(prev => mergeMessage(prev, optimisticMessage));
    setText('');
    setQuote(null);
    setContextMenu(null);
    focusMessageInput();
    try {
      const postStarted = performance.now();
      const res = await apiFetch<MessageMutationResponse>('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content, senderType: 'VISITOR', quoteMessageId: currentQuote?.id || null }) });
      recordChatMetric('api_post_total_ms', postStarted);
      if (res?.message) setMessages(prev => mergeMessage(prev, res.message));
      syncMessages(sessionId).catch((error) => { if (isSessionGoneError(error)) showNotFound(); });
    } catch (error) { if (isSessionGoneError(error)) { showNotFound(); } else { setMessages(prev => markMessageFailed(prev, tempId)); showToast(getErrorMessage(error, '发送失败')); setNetworkBanner(true); } }
  };

  const upload = async (file: File) => {
    if (accessError || sessionClosed || !sessionId || sending === 'image') return;
    let tempId = '';
    sendingRef.current = true; setSending('image');
    try {
      const clientMessageId = newClientMessageId();
      const fd = new FormData(); fd.append('file', file); fd.append('sessionId', sessionId);
      const res = await apiFetch<UploadResponse>(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', body: fd });
      tempId = localMessageId(clientMessageId);
      setMessages(prev => mergeMessage(prev, { id: tempId, sessionId: sessionId, senderType: 'VISITOR', senderId: visitorId, content: '', messageType: 'image', imagePath: res.path, status: 'sending', createdAt: new Date().toISOString(), readAt: null, isRead: 0, quoteMessageId: null, clientMessageId: clientMessageId }));
      const msgRes = await apiFetch<MessageMutationResponse>('/api/messages', { method: 'POST', body: JSON.stringify({ sessionId, visitorId, clientMessageId, content: '', messageType: 'image', imagePath: res.path, senderType: 'VISITOR' }) });
      if (msgRes?.message) setMessages(prev => mergeMessage(prev, msgRes.message));
    } catch (error) { if (isSessionGoneError(error)) { showNotFound(); } else { if (tempId) setMessages(prev => markMessageFailed(prev, tempId)); showToast(getErrorMessage(error, '发送失败')); setNetworkBanner(true); } }
    sendingRef.current = false; setSending('idle');
  };

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => { e.preventDefault(); setContextMenu({ msg, x: e.clientX, y: e.clientY }); };
  const handleLongPress = useCallback((msg: Message) => (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('a,button')) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const timer = setTimeout(() => {
      window.getSelection()?.removeAllRanges();
      setContextMenu({ msg, x, y });
    }, 500);
    const clear = () => { clearTimeout(timer); e.target?.removeEventListener('touchend', clear); e.target?.removeEventListener('touchmove', clear); };
    e.target.addEventListener('touchend', clear, { once: true }); e.target.addEventListener('touchmove', clear, { once: true });
  }, []);

  const isOwn = (m: Message) => m.senderType === 'VISITOR';
  const copyMessageText = (content: string) => {
    copyText(content).then(() => showToast('已复制')).catch((error) => showToast(getErrorMessage(error, '复制失败')));
  };
  const menuItems = (msg: Message) => {
    const items: { label: string; action: () => void; disabled?: boolean }[] = [];
    if (msg.status !== 'recalled' && msg.messageType !== 'image' && msg.content) {
      items.push({
        label: '复制文本',
        action: () => {
          copyMessageText(String(msg.content || ''));
          setContextMenu(null);
        },
      });
    }
    if (msg.status !== 'recalled') items.push({ label: '引用', action: () => { setQuote(msg); setContextMenu(null); } });
    return items;
  };

  const renderVisitorMessage = (m: Message) => {
    const own = isOwn(m);
    return (
      <div key={m.id} className={`msg-row${own ? ' own' : ''}`}>
        {!own && <div className="message-avatar agent-avatar" aria-hidden="true">客</div>}
        {m.deletedAt ? (
          <div className={'msg ' + (own ? 'user' : 'agent')}><span className="recalled">消息已删除</span></div>
        ) : (
          <div className={'msg ' + (own ? 'user' : 'agent')} onContextMenu={(e) => handleContextMenu(e, m)}
            onTouchStart={isMobile && !m.deletedAt ? handleLongPress(m) : undefined}>
            {m.quoteMessageId && <div className="quote-box">{[messages.find(x => x.id === m.quoteMessageId)].map(q => q ? (q.status === 'recalled' ? '消息已撤回' : q.messageType === 'image' ? '[图片]' : q.content || '[未知消息]') : '引用消息不可用').join('')}</div>}
            {m.status === 'recalled' ? <span className="recalled">消息已撤回</span> : m.messageType === 'image' && m.imagePath ? <a className="message-image-link" href={m.imagePath} target="_blank" rel="noreferrer"><img src={m.imagePath} alt="图片" loading="lazy" /></a> : <ChatMessageText text={m.content || ''} />}
            {(m.status === 'sending' || m.status === 'failed') && <div className={`time message-status ${m.status}`}>{m.status === 'sending' ? '发送中...' : '发送失败，请稍后重试'}</div>}
          </div>
        )}
      </div>
    );
  };

  if (accessError === INVITE_NOT_FOUND || sessionClosed) return <LinkExpired />;
  // Keep transient network failures recoverable instead of showing a blank page.
  if (connecting) return <div className="chat-gate-page"><div className="chat-gate-card"><span className="spinner" /> <h1>正在连接客服</h1><p>正在建立安全会话，请稍候...</p></div></div>;
  if (accessError) return <div className="chat-gate-page"><div className="chat-gate-card error-state"><h1>连接暂时不可用</h1><p>{accessError}</p><button type="button" onClick={retryConnect}>重试连接</button></div></div>;

  return (
    <div className={`chat-page${!isMobile ? ' is-desktop' : ''}`}>
      <header className="chat-header">
        <div className="status-light"><span className="status-dot" style={{ background: online ? '#22c55e' : '#94a3b8', color: online ? '#22c55e' : '#94a3b8' }} />{reconnecting ? '正在重连...' : online ? '在线客服' : '正在连接...'}</div>
        <div className="header-right">
        </div>
      </header>
      {networkBanner && <NetworkNotice onDismiss={() => setNetworkBanner(false)}>网络不稳定，消息可能延迟同步；如发送失败请稍后重试</NetworkNotice>}
      {toast && <NetworkNotice tone="error" onDismiss={() => setToast('')}>{toast}</NetworkNotice>}
      <GuestMessageList
        messages={messages}
        renderMessage={renderVisitorMessage}
        messagesEndRef={messagesEnd}
        uploadingImage={sending === 'image'}
      />
      <GuestComposer
        quote={quote}
        uploadRef={uploadRef}
        messageInputRef={messageInputRef}
        text={text}
        disabled={sessionClosed || !!accessError || !sessionId}
        imageUploading={sending === 'image'}
        canSubmit={!(sessionClosed || !!accessError || !sessionId || (!text.trim() && !quote))}
        onSubmit={e => { e.preventDefault(); send(); }}
        onCancelQuote={() => setQuote(null)}
        onUploadChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        onTextChange={setText}
        onTextFocus={handleComposerFocus}
        onTextKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
      />

      {/* Context menu */}
      {contextMenu && (() => {
        const items = menuItems(contextMenu.msg);
        if (items.length === 0) return null;
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
