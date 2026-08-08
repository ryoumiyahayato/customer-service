import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './presetMessageEditor.css';

type PresetMessage = {
  id: string;
  position: number;
  messageType: 'text' | 'image';
  content: string;
  imageUrl?: string;
};

type PresetResponse = { messages?: PresetMessage[]; message?: PresetMessage };

export default function PresetMessageEditor() {
  const [messages, setMessages] = useState<PresetMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch<PresetResponse>('/api/admins/preset-messages', { retryGet: false });
      setMessages(Array.isArray(response.messages) ? response.messages : []);
    } catch (err) {
      setError(getErrorMessage(err, '读取预设消息失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addText = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch<PresetResponse>('/api/admins/preset-messages', {
        method: 'POST',
        body: JSON.stringify({ messageType: 'text', content }),
      });
      if (response.message) setMessages(prev => [...prev, response.message!]);
      else await load();
      setDraft('');
    } catch (err) {
      setError(getErrorMessage(err, '添加预设消息失败'));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await apiFetch<PresetResponse>('/api/admins/preset-messages/image', {
        method: 'POST',
        body: form,
      });
      if (response.message) setMessages(prev => [...prev, response.message!]);
      else await load();
    } catch (err) {
      setError(getErrorMessage(err, '添加预设图片失败'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/admins/preset-messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setMessages(prev => prev.filter(item => item.id !== id).map((item, index) => ({ ...item, position: index })));
      if (editingId === id) setEditingId('');
    } catch (err) {
      setError(getErrorMessage(err, '删除预设消息失败'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    const content = editingText.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch<PresetResponse>(`/api/admins/preset-messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      });
      if (response.message) setMessages(prev => prev.map(item => item.id === id ? response.message! : item));
      setEditingId('');
      setEditingText('');
    } catch (err) {
      setError(getErrorMessage(err, '修改预设消息失败'));
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= messages.length || busy) return;
    const next = [...messages];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setMessages(next.map((item, position) => ({ ...item, position })));
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch<PresetResponse>('/api/admins/preset-messages/order', {
        method: 'PUT',
        body: JSON.stringify({ ids: next.map(item => item.id) }),
      });
      if (Array.isArray(response.messages)) setMessages(response.messages);
    } catch (err) {
      setError(getErrorMessage(err, '调整发送顺序失败'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="preset-editor" aria-busy={loading || busy}>
      <header className="preset-editor-header">
        <div><b>预设消息</b><span>访客首次通过你的二维码建立会话后，由服务器按顺序发送；它们会成为真实聊天记录。</span></div>
        <small>最多 20 条；文字每条最多 1000 字；图片支持 JPG / PNG / WebP，最大 5MB。</small>
      </header>

      <div className="preset-chat-board" aria-label="预设消息可视化编辑器">
        <div className="preset-chat-empty-peer">预设发送</div>
        <div className="preset-chat-stream">
          {!loading && messages.length === 0 ? <p className="preset-empty">当前没有预设内容。访客进入后不会自动收到消息。</p> : null}
          {messages.map((item, index) => (
            <article className="preset-message-row" key={item.id}>
              <div className="preset-message-tools">
                <button type="button" onClick={() => void move(index, -1)} disabled={busy || index === 0} aria-label="上移">↑</button>
                <button type="button" onClick={() => void move(index, 1)} disabled={busy || index === messages.length - 1} aria-label="下移">↓</button>
                {item.messageType === 'text' ? <button type="button" onClick={() => { setEditingId(item.id); setEditingText(item.content); }}>编辑</button> : null}
                <button type="button" onClick={() => void remove(item.id)} disabled={busy}>删除</button>
              </div>
              <div className="preset-message-bubble">
                {editingId === item.id ? (
                  <div className="preset-inline-editor">
                    <textarea value={editingText} maxLength={1000} rows={4} onChange={event => setEditingText(event.target.value)} />
                    <div><button type="button" onClick={() => { setEditingId(''); setEditingText(''); }}>取消</button><button type="button" onClick={() => void saveEdit(item.id)} disabled={!editingText.trim() || busy}>保存</button></div>
                  </div>
                ) : item.messageType === 'image' ? (
                  <img src={item.imageUrl} alt="预设图片" loading="lazy" />
                ) : (
                  <p>{item.content}</p>
                )}
              </div>
            </article>
          ))}
        </div>

        <form className="preset-composer" onSubmit={addText}>
          <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
            event.currentTarget.value = '';
          }} />
          <button type="button" className="preset-image-button" onClick={() => uploadRef.current?.click()} disabled={busy || messages.length >= 20}>图片</button>
          <textarea rows={2} maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入一条预设消息…" onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
          <button type="submit" disabled={busy || !draft.trim() || messages.length >= 20}>发送</button>
        </form>
      </div>
      {error ? <p className="form-error preset-error">{error}</p> : null}
    </section>
  );
}
