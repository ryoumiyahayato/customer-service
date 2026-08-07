import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './adminRiskCenter.css';

type RiskOverview = {
  failedAdminLogins24h?: number;
  warningEvents24h?: number;
  activeAdminSessions?: number;
  disabledOperators?: number;
  totalOperators?: number;
};

type SecurityLog = {
  id: string;
  level: string;
  event: string;
  actorId?: string | null;
  createdAt: string;
  details?: Record<string, unknown>;
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

export default function AdminRiskCenter() {
  const [overview, setOverview] = useState<RiskOverview>({});
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [operators, setOperators] = useState<OperatorPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState<OperatorPolicyRow | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, logRes, policyRes] = await Promise.all([
        apiFetch<{ overview?: RiskOverview }>('/api/admin/security/overview', { retryGet: false }),
        apiFetch<{ logs?: SecurityLog[] }>('/api/admin/security/logs?limit=60', { retryGet: false }),
        apiFetch<{ operators?: OperatorPolicyRow[] }>('/api/admin/operator-policies', { retryGet: false }),
      ]);
      setOverview(overviewRes.overview || {});
      setLogs(logRes.logs || []);
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
    if (working || !window.confirm(`立即撤销 ${operator.username} 的全部后台登录会话？`)) return;
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

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetTarget || newPassword.length < 12 || working) return;
    setWorking(`password:${resetTarget.id}`);
    setError('');
    try {
      await apiFetch(`/api/admin/operators/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword }),
      });
      setNewPassword('');
      setResetTarget(null);
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
        <div><h3>风控与安全</h3><p>面向“客服账号已被盗”的最小权限、会话撤销和异常访问审计。</p></div>
        <button type="button" onClick={refresh} disabled={loading}>刷新</button>
      </div>

      <div className="risk-metrics">
        <article><span>风险级别</span><b>{anomalyLevel}</b><small>按最近 24 小时失败登录与警告事件粗略判断</small></article>
        <article><span>后台失败登录</span><b>{overview.failedAdminLogins24h || 0}</b><small>最近 24 小时</small></article>
        <article><span>活动后台会话</span><b>{overview.activeAdminSessions || 0}</b><small>仅统计未撤销且未过期会话</small></article>
        <article><span>客服账号</span><b>{overview.totalOperators || 0}</b><small>其中禁用 {overview.disabledOperators || 0}</small></article>
      </div>

      <div className="risk-section">
        <div className="risk-section-title"><h4>客服最小权限</h4><span>前端隐藏不是安全边界；以下权限同时由 Worker 拦截。</span></div>
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
                <button type="button" className="secondary" onClick={() => { setResetTarget(operator); setNewPassword(''); }} disabled={!!working || operator.isDisabled}>重置密码</button>
                <button type="button" className="danger" onClick={() => revokeSessions(operator)} disabled={!!working || operator.isDisabled}>{working === `revoke:${operator.id}` ? '撤销中…' : '踢出全部登录'}</button>
              </div>
            </article>
          ))}
          {!operators.length && !loading ? <p className="risk-empty">暂无客服账号。</p> : null}
        </div>
      </div>

      <div className="risk-section">
        <div className="risk-section-title"><h4>最近安全日志</h4><span>仅超级管理员可读；不会返回密码、Cookie、会话令牌或聊天正文。</span></div>
        <div className="risk-log-list">
          {logs.map(log => (
            <article key={log.id} className={`risk-log level-${String(log.level || '').toLowerCase()}`}>
              <div><b>{log.event}</b><time>{new Date(log.createdAt).toLocaleString()}</time></div>
              <p>{Object.entries(log.details || {}).map(([key, value]) => `${key}: ${String(value ?? '')}`).join(' · ') || '无额外详情'}</p>
            </article>
          ))}
          {!logs.length && !loading ? <p className="risk-empty">暂无安全日志。</p> : null}
        </div>
      </div>

      {resetTarget ? (
        <div className="risk-modal-backdrop" onClick={() => setResetTarget(null)}>
          <form className="risk-modal" onSubmit={resetPassword} onClick={event => event.stopPropagation()}>
            <h4>重置 {resetTarget.username} 的密码</h4>
            <p>保存后会立即撤销该客服的全部现有后台会话，并要求其使用新密码重新登录。</p>
            <input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="新密码（至少 12 位）" autoFocus />
            <div><button type="button" className="secondary" onClick={() => setResetTarget(null)}>取消</button><button type="submit" disabled={newPassword.length < 12 || !!working}>{working.startsWith('password:') ? '保存中…' : '确认重置'}</button></div>
          </form>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
