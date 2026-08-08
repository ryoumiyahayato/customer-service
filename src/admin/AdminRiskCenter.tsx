import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { copyText, getErrorMessage } from '../compat';
import './adminRiskCenter.css';

type RiskOverview = {
  failedAdminLogins24h?: number;
  warningEvents24h?: number;
  activeAdminSessions?: number;
  disabledOperators?: number;
  totalOperators?: number;
};

type ActiveAdminSession = {
  id: string;
  adminId: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  createdAt: string;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  deviceLabel?: string;
  approximateLocation?: string;
  isCurrent?: boolean;
};

type OperatorPolicy = {
  canCreateInvites: boolean;
  canUseStaffChat: boolean;
  canUploadImages: boolean;
};

type OperatorPolicyRow = {
  id: string;
  username: string;
  isDisabled?: boolean;
  online?: boolean;
  lastSeenAt?: string | null;
  policy: OperatorPolicy;
};

const DEFAULT_POLICY: OperatorPolicy = {
  canCreateInvites: true,
  canUseStaffChat: true,
  canUploadImages: true,
};

const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

function generateTemporaryPassword(length = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, value => TEMP_PASSWORD_ALPHABET[value % TEMP_PASSWORD_ALPHABET.length]).join('');
}

export default function AdminRiskCenter() {
  const [overview, setOverview] = useState<RiskOverview>({});
  const [activeSessions, setActiveSessions] = useState<ActiveAdminSession[]>([]);
  const [operators, setOperators] = useState<OperatorPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetTarget, setResetTarget] = useState<OperatorPolicyRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetComplete, setResetComplete] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, sessionRes, policyRes] = await Promise.all([
        apiFetch<{ overview?: RiskOverview }>('/api/admin/security/overview', { retryGet: false }),
        apiFetch<{ sessions?: ActiveAdminSession[] }>('/api/admin/security/sessions', { retryGet: false }),
        apiFetch<{ operators?: OperatorPolicyRow[] }>('/api/admin/operator-policies', { retryGet: false }),
      ]);
      setOverview(overviewRes.overview || {});
      setActiveSessions(sessionRes.sessions || []);
      setOperators((policyRes.operators || []).map(row => ({ ...row, policy: { ...DEFAULT_POLICY, ...(row.policy || {}) } })));
    } catch (err) {
      setError(getErrorMessage(err, '读取风控数据失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const savePolicy = async (operator: OperatorPolicyRow, patch: Partial<OperatorPolicy>) => {
    if (working) return;
    const next = { ...operator.policy, ...patch };
    setWorking(`policy:${operator.id}`);
    setError('');
    try {
      await apiFetch(`/api/admin/operator-policies/${encodeURIComponent(operator.id)}`, {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      setOperators(prev => prev.map(item => item.id === operator.id ? { ...item, policy: next } : item));
    } catch (err) {
      setError(getErrorMessage(err, '保存客服权限失败'));
    } finally {
      setWorking('');
    }
  };

  const revokeSessions = async (operator: OperatorPolicyRow) => {
    if (working || !window.confirm(`立即撤销 ${operator.username} 的当前后台登录？`)) return;
    setWorking(`revoke:${operator.id}`);
    setError('');
    try {
      await apiFetch(`/api/admin/operators/${encodeURIComponent(operator.id)}/revoke-sessions`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, '撤销客服会话失败'));
    } finally {
      setWorking('');
    }
  };

  const openPasswordReset = (operator: OperatorPolicyRow) => {
    setResetTarget(operator);
    setNewPassword(generateTemporaryPassword());
    setResetComplete(false);
    setError('');
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetTarget || newPassword.length < 12 || working || resetComplete) return;
    setWorking(`password:${resetTarget.id}`);
    setError('');
    try {
      await apiFetch(`/api/admin/operators/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword }),
      });
      setResetComplete(true);
      setNotice(`${resetTarget.username} 的密码已重置，原后台登录已撤销。`);
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, '重置客服密码失败'));
    } finally {
      setWorking('');
    }
  };

  const anomalyLevel = useMemo(() => {
    const failed = Number(overview.failedAdminLogins24h || 0);
    const warnings = Number(overview.warningEvents24h || 0);
    if (failed >= 10 || warnings >= 10) return '高';
    if (failed >= 3 || warnings >= 3) return '中';
    return '低';
  }, [overview.failedAdminLogins24h, overview.warningEvents24h]);

  return (
    <section className="risk-center" aria-busy={loading}>
      <div className="risk-center-heading">
        <div><h3>风控与安全</h3></div>
        <button type="button" onClick={refresh} disabled={loading}>刷新</button>
      </div>

      <div className="risk-metrics">
        <article><span>风险级别</span><b>{anomalyLevel}</b></article>
        <article><span>后台失败登录</span><b>{overview.failedAdminLogins24h || 0}</b><small>最近 24 小时</small></article>
        <article><span>活动后台会话</span><b>{activeSessions.length}</b></article>
        <article><span>客服账号</span><b>{overview.totalOperators || 0}</b><small>禁用 {overview.disabledOperators || 0}</small></article>
      </div>

      <div className="risk-section">
        <div className="risk-section-title"><h4>客服权限</h4></div>
        <div className="risk-operator-list">
          {operators.map(operator => (
            <article key={operator.id} className="risk-operator-row">
              <header><div><b>{operator.username}</b><span>{operator.isDisabled ? '已禁用' : operator.online ? '在线' : '离线'}{operator.lastSeenAt ? ` · ${new Date(operator.lastSeenAt).toLocaleString()}` : ''}</span></div></header>
              <div className="risk-policy-grid">
                <label><input type="checkbox" checked={operator.policy.canCreateInvites} disabled={!!working || operator.isDisabled} onChange={event => savePolicy(operator, { canCreateInvites: event.target.checked })} /><span>生成邀请二维码</span></label>
                <label><input type="checkbox" checked={operator.policy.canUseStaffChat} disabled={!!working || operator.isDisabled} onChange={event => savePolicy(operator, { canUseStaffChat: event.target.checked })} /><span>使用内部消息</span></label>
                <label><input type="checkbox" checked={operator.policy.canUploadImages} disabled={!!working || operator.isDisabled} onChange={event => savePolicy(operator, { canUploadImages: event.target.checked })} /><span>向客户上传图片</span></label>
              </div>
              <div className="risk-operator-actions">
                <button type="button" className="secondary" onClick={() => openPasswordReset(operator)} disabled={!!working || operator.isDisabled}>重置密码</button>
                <button type="button" className="danger" onClick={() => revokeSessions(operator)} disabled={!!working || operator.isDisabled}>{working === `revoke:${operator.id}` ? '撤销中…' : '踢出当前登录'}</button>
              </div>
            </article>
          ))}
          {!operators.length && !loading ? <p className="risk-empty">暂无客服账号。</p> : null}
        </div>
      </div>

      <div className="risk-section">
        <div className="risk-section-title"><h4>后台登录设备</h4></div>
        <div className="risk-session-list">
          {activeSessions.map(session => (
            <article key={session.id} className="risk-session-row">
              <div className="risk-session-identity">
                <b>{session.username}</b>
                <span>{session.role === 'SUPER_ADMIN' ? '超级管理员' : '客服'}{session.isCurrent ? ' · 当前设备' : ''}</span>
              </div>
              <dl>
                <div><dt>设备</dt><dd>{session.deviceLabel || '未知'}</dd></div>
                <div><dt>位置</dt><dd>{session.approximateLocation || '未知'}</dd></div>
                <div><dt>最后活动</dt><dd>{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : new Date(session.createdAt).toLocaleString()}</dd></div>
              </dl>
            </article>
          ))}
          {!activeSessions.length && !loading ? <p className="risk-empty">当前没有活动后台会话。</p> : null}
        </div>
      </div>

      {resetTarget ? (
        <div className="risk-modal-backdrop" onClick={() => { if (!working) setResetTarget(null); }}>
          <form className="risk-modal" onSubmit={resetPassword} onClick={event => event.stopPropagation()}>
            <h4>重置 {resetTarget.username} 的密码</h4>
            <label className="risk-temp-password-label"><span>临时初始密码</span><input type="text" minLength={12} maxLength={128} autoComplete="off" value={newPassword} onChange={event => { setNewPassword(event.target.value); setResetComplete(false); }} autoFocus /></label>
            <div className="risk-temp-password-actions">
              <button type="button" className="secondary" onClick={() => setNewPassword(generateTemporaryPassword())} disabled={!!working || resetComplete}>重新生成</button>
              <button type="button" className="secondary" onClick={() => copyText(newPassword).then(() => setNotice('临时密码已复制')).catch(() => setError('复制失败'))} disabled={!newPassword}>复制密码</button>
            </div>
            <div className="risk-modal-actions">
              <button type="button" className="secondary" onClick={() => setResetTarget(null)} disabled={!!working}>{resetComplete ? '关闭' : '取消'}</button>
              {!resetComplete ? <button type="submit" disabled={newPassword.length < 12 || !!working}>{working.startsWith('password:') ? '重置中…' : '确认重置'}</button> : null}
            </div>
          </form>
        </div>
      ) : null}

      {notice ? <p className="risk-notice">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
