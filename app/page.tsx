'use client';
import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const [visitorId, setVisitorId] = useState('');
  const [session, setSession] = useState<any>();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  async function refresh(currentVisitorId = visitorId) {
    if (!currentVisitorId && typeof window !== 'undefined') currentVisitorId = localStorage.getItem('visitor_id') || '';
    const r = await fetch('/api/visitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: currentVisitorId }) });
    const d = await r.json();
    localStorage.setItem('visitor_id', d.visitorId);
    document.cookie = `visitor_id=${d.visitorId};path=/;max-age=31536000`;
    setVisitorId(d.visitorId);
    setSession(d.session);
    setMsgs(d.messages);
  }

  useEffect(() => { refresh(); const timer = window.setInterval(() => refresh(), 3000); return () => window.clearInterval(timer); }, []);
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
    const fd = new FormData();
    fd.append('file', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.path) await send(d.path); else alert(d.error || '上传失败');
    e.target.value = '';
  }

  return <div className="page"><div className="chat"><div className="head"><b>在线客服</b><span>{session?.status === 'OPEN' ? '客服在线接待中' : '等待客服接入'}</span></div><div className="msgs">{msgs.map(m => <div key={m.id} className={'msg ' + (m.sender_type === 'VISITOR' ? 'me' : '')}>{m.message_type === 'image' ? <img src={m.image_path} alt="聊天图片" /> : <span>{m.content}</span>}<div className="time">{new Date(m.created_at).toLocaleString()}</div></div>)}<div ref={end} /></div><div className="composer"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /><input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="请输入消息" /><button onClick={() => send()}>发送</button></div></div></div>;
}
