'use client';
import { useEffect, useState } from 'react';

export default function Admin() {
  const [admin, setAdmin] = useState<any>();
  const [sessions, setSessions] = useState<any[]>([]);
  const [cur, setCur] = useState<any>();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => { setAdmin(d.admin); if (d.admin) load(); }); }, []);
  useEffect(() => { if (!admin) return; const timer = window.setInterval(() => { load(); if (cur) open(cur, false); }, 3000); return () => window.clearInterval(timer); }, [admin, cur?.id]);

  async function load() { const r = await fetch('/api/sessions'); if (r.ok) { const d = await r.json(); setSessions(d.sessions); } }
  async function login(e: any) { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fd.get('u'), password: fd.get('p') }) }); if (r.ok) { const d = await r.json(); setAdmin(d.admin); await load(); } else alert('登录失败'); }
  async function open(s: any, markRead = true) { setCur(s); if (markRead) await fetch(`/api/sessions/${s.id}/read`, { method: 'POST' }); const r = await fetch('/api/visitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: s.visitor_key }) }); const d = await r.json(); setMsgs(d.messages); }
  async function act(path: string) { await fetch(path, { method: 'POST' }); await load(); if (cur) await open(cur, false); }
  async function send(imagePath?: string) { if (!cur || (!text.trim() && !imagePath)) return; await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: cur.id, senderType: 'OPERATOR', content: imagePath ? '' : text, messageType: imagePath ? 'image' : 'text', imagePath }) }); setText(''); await open(cur, false); }
  async function upload(e: any) { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/upload', { method: 'POST', body: fd }); const d = await r.json(); if (d.path) await send(d.path); else alert(d.error || '上传失败'); e.target.value = ''; }

  if (!admin) return <div className="page"><form className="login" onSubmit={login}><h2>客服后台登录</h2><input name="u" placeholder="账号" /><input name="p" type="password" placeholder="密码" /><button>登录</button></form></div>;
  return <div className="admin"><aside className="side"><h2>客服后台</h2>{['PENDING', 'OPEN', 'CLOSED', 'ARCHIVED'].map(st => <section key={st}><h3>{st}</h3>{sessions.filter(s => s.status === st).map(s => <div className={'session ' + (cur?.id === s.id ? 'active' : '')} onClick={() => open(s)} key={s.id}><b>{s.display_name}</b> {s.unread_count > 0 && <span className="badge">{s.unread_count}</span>}<p>{s.operator_name || '未接入'}</p></div>)}</section>)}</aside><main className="main"><div className="toolbar"><b>{cur?.display_name || '请选择会话'}</b>{cur && <><button onClick={() => act(`/api/sessions/${cur.id}/assign`)}>接入</button><button className="btn secondary" onClick={() => act(`/api/sessions/${cur.id}/close`)}>关闭</button></>}</div><div className="msgs">{msgs.map(m => <div key={m.id} className={'msg ' + (m.sender_type === 'OPERATOR' ? 'me' : '')}>{m.message_type === 'image' ? <img src={m.image_path} alt="聊天图片" /> : m.content}<div className="time">{new Date(m.created_at).toLocaleString()}</div></div>)}</div>{cur && <div className="composer"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /><input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} /><button onClick={() => send()}>回复</button></div>}</main></div>;
}
