'use client';
import { useEffect, useRef, useState } from 'react';

type Mode = 'login' | 'register';
type Device = 'desktop' | 'android' | 'mobile';

export default function Home() {
  const [mode, setMode] = useState<Mode>('login');
  const [guest, setGuest] = useState(false);
  const [visitorId, setVisitorId] = useState('');
  const [account, setAccount] = useState<any>(null);
  const [session, setSession] = useState<any>();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [device, setDevice] = useState<Device>('desktop');
  const [authError, setAuthError] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);
  const isMobile = device !== 'desktop';
  const inChat = guest || account;

  async function refresh(currentVisitorId = visitorId) {
    if (!guest && !account) return;
    if (!currentVisitorId && typeof window !== 'undefined') currentVisitorId = localStorage.getItem('visitor_id') || '';
    const r = await fetch('/api/visitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: currentVisitorId }) });
    const d = await r.json();
    localStorage.setItem('visitor_id', d.visitorId);
    document.cookie = `visitor_id=${d.visitorId};path=/;max-age=31536000`;
    setVisitorId(d.visitorId);
    setAccount(d.account || null);
    setSession(d.session);
    setMsgs(d.messages || []);
  }
  useEffect(() => { const ua = navigator.userAgent.toLowerCase(); if (ua.includes('android')) setDevice('android'); else if (/iphone|ipad|ipod|mobile/.test(ua) || window.matchMedia('(max-width:760px)').matches) setDevice('mobile'); else setDevice('desktop'); }, []);
  useEffect(() => { if (!inChat) return; refresh(); const timer = window.setInterval(() => refresh(), 3000); return () => window.clearInterval(timer); }, [guest, account?.id]);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);

  async function submitAuth(e: any) { e.preventDefault(); setAuthError(''); const fd = new FormData(e.currentTarget); const path = mode === 'register' ? '/api/account/register' : '/api/login'; const oldVisitorId = localStorage.getItem('visitor_id') || ''; let claimGuest = false; let discardGuest = false; if (mode === 'register' && oldVisitorId.startsWith('visitor_')) { claimGuest = confirm('是否把本设备游客时期的聊天记录绑定到这个新账号？选择取消将删除本设备游客聊天记录。'); discardGuest = !claimGuest; } const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), displayName: fd.get('displayName'), visitorId: oldVisitorId, claimGuest, discardGuest }) }); const d = await r.json(); if (!r.ok) { if (d.disabled) alert('该账户权限已被禁用'); setAuthError(d.error || '登录失败'); return; } if (d.type === 'admin') { location.href = '/admin'; return; } setAccount(d.account); setGuest(false); if (discardGuest) localStorage.removeItem('visitor_id'); await refresh(''); }
  async function send(imagePath?: string) { if (!text.trim() && !imagePath) return; const currentVisitorId = visitorId || localStorage.getItem('visitor_id') || ''; const body = { sessionId: session?.id, visitorId: currentVisitorId, senderType: 'VISITOR', content: imagePath ? '' : text, messageType: imagePath ? 'image' : 'text', imagePath, quoteMessageId: quote?.id }; setText(''); setQuote(null); const r = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (d.session) setSession(d.session); await refresh(currentVisitorId); }
  async function upload(e: any) { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/upload', { method: 'POST', body: fd }); const d = await r.json(); if (d.path) await send(d.path); else alert(d.error || '上传失败'); e.target.value = ''; }
  function quoteText(id: string) { const m = msgs.find(x => x.id === id); if (!m) return '引用的消息'; if (m.status === 'recalled') return '消息已撤回'; return m.message_type === 'image' ? '[图片]' : m.content; }

  return <div className={'page support-page ' + (isMobile ? 'mobile-shell ' : 'desktop-shell ') + device}><section className="support-card"><aside className="welcome-panel"><div className="welcome-copy"><h1>在线客服</h1></div>{!inChat ? <div className="auth-box"><div className="auth-tabs two"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button></div><form className="auth-form" onSubmit={submitAuth}>{mode === 'register' ? <input name="displayName" placeholder="昵称，可选" autoComplete="nickname" /> : null}<input name="username" placeholder="账号" autoComplete="username" required /><input name="password" type="password" placeholder="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><button>{mode === 'login' ? '登录' : '注册并进入'}</button>{authError ? <p className="form-error">{authError}</p> : null}</form><button className="guest-link" onClick={() => { setGuest(true); refresh(''); }}>游客进入</button></div> : <div className="guest-box"><b>{account ? account.display_name : `游客 ${visitorId.slice(-6)}`}</b><p>{account ? '普通用户身份咨询。' : '游客身份仅保存在当前浏览器。'}</p></div>}</aside><main className="chat"><div className="head"><div><b>{session?.status === 'OPEN' ? '客服正在接待' : '正在等待客服接入'}</b><span>{account ? account.display_name : inChat ? `访客 ${visitorId.slice(-6)}` : '请先登录或游客进入'}</span></div><small>{msgs.length} 条消息</small></div><div className="msgs">{msgs.map(m => <div key={m.id} className={'msg ' + (m.sender_type === 'VISITOR' ? 'me' : '')}>{m.quote_message_id ? <div className="quote-box">{quoteText(m.quote_message_id)}</div> : null}{m.status === 'recalled' ? <span>消息已撤回</span> : m.message_type === 'image' && m.image_path ? <img src={m.image_path} alt="聊天图片" /> : <span>{m.content || '[图片已清除]'}</span>}<button className="msg-action" onClick={() => setQuote(m)}>引用</button></div>)}<div ref={end} /></div>{inChat ? <div className="composer">{quote ? <div className="quote-compose">引用：{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : quote.content}<button onClick={() => setQuote(null)}>取消</button></div> : null}<label className="file-btn">图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label><input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="请输入消息" /><button onClick={() => send()}>发送</button></div> : <div className="empty-state">登录、注册或游客进入后即可发送消息</div>}</main></section></div>;
}

