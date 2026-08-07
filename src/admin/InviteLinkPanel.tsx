import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import type { OperatorSummary } from '../chatModel';
import { renderInviteQr } from './inviteQr';
import './operatorPresentation.css';

type InviteLinkPanelProps = {
  adminRole?: string;
  operators?: OperatorSummary[];
};

type InviteResponse = {
  invite?: {
    token?: string;
    url?: string;
  };
};

type OperatorPresentation = {
  operatorId?: string;
  displayName?: string;
  welcomeText: string;
  avatarUrl: string;
  qrBackgroundColor: string;
  qrTopText: string;
  qrBottomText: string;
};

type PresentationResponse = { presentation?: OperatorPresentation };

const DEFAULT_PRESENTATION: OperatorPresentation = {
  welcomeText: '您好，请问有什么可以帮您？',
  avatarUrl: '',
  qrBackgroundColor: '#ffffff',
  qrTopText: '扫码联系客服',
  qrBottomText: '',
};

const text = {
  title: '访客邀请链接',
  create: '创建一次性链接',
  creating: '创建中...',
  createFailed: '创建邀请链接失败',
  assignOperator: '指定客服',
  noOperator: '不指定客服',
  copied: '已复制',
  copy: '复制链接',
  copyFailed: '复制失败，请手动选择链接复制',
};

const visitorBaseUrl = () => {
  const configured = (import.meta.env.VITE_VISITOR_PUBLIC_BASE_URL as string | undefined)?.trim();
  return (configured || window.location.origin).replace(/\/+$/, '');
};

const visitorRootDomain = () => {
  return ((import.meta.env.VITE_VISITOR_ROOT_DOMAIN as string | undefined) || '').trim();
};

export default function InviteLinkPanel({ adminRole, operators = [] }: InviteLinkPanelProps) {
  const [sourceOperatorId, setSourceOperatorId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [presentation, setPresentation] = useState<OperatorPresentation>(DEFAULT_PRESENTATION);
  const [presentationLoading, setPresentationLoading] = useState(false);
  const [presentationSaving, setPresentationSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [qrError, setQrError] = useState('');
  const [desktopMode, setDesktopMode] = useState(() => window.innerWidth > 820);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const isSuper = adminRole === 'SUPER_ADMIN';

  const targetQuery = isSuper && sourceOperatorId
    ? `?operatorId=${encodeURIComponent(sourceOperatorId)}`
    : '';

  useEffect(() => {
    const onResize = () => {
      const nextDesktop = window.innerWidth > 820;
      setDesktopMode(nextDesktop);
      if (!nextDesktop) setDrawerOpen(false);
    };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const loadPresentation = async () => {
    setPresentationLoading(true);
    setError('');
    try {
      const res = await apiFetch<PresentationResponse>(`/api/admins/presentation${targetQuery}`);
      setPresentation({ ...DEFAULT_PRESENTATION, ...(res.presentation || {}) });
    } catch (err) {
      setError(getErrorMessage(err, '读取客服个性化设置失败'));
    } finally {
      setPresentationLoading(false);
    }
  };

  useEffect(() => {
    setInviteUrl('');
    setQrError('');
    loadPresentation();
  }, [targetQuery]);

  useEffect(() => {
    if (!inviteUrl || !qrCanvasRef.current) return;
    try {
      renderInviteQr(qrCanvasRef.current, inviteUrl, {
        backgroundColor: presentation.qrBackgroundColor,
        topText: presentation.qrTopText,
        bottomText: presentation.qrBottomText,
      });
      setQrError('');
    } catch (err) {
      setQrError(getErrorMessage(err, '二维码生成失败'));
    }
  }, [inviteUrl, presentation.qrBackgroundColor, presentation.qrTopText, presentation.qrBottomText, drawerOpen]);

  const savePresentation = async (showNotice = true) => {
    if (presentationSaving) return false;
    setPresentationSaving(true);
    setError('');
    try {
      const res = await apiFetch<PresentationResponse>(`/api/admins/presentation${targetQuery}`, {
        method: 'PUT',
        body: JSON.stringify({
          welcomeText: presentation.welcomeText,
          qrBackgroundColor: presentation.qrBackgroundColor,
          qrTopText: presentation.qrTopText,
          qrBottomText: presentation.qrBottomText,
        }),
      });
      setPresentation({ ...DEFAULT_PRESENTATION, ...(res.presentation || presentation) });
      if (showNotice) {
        setSavedNotice('已保存');
        setTimeout(() => setSavedNotice(''), 1800);
      }
      return true;
    } catch (err) {
      setError(getErrorMessage(err, '保存客服个性化设置失败'));
      return false;
    } finally {
      setPresentationSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (avatarUploading) return;
    setAvatarUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch<PresentationResponse>(`/api/admins/presentation/avatar${targetQuery}`, {
        method: 'POST',
        body: form,
      });
      setPresentation({ ...DEFAULT_PRESENTATION, ...(res.presentation || presentation) });
      setSavedNotice('头像已更新');
      setTimeout(() => setSavedNotice(''), 1800);
    } catch (err) {
      setError(getErrorMessage(err, '头像上传失败'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarUploading || !presentation.avatarUrl) return;
    setAvatarUploading(true);
    setError('');
    try {
      const res = await apiFetch<PresentationResponse>(`/api/admins/presentation/avatar${targetQuery}`, { method: 'DELETE' });
      setPresentation({ ...DEFAULT_PRESENTATION, ...(res.presentation || { ...presentation, avatarUrl: '' }) });
      setSavedNotice('已恢复默认头像');
      setTimeout(() => setSavedNotice(''), 1800);
    } catch (err) {
      setError(getErrorMessage(err, '删除头像失败'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const createInvite = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const saved = await savePresentation(false);
      if (!saved) return;
      const body = isSuper && sourceOperatorId ? { sourceOperatorId } : {};
      const res = await apiFetch<InviteResponse>('/api/invites', { method: 'POST', body: JSON.stringify(body) });
      const token = res?.invite?.token;
      const rootDomain = visitorRootDomain();
      let fullUrl: string;
      if (token && rootDomain) {
        fullUrl = `https://${token}.${rootDomain}/`;
      } else if (token) {
        fullUrl = `${visitorBaseUrl()}/g/${encodeURIComponent(token)}`;
      } else {
        const path = res?.invite?.url;
        if (!path) throw new Error(text.createFailed);
        fullUrl = path.startsWith('http') ? path : `${visitorBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
      }
      setInviteUrl(fullUrl);
    } catch (err) {
      setError(getErrorMessage(err, text.createFailed));
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      inviteInputRef.current?.focus();
      inviteInputRef.current?.select();
      setError(text.copyFailed);
    }
  };

  const downloadQr = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !inviteUrl) return;
    const link = document.createElement('a');
    link.download = `customer-service-qr-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const panel = (
    <section className="invite-panel operator-entry-panel">
      <div className="invite-panel-head">
        <h3>{text.title}</h3>
        <button type="button" onClick={createInvite} disabled={loading || presentationLoading}>{loading ? text.creating : text.create}</button>
      </div>
      {isSuper && operators.length > 0 ? (
        <select value={sourceOperatorId} onChange={e => setSourceOperatorId(e.target.value)} aria-label={text.assignOperator}>
          <option value="">{text.noOperator}</option>
          {operators.map(op => <option key={op.id} value={op.id}>{op.username}</option>)}
        </select>
      ) : null}

      <div className="operator-presentation-editor" aria-busy={presentationLoading}>
        <div className="operator-presentation-title">
          <b>{presentation.displayName || '客服个性化设置'}</b>
          {savedNotice ? <span>{savedNotice}</span> : null}
        </div>

        <label className="operator-setting-field">
          <span>欢迎词</span>
          <textarea
            rows={3}
            maxLength={300}
            value={presentation.welcomeText}
            onChange={e => setPresentation(prev => ({ ...prev, welcomeText: e.target.value }))}
            placeholder="访客进入会话后显示的欢迎词"
          />
        </label>

        <div className="operator-avatar-setting">
          <span>客服头像</span>
          <div className="operator-avatar-row">
            <div className="operator-avatar-preview">
              {presentation.avatarUrl
                ? <img src={presentation.avatarUrl} alt="客服头像" />
                : <span>{(presentation.displayName || '客').slice(0, 1)}</span>}
            </div>
            <label className="operator-avatar-upload">
              {avatarUploading ? '处理中...' : '上传头像'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={avatarUploading}
                onChange={e => { const file = e.target.files?.[0]; if (file) uploadAvatar(file); e.target.value = ''; }}
              />
            </label>
            {presentation.avatarUrl ? <button type="button" className="secondary" onClick={removeAvatar} disabled={avatarUploading}>恢复默认</button> : null}
          </div>
          <small>支持 JPG、PNG、WebP，最大 2MB。</small>
        </div>

        <div className="qr-customization-grid">
          <label className="operator-setting-field compact">
            <span>二维码背景</span>
            <input type="color" value={presentation.qrBackgroundColor} onChange={e => setPresentation(prev => ({ ...prev, qrBackgroundColor: e.target.value }))} />
          </label>
          <label className="operator-setting-field">
            <span>二维码上方文字</span>
            <input maxLength={80} value={presentation.qrTopText} onChange={e => setPresentation(prev => ({ ...prev, qrTopText: e.target.value }))} />
          </label>
          <label className="operator-setting-field">
            <span>二维码下方文字</span>
            <input maxLength={80} value={presentation.qrBottomText} onChange={e => setPresentation(prev => ({ ...prev, qrBottomText: e.target.value }))} />
          </label>
        </div>
        <small className="qr-color-warning">二维码背景过深可能降低扫码识别率，建议使用浅色背景。</small>
        <button type="button" className="presentation-save-button" onClick={() => savePresentation()} disabled={presentationSaving || presentationLoading}>{presentationSaving ? '保存中...' : '保存设置'}</button>
      </div>

      {inviteUrl ? (
        <div className="invite-result operator-invite-result">
          <div className="invite-link-actions">
            <input ref={inviteInputRef} value={inviteUrl} readOnly onFocus={e => e.currentTarget.select()} />
            <button type="button" onClick={copyInvite}>{copied ? text.copied : text.copy}</button>
          </div>
          <div className="invite-qr-preview">
            <canvas ref={qrCanvasRef} aria-label="一次性客服二维码" />
            <button type="button" onClick={downloadQr} disabled={!!qrError}>下载二维码 PNG</button>
          </div>
          {qrError ? <p className="form-error">{qrError}</p> : null}
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );

  if (!desktopMode) return panel;

  return (
    <>
      <button type="button" className="invite-settings-launcher" onClick={() => setDrawerOpen(true)}>
        <b>邀请与访客设置</b>
        <small>欢迎词 · 头像 · 一次性二维码</small>
      </button>
      {drawerOpen ? (
        <div className="invite-settings-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside className="invite-settings-drawer" onClick={event => event.stopPropagation()}>
            <div className="invite-settings-drawer-head">
              <h2>邀请与访客设置</h2>
              <button type="button" aria-label="关闭设置" onClick={() => setDrawerOpen(false)}>×</button>
            </div>
            {panel}
          </aside>
        </div>
      ) : null}
    </>
  );
}
