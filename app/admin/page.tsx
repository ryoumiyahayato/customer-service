'use client';
import { useEffect, useState } from 'react';

type AdminUser = { id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; must_change_password?: number; created_at?: string };

export default function Admin() {
  const [admin, setAdmin] = useState<AdminUser | null>();
  const [sessions, setSessions] = useState<any[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [cur, setCur] = useState<any>();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const isSuper = admin?.role === 'SUPER_ADMIN';

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => { setAdmin(d.admin); if (d.admin) { load(); if (d.admin.role === 'SUPER_ADMIN') loadAdmins(); } }); }, []);
  useEffect(() => { if (!admin) return; const timer = window.setInterval(() => { load(); if (cur) open(cur, false); }, 3000); return () => window.clearInterval(timer); }, [admin?.id, cur?.id]);

  async function load() { const r = await fetch('/api/sessions'); if (r.ok) { const d = await r.json(); setSessions(d.sessions); } }
  async function loadAdmins() { const r = await fetch('/api/admins'); if (r.ok) { const d = await r.json(); setAdmins(d.admins); } }
  async function login(e: any) { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fd.get('u'), password: fd.get('p') }) }); if (r.ok) { const d = await r.json(); setAdmin(d.admin); await load(); if (d.admin.role === 'SUPER_ADMIN') await loadAdmins(); } else alert('登录失败'); }
  async function createOperator(e: any) { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await fetch('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), role: fd.get('role') }) }); if (r.ok) { e.currentTarget.reset(); await loadAdmins(); } else alert('创建失败，请检查是否重名'); }
  async function open(s: any, markRead = true) { setCur(s); if (markRead) await fetch(`/api/sessions/${s.id}/read`, { method: 'POST' }); const r = await fetch('/api/visitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: s.visitor_key }) }); const d = await r.json(); setMsgs(d.messages); }
  async function act(path: string) { await fetch(path, { method: 'POST' }); await load(); if (cur) await open(cur, false); }
  async function send(imagePath?: string) { if (!cur || (!text.trim() && !imagePath)) return; await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: cur.id, senderType: 'OPERATOR', content: imagePath ? '' : text, messageType: imagePath ? 'image' : 'text', imagePath }) }); setText(''); await open(cur, false); }
  async function upload(e: any) { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/upload', { method: 'POST', body: fd }); const d = await r.json(); if (d.path) await send(d.path); else alert(d.error || '上传失败'); e.target.value = ''; }

  if (admin === undefined) return <div className="page"><div className="login"><h2>正在加载</h2></div></div>;
  if (!admin) return <div className="page admin-login-page"><form className="login" onSubmit={login}><h2>客服后台登录</h2><input name="u" placeholder="账号" autoComplete="username" /><input name="p" type="password" placeholder="密码" autoComplete="current-password" /><button>登录</button></form></div>;
  return <div className="admin"><aside className="side"><div className="brand"><h2>客服工作台</h2><span>{isSuper ? '最高管理员' : '一般客服'}</span></div>{['PENDING', 'OPEN', 'CLOSED', 'ARCHIVED'].map(st => <section key={st}><h3>{st}</h3>{sessions.filter(s => s.status === st).map(s => <button className={'session ' + (cur?.id === s.id ? 'active' : '')} onClick={() => open(s)} key={s.id}><b>{s.display_name}</b>{s.unread_count > 0 ? <span className="badge">{s.unread_count}</span> : null}<p>{s.operator_name || '未接入'}</p></button>)}</section>)}</aside><main className="main"><div className="toolbar"><div><b>{cur?.display_name || '请选择会话'}</b><small>{admin.username} · {admin.role}</small></div>{cur ? <div className="toolbar-actions"><button onClick={() => act(`/api/sessions/${cur.id}/assign`)}>接入</button><button className="btn secondary" onClick={() => act(`/api/sessions/${cur.id}/close`)}>关闭</button></div> : null}</div><div className="workspace"><section className="chat-panel"><div className="msgs">{msgs.map(m => <div key={m.id} className={'msg ' + (m.sender_type === 'OPERATOR' ? 'me' : '')}>{m.message_type === 'image' ? <img src={m.image_path} alt="聊天图片" /> : m.content}<div className="time">{new Date(m.created_at).toLocaleString()}</div></div>)}</div>{cur ? <div className="composer"><label className="file-btn">图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label><input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="输入回复" /><button onClick={() => send()}>回复</button></div> : <div className="empty-state">从左侧选择一个访客会话</div>}</section>{isSuper ? <aside className="admin-panel"><h3>权限管理</h3><form onSubmit={createOperator} className="mini-form"><input name="username" placeholder="客服账号" required /><input name="password" type="password" placeholder="初始密码" required /><select name="role" defaultValue="OPERATOR"><option value="OPERATOR">一般客服</option><option value="SUPER_ADMIN">最高管理员</option></select><button>创建账号</button></form><div className="admin-list">{admins.map(a => <div key={a.id}><b>{a.username}</b><span>{a.role === 'SUPER_ADMIN' ? '最高管理员' : '一般客服'}</span></div>)}</div></aside> : null}</div></main></div>;
}
