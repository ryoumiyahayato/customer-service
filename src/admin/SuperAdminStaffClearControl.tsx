import { useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './staffClearControl.css';

const CLEAR_CONFIRMATION = 'CLEAR_STAFF_CHAT';

type ClearResponse = { deleted?: number };

export default function SuperAdminStaffClearControl({ isSuper, onCleared }: { isSuper: boolean; onCleared?: () => void }) {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  if (!isSuper) return null;

  const clearStaffChat = async () => {
    if (clearing) return;
    if (!window.confirm('确认清空全部内部消息？此操作会永久删除所有客服内部聊天记录，且不可撤销。')) return;
    if (!window.confirm('再次确认：真的要清空全部内部消息吗？')) return;
    setClearing(true);
    setError('');
    try {
      await apiFetch<ClearResponse>('/api/staff-chat', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: CLEAR_CONFIRMATION }),
      });
      onCleared?.();
    } catch (err) {
      setError(getErrorMessage(err, '清空内部消息失败'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="super-admin-staff-clear-control">
      <button type="button" className="danger" onClick={clearStaffChat} disabled={clearing}>
        {clearing ? '清空中...' : '清空内部消息'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
