import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import type { OperatorSummary } from '../chatModel';
import { QR_CARD_TEXT_MAX_LENGTH } from '../operatorPresentation';
import {
  DEFAULT_VISITOR_ROOT_DOMAIN,
  buildVisitorInviteUrl,
  extractVisitorSubdomainToken,
  isLocalDevelopmentHost,
  normalizePublicHost,
} from '../domainIsolation';
import { renderInviteQr } from './inviteQr';
import './operatorPresentation.css';

type InviteLinkPanelProps = {
  adminRole?: string;
  operators?: OperatorSummary[];
  workspace?: boolean;
};

type InviteResponse = {
  invite?: {
    token?: string;
    url?: string;
    expiresAt?: string;
    expires_at?: string;
    inviteHandle?: string;
    qrMatrix?: boolean[][];
    rawLinkVisible?: boolean;
  };
};

type InviteStatusResponse = {
  invite?: {
    handle?: string;
    state?: 'active' | 'consumed' | 'revoked' | 'expired';
    expiresAt?: string;
  };
};

type OperatorPresentation = {
  operatorId?: string;
  displayName?: string;
  welcomeText?: string;
  avatarUrl?: string;
  qrBackgroundColor: string;
  qrAccentColor: string;
  qrTopText: string;
  qrBottomText: string;
};

type PresentationResponse = { presentation?: OperatorPresentation };

type CachedInvite = {
  handle: string;
  url: string;
  matrix: boolean[][] | null;
  expiresAt: string;
};

// Deliberately memory-only: QR state survives navigation inside the current admin SPA,
// but the bearer invite itself is never persisted to browser storage.
const activeInviteCache = new Map<string, CachedInvite>();

const DEFAULT_PRESENTATION: OperatorPresentation = {
  qrBackgroundColor: '#ffffff',
  qrAccentColor: '#18b868',
  qrTopText: '扫码联系客服',
  qrBottomText: '企业客服 · 在线咨询',
};

const COLOR_PRESETS = [
  { label: '亮绿', value: '#18b868' },
  { label: '亮橙', value: '#ff8a1f' },
  { label: '亮蓝', value: '#2388ff' },
  { label: '亮黄', value: '#f4c542' },
];

const visitorRootDomain = () => normalizePublicHost(
  (import.meta.env.VITE_VISITOR_ROOT_DOMAIN as string | undefined) || DEFAULT_VISITOR_ROOT_DOMAIN,
) || DEFAULT_VISITOR_ROOT_DOMAIN;

const safeVisitorInviteUrl = (value: string) => {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    const root = visitorRootDomain();
    const local = isLocalDevelopmentHost(url.hostname);
    if (local) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.toString();
    }
    if (url.protocol !== 'https:') return '';
    const token = extractVisitorSubdomainToken(url.hostname, root);
    if (!token) return '';
    if (url.pathname !== '/' || url.search || url.hash) return '';
    return `https://${token}.${root}/`;
  } catch {
    return '';
  }
};

const limitQrText = (value: string) => Array.from(value).slice(0, QR_CARD_TEXT_MAX_LENGTH).join('');

export default function InviteLinkPanel({ adminRole, operators = [], workspace = false }: InviteLinkPanelProps) {
  const [sourceOperatorId, setSourceOperatorId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteMatrix, setInviteMatrix] = useState<boolean[][] | null>(null);
  const [inviteHandle, setInviteHandle] = useState('');
  const [inviteExpiresAt, setInviteExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [presentation, setPresentation] = useState<OperatorPresentation>(DEFAULT_PRESENTATION);
  const [presentationLoading, setPresentationLoading] = useState(false);
  const [presentationSaving, setPresentationSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [qrError, setQrError] = useState('');
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const isSuper = adminRole === 'SUPER_ADMIN';

  const targetQuery = isSuper && sourceOperatorId ? `?operatorId=${encodeURIComponent(sourceOperatorId)}` : '';
  const cacheKey = useMemo(
    () => isSuper ? `super:${sourceOperatorId || 'unassigned'}` : 'operator:self',
    [isSuper, sourceOperatorId],
  );

  const clearInvite = (key = cacheKey) => {
    activeInviteCache.delete(key);
    setInviteUrl('');
    setInviteMatrix(null);
    setInviteHandle('');
    setInviteExpiresAt('');
    setCopied(false);
    setQrError('');
  };

  const checkInviteState = async (handle: string, key = cacheKey) => {
    if (!handle) return false;
    try {
      const response = await apiFetch<InviteStatusResponse>(`/api/invites/${encodeURIComponent(handle)}/status`, { retryGet: false });
      if (response.invite?.state !== 'active') {
        clearInvite(key);
        return false;
      }
      return true;
    } catch {
      // Do not destroy an otherwise usable QR on a transient status-check failure.
      return true;
    }
  };

  const loadPresentation = async () => {
    setPresentationLoading(true);
    setError('');
    try {
      const response = await apiFetch<PresentationResponse>(`/api/admins/presentation${targetQuery}`, { retryGet: false });
      const next = { ...DEFAULT_PRESENTATION, ...(response.presentation || {}) };
      setPresentation({ ...next, qrTopText: limitQrText(next.qrTopText), qrBottomText: limitQrText(next.qrBottomText) });
    } catch (err) {
      setError(getErrorMessage(err, '读取二维码设置失败'));
    } finally {
      setPresentationLoading(false);
    }
  };

  useEffect(() => {
    const cached = activeInviteCache.get(cacheKey);
    if (cached && (!cached.expiresAt || Date.parse(cached.expiresAt) > Date.now())) {
      setInviteUrl(cached.url);
      setInviteMatrix(cached.matrix);
      setInviteHandle(cached.handle);
      setInviteExpiresAt(cached.expiresAt);
      void checkInviteState(cached.handle, cacheKey);
    } else {
      clearInvite(cacheKey);
    }
    loadPresentation();
  }, [targetQuery, cacheKey]);

  useEffect(() => {
    if (!inviteHandle) return;
    const timer = window.setInterval(() => {
      void checkInviteState(inviteHandle, cacheKey);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [inviteHandle, cacheKey]);

  useEffect(() => {
    if (!inviteExpiresAt) return;
    const remaining = Date.parse(inviteExpiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearInvite(cacheKey);
      return;
    }
    const timer = window.setTimeout(() => clearInvite(cacheKey), Math.min(remaining + 250, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [inviteExpiresAt, cacheKey]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    try {
      renderInviteQr(canvas, inviteUrl, {
        backgroundColor: presentation.qrBackgroundColor,
        accentColor: presentation.qrAccentColor,
        topText: '',
        bottomText: '',
      }, inviteMatrix);
      setQrError('');
    } catch (err) {
      setQrError(getErrorMessage(err, '二维码生成失败'));
    }
  }, [inviteUrl, inviteMatrix, presentation.qrBackgroundColor, presentation.qrAccentColor]);

  const saveQrSettings = async (showNotice = true) => {
    if (presentationSaving) return false;
    setPresentationSaving(true);
    setError('');
    try {
      const response = await apiFetch<PresentationResponse>(`/api/admins/presentation${targetQuery}`, {
        method: 'PUT',
        body: JSON.stringify({
          qrBackgroundColor: presentation.qrBackgroundColor,
          qrAccentColor: presentation.qrAccentColor,
          qrTopText: limitQrText(presentation.qrTopText),
          qrBottomText: limitQrText(presentation.qrBottomText),
        }),
      });
      setPresentation(prev => ({ ...prev, ...(response.presentation || {}) }));
      if (showNotice) {
        setSavedNotice('已保存');
        setTimeout(() => setSavedNotice(''), 1800);
      }
      return true;
    } catch (err) {
      setError(getErrorMessage(err, '保存二维码设置失败'));
      return false;
    } finally {
      setPresentationSaving(false);
    }
  };

  const createInvite = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const saved = await saveQrSettings(false);
      if (!saved) return;
      const body = isSuper && sourceOperatorId ? { sourceOperatorId } : {};
      const response = await apiFetch<InviteResponse>('/api/invites', { method: 'POST', body: JSON.stringify(body) });
      const invite = response?.invite || {};
      const token = String(invite.token || '').trim();
      let fullUrl = safeVisitorInviteUrl(String(invite.url || ''));
      if (!fullUrl && token) fullUrl = buildVisitorInviteUrl(token, visitorRootDomain());
      const matrix = invite.qrMatrix?.length ? invite.qrMatrix : null;
      const handle = String(invite.inviteHandle || '').trim();
      const expiresAt = String(invite.expiresAt || invite.expires_at || '').trim();

      if (!fullUrl && !matrix) throw new Error('访客邀请域名配置异常，已拒绝生成后台域名链接');
      if (!handle) throw new Error('邀请状态句柄缺失，请重新生成二维码');
      const cached = { handle, url: fullUrl, matrix, expiresAt };
      activeInviteCache.set(cacheKey, cached);
      setInviteUrl(fullUrl);
      setInviteMatrix(matrix);
      setInviteHandle(handle);
      setInviteExpiresAt(expiresAt);
    } catch (err) {
      setError(getErrorMessage(err, '创建邀请二维码失败'));
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl || !isSuper) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      inviteInputRef.current?.focus();
      inviteInputRef.current?.select();
      setError('复制失败，请手动选择链接复制');
    }
  };

  const downloadQr = () => {
    if ((!inviteUrl && !inviteMatrix) || qrError) return;
    const canvas = document.createElement('canvas');
    renderInviteQr(canvas, inviteUrl, {
      backgroundColor: presentation.qrBackgroundColor,
      accentColor: presentation.qrAccentColor,
      topText: limitQrText(presentation.qrTopText),
      bottomText: limitQrText(presentation.qrBottomText),
    }, inviteMatrix);
    const link = document.createElement('a');
    link.download = `customer-service-qr-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const hasActiveInvite = Boolean(inviteUrl || inviteMatrix);
  const editor = (
    <div className="qr-workspace-editor-content" aria-busy={presentationLoading}>
      <div className="invite-panel-head">
        <div><h3>二维码</h3><small>{savedNotice || (hasActiveInvite ? '等待访客打开 · 使用后自动消失' : '一次性邀请 · 24 小时有效')}</small></div>
        <button type="button" onClick={createInvite} disabled={loading || presentationLoading}>{loading ? '生成中…' : hasActiveInvite ? '重新生成' : '生成新二维码'}</button>
      </div>

      {isSuper && operators.length > 0 ? (
        <label className="operator-setting-field">
          <span>指定客服</span>
          <select value={sourceOperatorId} onChange={event => setSourceOperatorId(event.target.value)}>
            <option value="">不指定客服</option>
            {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.username}</option>)}
          </select>
        </label>
      ) : null}

      <div className="qr-preset-block">
        <span>预设边框颜色</span>
        <div className="qr-color-presets">
          {COLOR_PRESETS.map(item => (
            <button key={item.value} type="button" className={presentation.qrAccentColor.toLowerCase() === item.value ? 'active' : ''} onClick={() => setPresentation(prev => ({ ...prev, qrAccentColor: item.value }))}>
              <i style={{ background: item.value }} />{item.label}
            </button>
          ))}
        </div>
      </div>

      <label className="operator-setting-field compact">
        <span>自定义边框 / 底栏</span>
        <input type="color" value={presentation.qrAccentColor} onChange={event => setPresentation(prev => ({ ...prev, qrAccentColor: event.target.value }))} />
      </label>
      <label className="operator-setting-field compact">
        <span>二维码内部背景</span>
        <input type="color" value={presentation.qrBackgroundColor} onChange={event => setPresentation(prev => ({ ...prev, qrBackgroundColor: event.target.value }))} />
      </label>

      <p className="qr-edit-hint">文字直接在右侧/下方二维码卡片上点选修改；上下文字各最多 {QR_CARD_TEXT_MAX_LENGTH} 个字符。</p>
      <button type="button" className="presentation-save-button" onClick={() => saveQrSettings()} disabled={presentationSaving || presentationLoading}>{presentationSaving ? '保存中…' : '保存二维码样式'}</button>

      {isSuper && inviteUrl ? (
        <div className="invite-link-actions raw-invite-link">
          <label>具体邀请链接（仅超级管理员可见）</label>
          <input ref={inviteInputRef} value={inviteUrl} readOnly onFocus={event => event.currentTarget.select()} />
          <button type="button" onClick={copyInvite}>{copied ? '已复制' : '复制链接'}</button>
        </div>
      ) : null}
      {!isSuper && hasActiveInvite ? <p className="operator-link-hidden-note">客服账号只获得可发送的二维码，不返回具体邀请链接文本。</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );

  const preview = (
    <div className="qr-visual-preview">
      <div className="qr-preview-title"><b>实时预览</b><span>{hasActiveInvite ? '已生成一次性二维码 · 使用后自动清除' : '先看版式，生成后自动填入二维码'}</span></div>
      <div className="invite-qr-canvas-shell">
        <canvas ref={qrCanvasRef} aria-label="客服邀请二维码预览" />
        <input className="qr-direct-text qr-direct-top" maxLength={QR_CARD_TEXT_MAX_LENGTH} value={presentation.qrTopText} onChange={event => setPresentation(prev => ({ ...prev, qrTopText: limitQrText(event.target.value) }))} aria-label="直接编辑二维码顶部文字" placeholder="点击输入顶部文字" />
        <input className="qr-direct-text qr-direct-bottom" maxLength={QR_CARD_TEXT_MAX_LENGTH} value={presentation.qrBottomText} onChange={event => setPresentation(prev => ({ ...prev, qrBottomText: limitQrText(event.target.value) }))} aria-label="直接编辑二维码底栏文字" placeholder="点击输入底栏文字" />
      </div>
      <div className="qr-preview-actions">
        <button type="button" onClick={downloadQr} disabled={!hasActiveInvite || !!qrError}>下载 PNG</button>
        <small>边框与底栏使用同一强调色；二维码主体保持浅色背景以保证识别率。</small>
      </div>
      {qrError ? <p className="form-error">{qrError}</p> : null}
    </div>
  );

  if (workspace) {
    return <section className="invite-workspace-shell"><aside className="invite-workspace-editor">{editor}</aside><main className="invite-workspace-preview">{preview}</main></section>;
  }

  return <section className="invite-panel operator-entry-panel qr-only-panel">{editor}{preview}</section>;
}
