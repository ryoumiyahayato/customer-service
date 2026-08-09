import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import type { OperatorSummary } from '../chatModel';
import { StatusBlock } from '../ui/StatusBlock';

type OperatorListResponse = { operators?: OperatorSummary[] };

export default function DesktopOperatorManagement({ initialOperators }: { initialOperators: OperatorSummary[] }) {
  const [operators, setOperators] = useState<OperatorSummary[]>(initialOperators);
  const [creating, setCreating] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { setOperators(initialOperators); }, [initialOperators]);

  const refresh = async () => {
    const response = await apiFetch<OperatorListResponse>('/api/admins/operators', { retryGet: false });
    setOperators(Array.isArray(response.operators) ? response.operators : []);
  };

  const createOperator = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    if (!username || password.length < 8) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/admins', { method: 'POST', body: JSON.stringify({ username, password }) });
      form.reset();
      await refresh();
      setNotice('客服账号已创建');
    } catch (err) {
      setError(getErrorMessage(err, '创建客服失败'));
    } finally {
      setCreating(false);
    }
  };

  const disableOperator = async (operator: OperatorSummary) => {
    if (disablingId) return;
    setDisablingId(operator.id);
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/admins/operators', { method: 'DELETE', body: JSON.stringify({ id: operator.id }) });
      await refresh();
      setNotice('客服账号已禁用');
    } catch (err) {
      setError(getErrorMessage(err, '禁用客服失败'));
    } finally {
      setDisablingId(null);
    }
  };

  return (
    <section className="desktop-operator-manager admin-panel wide" aria-label="客服管理">
      <header className="desktop-operator-manager-header">
        <div><h2>客服管理</h2><p>创建客服账号并管理现有客服。</p></div>
      </header>

      <div className="desktop-operator-create-block">
        <h3 className="panel-title">新增客服</h3>
        <form onSubmit={createOperator} className="mini-form desktop-operator-create-form" autoComplete="off">
          <input name="username" placeholder="登录账号" required autoComplete="off" maxLength={64} />
          <input name="password" type="password" placeholder="初始密码（至少 8 位）" required minLength={8} autoComplete="new-password" />
          <button type="submit" disabled={creating}>{creating ? '创建中…' : '创建客服'}</button>
        </form>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="account-setting-notice">{notice}</p> : null}

      <div className="desktop-operator-list-block">
        <h3 className="panel-title">现有客服</h3>
        <div className="operator-list">
          {operators.length ? operators.map(operator => (
            <div className="operator-row" key={operator.id}>
              <div><b>{operator.username}</b><span>{operator.isDisabled ? '已禁用' : operator.online ? '在线' : '离线'}{operator.lastSeenAt ? ` · ${new Date(operator.lastSeenAt).toLocaleString()}` : ''}</span></div>
              {operator.isDisabled ? <span className="muted">已禁用</span> : <button type="button" className="btn danger" onClick={() => void disableOperator(operator)} disabled={Boolean(disablingId)}>{disablingId === operator.id ? '禁用中…' : '禁用'}</button>}
            </div>
          )) : <StatusBlock>暂无客服账号，可先创建一个客服账号。</StatusBlock>}
        </div>
      </div>
    </section>
  );
}
