'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

type AuthMode = 'guest' | 'login' | 'register';

export default function Home() {
  const [visitorId, setVisitorId] = useState('');
  const [account, setAccount] = useState<any>(null);
  const [session, setSession] = useState<any>();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AuthMode>('guest');
  const [device, setDevice] = useState<'desktop' | 'android' | 'mobile'>('desktop');
  const [authError, setAuthError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const isMobile = device !== 'desktop';
  const title = useMemo(() => account ? `${account.display_name}，欢迎回来` : '游客也可以直接咨询', [account]);

  async function refresh(currentVisitorId = visitorId) {
    if (!currentVisitorId && typeof window !== 'undefined') currentVisitorId = localStorage.getItem('visitor_id') || '';
    const r = await fetch('/api/visitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: currentVisitorId }) });
    const d = await r.json();
    localStorage.setItem('visitor_id', d.visitorId);
    document.cookie = `visitor_id=${d.visitorId};path=/;max-age=31536000`;
    setVisitorId(d.visitorId);
    setAccount(d.account || null);
    setSession(d.session);
    setMsgs(d.messages);
  }

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android')) setDevice('android');
    else if (/iphone|ipad|ipod|mobile/.test(ua) || window.matchMedia('(max-width: 760px)').matches) setDevice('mobile');
    else setDevice('desktop');
    refresh();
    const timer = window.setInterval(() => refresh(), 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);

  async function send(imagePath?: string) {
    if (!session || (!text.trim() && !imagePath)) return;
    const body = { sessionId: session.id, visitorId, senderType: 'VISITOR', content: imagePath ? '' : text, messageType: imagePath ? 'image' : 'text', imagePath };
    setText('');
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await refresh(visitorId);
  }

  async function upload(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd }); const d = await r.json();
    if (d.path) await send(d.path); else alert(d.error || '上传失败');
    e.target.value = '';
  }

  async function submitAuth(e: any) {
    e.preventDefault(); setAuthError('');
    const fd = new FormData(e.currentTarget);
    const path = mode === 'register' ? '/api/account/register' : '/api/account/login';
    const body = { username: fd.get('username'), password: fd.get('password'), displayName: fd.get('displayName') };
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setAuthError(d.error || '操作失败'); return; }
    setAccount(d.account); setMode('guest'); await refresh('');
  }

  async function logout() { await fetch('/api/account/logout', { method: 'POST' }); setAccount(null); localStorage.removeItem('visitor_id'); await refresh(''); }

  return <div className={'page support-page ' + (isMobile ? 'mobile-shell ' : 'desktop-shell ') + device}>
    <section className="support-card">
      <aside className="welcome-panel">
        <div className="welcome-copy"><h1>在线客服</h1><p>{title}</p><span>{device === 'android' ? '安卓浏览器已适配' : isMobile ? '移动浏览器已适配' : 'PC / Mac 桌面体验'}</span></div>
        <div className="auth-box"><div className="auth-tabs"><button className={mode === 'guest' ? 'active' : ''} onClick={() => setMode('guest')}>游客</button><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button></div>{mode === 'guest' ? <div className="guest-box"><b>{account ? account.username : '无需账号，直接发送消息'}</b><p>{account ? '当前使用账号身份咨询。账号超过一周未登录会自动删除。' : '游客身份会保存在当前浏览器，也可以注册账号保留身份。'}</p>{account ? <button className="btn secondary" onClick={logout}>退出账号</button> : <button onClick={() => refresh(visitorId)}>游客继续</button>}</div> : <form className="auth-form" onSubmit={submitAuth}>{mode === 'register' ? <input name="displayName" placeholder="昵称，可选" /> : null}<input name="username" placeholder="账号" autoComplete="username" required /><input name="password" type="password" placeholder="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><button>{mode === 'login' ? '登录' : '注册并进入'}</button>{authError ? <p className="form-error">{authError}</p> : null}</form>}</div>
      </aside>
      <main className="chat"><div className="head"><div><b>{session?.status === 'OPEN' ? '客服正在接待' : '正在等待客服接入'}</b><span>{account ? account.display_name : `访客 ${visitorId.slice(-6)}`}</span></div><small>{msgs.length} 条消息</small></div><div className="msgs">{msgs.map(m => <div key={m.id} className={'msg ' + (m.sender_type === 'VISITOR' ? 'me' : '')}>{m.message_type === 'image' ? <img src={m.image_path} alt="聊天图片" /> : <span>{m.content}</span>}<div className="time">{new Date(m.created_at).toLocaleString()}</div></div>)}<div ref={end} /></div><div className="composer"><label className="file-btn">图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label><input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="请输入消息" /><button onClick={() => send()}>发送</button></div></main>
    </section>
  </div>;
}
