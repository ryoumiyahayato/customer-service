import { useRef, useState } from 'react';
import { apiFetch } from '../api';

type InviteLinkPanelProps = {
  adminRole?: string;
  operators?: any[];
};

const text = {
  title: '\u8bbf\u5ba2\u9080\u8bf7\u94fe\u63a5',
  create: '\u521b\u5efa\u94fe\u63a5',
  creating: '\u521b\u5efa\u4e2d...',
  createFailed: '\u521b\u5efa\u9080\u8bf7\u94fe\u63a5\u5931\u8d25',
  assignOperator: '\u6307\u5b9a\u5ba2\u670d',
  noOperator: '\u4e0d\u6307\u5b9a\u5ba2\u670d',
  copied: '\u5df2\u590d\u5236',
  copy: '\u590d\u5236\u94fe\u63a5',
  copyFailed: '\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u9009\u62e9\u94fe\u63a5\u590d\u5236',
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
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const isSuper = adminRole === 'SUPER_ADMIN';

  const createInvite = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const body = isSuper && sourceOperatorId ? { sourceOperatorId } : {};
      const res: any = await apiFetch('/api/invites', { method: 'POST', body: JSON.stringify(body) });
      const token = res?.invite?.token;
      const rootDomain = visitorRootDomain();
      let fullUrl: string;
      if (token && rootDomain) {
        // New subdomain format: https://<token>.vx9qn7zr.org/
        fullUrl = `https://${token}.${rootDomain}/`;
      } else if (token) {
        // Fallback: https://<origin>/g/<token>
        fullUrl = `${visitorBaseUrl()}/g/${encodeURIComponent(token)}`;
      } else {
        const path = res?.invite?.url;
        if (!path) throw new Error(text.createFailed);
        fullUrl = path.startsWith('http') ? path : `${visitorBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
      }
      setInviteUrl(fullUrl);
    } catch (e: any) {
      setError(e?.message || text.createFailed);
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

  return (
    <section className="invite-panel">
      <div className="invite-panel-head">
        <h3>{text.title}</h3>
        <button type="button" onClick={createInvite} disabled={loading}>{loading ? text.creating : text.create}</button>
      </div>
      {isSuper && operators.length > 0 ? (
        <select value={sourceOperatorId} onChange={e => setSourceOperatorId(e.target.value)} aria-label={text.assignOperator}>
          <option value="">{text.noOperator}</option>
          {operators.map(op => <option key={op.id} value={op.id}>{op.username}</option>)}
        </select>
      ) : null}
      {inviteUrl ? (
        <div className="invite-result">
          <input ref={inviteInputRef} value={inviteUrl} readOnly onFocus={e => e.currentTarget.select()} />
          <button type="button" onClick={copyInvite}>{copied ? text.copied : text.copy}</button>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
