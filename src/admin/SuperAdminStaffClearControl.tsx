import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './staffClearControl.css';

type AuthMeResponse = {
  admin?: {
    role?: string;
  } | null;
};

type ClearResponse = {
  deleted?: number;
};

type StaffViewEvent = CustomEvent<{ active?: boolean }>;
const CLEAR_CONFIRMATION = 'CLEAR_STAFF_CHAT';

export default function SuperAdminStaffClearControl() {
  const [isSuper, setIsSuper] = useState(false);
  const [staffViewVisible, setStaffViewVisible] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false })
      .then(response => {
        if (active) setIsSuper(response?.admin?.role === 'SUPER_ADMIN');
      })
      .catch(() => {
        if (active) setIsSuper(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onView = (event: Event) => {
      const detail = (event as StaffViewEvent).detail;
      setStaffViewVisible(Boolean(detail?.active));
      if (!detail?.active) setError('');
    };
    window.addEventListener('admin-staff-view', onView);
    return () => window.removeEventListener('admin-staff-view', onView);
  }, []);

  if (!isSuper || !staffViewVisible) return null;

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
      window.dispatchEvent(new CustomEvent('admin-staff-cleared'));
      window.location.reload();
    } catch (err) {
      setError(getErrorMessage(err, '清空内部消息失败'));
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
