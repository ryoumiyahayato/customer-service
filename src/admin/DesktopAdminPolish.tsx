import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import type { OperatorSummary } from '../chatModel';
import InviteLinkPanel from './InviteLinkPanel';
import OperatorProfileSettings from './OperatorProfileSettings';
import AdminRiskCenter from './AdminRiskCenter';
import './desktopAdminPolish.css';
import './qrComposer.css';

type AuthResponse = { admin?: { username?: string; role?: string } | null };
type CapabilityResponse = { capabilities?: { canCreateInvites?: boolean; canUseStaffChat?: boolean } };
type OperatorListResponse = { operators?: OperatorSummary[] };
type RootMode = 'messages' | 'qr' | 'settings';
type SettingsPage = 'profile' | 'staff' | 'operators' | 'security';

function buttonWithText(selector: string, label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .find(button => button.textContent?.trim() === label) || null;
}

function RailIcon({ type }: { type: RootMode }) {
  if (type === 'messages') return <svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 3V5Z" /></svg>;
  if (type === 'qr') return <svg viewBox="0 0 24 24"><path d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm12 0h2v2h-2v-2Zm4 0h2v7h-2v-7Zm-4 4h2v3h-2v-3Z" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M12 8.2A3.8 3.8 0 1 0 12 16a3.8 3.8 0 0 0 0-7.6Zm8.6 4.8-2 .9c-.1.4-.3.8-.5 1.2l.8 2-1.9 1.9-2-.8c-.4.2-.8.4-1.2.5l-.9 2h-2.7l-.9-2c-.4-.1-.8-.3-1.2-.5l-2 .8-1.9-1.9.8-2c-.2-.4-.4-.8-.5-1.2l-2-.9v-2.7l2-.9c.1-.4.3-.8.5-1.2l-.8-2L6.1 4.3l2 .8c.4-.2.8-.4 1.2-.5l.9-2h2.7l.9 2c.4.1.8.3 1.2.5l2-.8 1.9 1.9-.8 2c.2.4.4.8.5 1.2l2 .9V13Z" /></svg>;
}

function notifyStaffView(active: boolean) {
  window.dispatchEvent(new CustomEvent('admin-staff-view', { detail: { active } }));
}

export default function DesktopAdminPolish() {
  const [desktop, setDesktop] = useState(() => window.innerWidth > 820);
  const [mode, setMode] = useState<RootMode>('messages');
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('profile');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [operators, setOperators] = useState<OperatorSummary[]>([]);
  const [canCreateInvites, setCanCreateInvites] = useState(true);
  const [canUseStaffChat, setCanUseStaffChat] = useState(true);
  const [error, setError] = useState('');
  const isSuper = role === 'SUPER_ADMIN';

  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth > 820);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<AuthResponse>('/api/auth/me', { retryGet: false }),
      apiFetch<CapabilityResponse>('/api/admin/capabilities', { retryGet: false }),
    ]).then(([auth, capabilities]) => {
      if (!active) return;
      const nextRole = auth.admin?.role || '';
      setUsername(auth.admin?.username || '');
      setRole(nextRole);
      setCanCreateInvites(capabilities.capabilities?.canCreateInvites !== false);
      setCanUseStaffChat(capabilities.capabilities?.canUseStaffChat !== false);
      if (nextRole === 'SUPER_ADMIN') {
        apiFetch<OperatorListResponse>('/api/admins/operators', { retryGet: false })
          .then(response => { if (active) setOperators(response.operators || []); })
          .catch(() => {});
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const openLegacyView = useCallback((label: '会话' | '内部消息' | '客服管理') => {
    buttonWithText('.side-nav button', label)?.click();
  }, []);

  const setBodyMode = useCallback((nextMode: RootMode, nextSettingsPage: SettingsPage = settingsPage) => {
    document.body.classList.toggle('desktop-admin-qr-mode', nextMode === 'qr');
    document.body.classList.toggle('desktop-admin-settings-mode', nextMode === 'settings');
    document.body.classList.toggle('desktop-admin-settings-legacy', nextMode === 'settings' && (nextSettingsPage === 'staff' || nextSettingsPage === 'operators'));
  }, [settingsPage]);

  useEffect(() => {
    if (!desktop) {
      document.body.classList.remove('desktop-admin-qr-mode', 'desktop-admin-settings-mode', 'desktop-admin-settings-legacy');
      return;
    }
    setBodyMode(mode, settingsPage);
    return () => document.body.classList.remove('desktop-admin-qr-mode', 'desktop-admin-settings-mode', 'desktop-admin-settings-legacy');
  }, [desktop, mode, settingsPage, setBodyMode]);

  const goMessages = () => {
    setError('');
    setMode('messages');
    notifyStaffView(false);
    openLegacyView('会话');
  };

  const goQr = () => {
    setError('');
    setMode('qr');
    notifyStaffView(false);
    openLegacyView('会话');
    if (!canCreateInvites) setError('当前客服账号未被授予生成邀请二维码权限。');
  };

  const goSettings = () => {
    setError('');
    setMode('settings');
    setSettingsPage('profile');
    notifyStaffView(false);
    openLegacyView('会话');
  };

  const openSettingsPage = (page: SettingsPage) => {
    setError('');
    setMode('settings');
    setSettingsPage(page);
    if (page === 'staff') {
      if (!canUseStaffChat) {
        setSettingsPage('profile');
        setError('当前客服账号未被授予内部消息权限。');
        notifyStaffView(false);
        openLegacyView('会话');
        return;
      }
      openLegacyView('内部消息');
      notifyStaffView(true);
    } else if (page === 'operators') {
      notifyStaffView(false);
      openLegacyView('客服管理');
    } else {
      notifyStaffView(false);
      openLegacyView('会话');
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    } catch (err) {
      setError(getErrorMessage(err, '退出失败'));
    }
  };

  useEffect(() => () => notifyStaffView(false), []);

  if (!desktop || !document.querySelector('.admin:not(.is-narrow)')) return null;

  const ownOverlay = mode === 'qr' || (mode === 'settings' && (settingsPage === 'profile' || settingsPage === 'security'));

  return (
    <>
      <nav className="desktop-tg-rail" aria-label="后台主导航">
        <div className="desktop-rail-avatar">{(username || '客').slice(0, 1).toUpperCase()}</div>
        <button type="button" className={mode === 'messages' ? 'active' : ''} onClick={goMessages}><RailIcon type="messages" /><span>消息</span></button>
        <button type="button" className={mode === 'qr' ? 'active' : ''} onClick={goQr}><RailIcon type="qr" /><span>二维码</span></button>
        <button type="button" className={mode === 'settings' ? 'active' : ''} onClick={goSettings}><RailIcon type="settings" /><span>设置</span></button>
      </nav>

      {mode === 'qr' ? (
        <div className="desktop-shell-overlay desktop-qr-overlay">
          {canCreateInvites ? <InviteLinkPanel adminRole={role} operators={operators} workspace /> : <div className="desktop-access-denied">当前客服账号未被授予生成邀请二维码权限。</div>}
        </div>
      ) : null}

      {mode === 'settings' ? (
        <aside className="desktop-settings-nav">
          <div className="desktop-settings-account"><b>{username || '当前账号'}</b><span>{isSuper ? '超级管理员' : '客服'}</span></div>
          <button type="button" className={settingsPage === 'profile' ? 'active' : ''} onClick={() => openSettingsPage('profile')}><b>我的</b><span>头像、欢迎词、密码</span></button>
          <button type="button" className={settingsPage === 'staff' ? 'active' : ''} onClick={() => openSettingsPage('staff')} disabled={!canUseStaffChat}><b>内部消息</b><span>{canUseStaffChat ? '团队沟通' : '权限已关闭'}</span></button>
          {isSuper ? <button type="button" className={settingsPage === 'operators' ? 'active' : ''} onClick={() => openSettingsPage('operators')}><b>客服管理</b><span>账号与人员</span></button> : null}
          {isSuper ? <button type="button" className={settingsPage === 'security' ? 'active' : ''} onClick={() => openSettingsPage('security')}><b>风控与安全</b><span>异常访问、会话与权限</span></button> : null}
          <button type="button" className="desktop-settings-logout" onClick={logout}><b>退出登录</b><span>结束当前后台会话</span></button>
          {error ? <p>{error}</p> : null}
        </aside>
      ) : null}

      {ownOverlay && mode === 'settings' ? (
        <main className="desktop-settings-content">
          {settingsPage === 'profile' ? <OperatorProfileSettings username={username} role={role} /> : null}
          {settingsPage === 'security' && isSuper ? <AdminRiskCenter /> : null}
        </main>
      ) : null}
    </>
  );
}