import { useEffect, useState } from 'react';
import InviteLinkPanel from './InviteLinkPanel';
import OperatorProfileSettings from './OperatorProfileSettings';
import PresetMessageEditor from './PresetMessageEditor';
import AdminRiskCenter from './AdminRiskCenter';
import { useAdminWorkspace } from './AdminWorkspaceContext';
import './desktopAdminPolish.css';
import './qrComposer.css';

type RootMode = 'messages' | 'qr' | 'settings';
type SettingsPage = 'profile' | 'preset' | 'staff' | 'operators' | 'security';

function RailIcon({ type }: { type: RootMode }) {
  if (type === 'messages') return <svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 3V5Z" /></svg>;
  if (type === 'qr') return <svg viewBox="0 0 24 24"><path d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm12 0h2v2h-2v-2Zm4 0h2v7h-2v-7Zm-4 4h2v3h-2v-3Z" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M12 8.2A3.8 3.8 0 1 0 12 16a3.8 3.8 0 0 0 0-7.6Zm8.6 4.8-2 .9c-.1.4-.3.8-.5 1.2l.8 2-1.9 1.9-2-.8c-.4.2-.8.4-1.2.5l-.9 2h-2.7l-.9-2c-.4-.1-.8-.3-1.2-.5l-2 .8-1.9-1.9.8-2c-.2-.4-.4-.8-.5-1.2l-2-.9v-2.7l2-.9c.1-.4.3-.8.5-1.2l-.8-2L6.1 4.3l2 .8c.4-.2.8-.4 1.2-.5l.9-2h2.7l.9 2c.4.1.8.3 1.2.5l2-.8 1.9 1.9-.8 2c.2.4.4.8.5 1.2l2 .9V13Z" /></svg>;
}

export default function DesktopAdminPolish() {
  const {
    admin,
    currentSession,
    currentCustomerName,
    operators,
    capabilities,
    unreadCount,
    openView,
    logout,
    logoutLoading,
  } = useAdminWorkspace();
  const [desktop, setDesktop] = useState(() => window.innerWidth > 820);
  const [mode, setMode] = useState<RootMode>('messages');
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('profile');
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isSuper = admin.role === 'SUPER_ADMIN';

  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth > 820);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('desktop-admin-qr-mode', desktop && mode === 'qr');
    document.body.classList.toggle('desktop-admin-settings-mode', desktop && mode === 'settings');
    document.body.classList.toggle('desktop-admin-settings-legacy', desktop && mode === 'settings' && (settingsPage === 'staff' || settingsPage === 'operators'));
    document.body.classList.toggle('desktop-admin-details-open', desktop && mode === 'messages' && detailsOpen);
    return () => document.body.classList.remove('desktop-admin-qr-mode', 'desktop-admin-settings-mode', 'desktop-admin-settings-legacy', 'desktop-admin-details-open');
  }, [desktop, mode, settingsPage, detailsOpen]);

  useEffect(() => {
    setDetailsOpen(false);
  }, [currentSession?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const goMessages = () => {
    setError('');
    setMode('messages');
    setDetailsOpen(false);
    openView('sessions');
  };

  const goQr = () => {
    setError('');
    setMode('qr');
    setDetailsOpen(false);
    openView('sessions');
    if (!capabilities.canCreateInvites) setError('当前客服账号未被授予生成邀请二维码权限，或权限信息暂时不可用。');
  };

  const goSettings = () => {
    setError('');
    setMode('settings');
    setSettingsPage('profile');
    setDetailsOpen(false);
    openView('sessions');
  };

  const openSettingsPage = (page: SettingsPage) => {
    setError('');
    setMode('settings');
    setSettingsPage(page);
    setDetailsOpen(false);
    if (page === 'staff') {
      if (!capabilities.canUseStaffChat) {
        setSettingsPage('profile');
        setError('当前客服账号未被授予内部消息权限，或权限信息暂时不可用。');
        openView('sessions');
        return;
      }
      openView('staffChat');
      return;
    }
    if (page === 'operators') {
      openView('operators');
      return;
    }
    openView('sessions');
  };

  if (!desktop) return null;
  const ownSettingsOverlay = mode === 'settings' && (settingsPage === 'profile' || settingsPage === 'preset' || settingsPage === 'security');

  return (
    <>
      <nav className="desktop-tg-rail" aria-label="后台主导航">
        <div className="desktop-rail-avatar">{(admin.username || '客').slice(0, 1).toUpperCase()}</div>
        <button type="button" className={mode === 'messages' ? 'active' : ''} onClick={goMessages}>
          <RailIcon type="messages" /><span>消息</span>
          {unreadCount > 0 ? <span className="admin-unread-badge" aria-label={`${unreadCount} 条未读消息`}>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
        </button>
        <button type="button" className={mode === 'qr' ? 'active' : ''} onClick={goQr} disabled={!capabilities.canCreateInvites}><RailIcon type="qr" /><span>二维码</span></button>
        <button type="button" className={mode === 'settings' ? 'active' : ''} onClick={goSettings}><RailIcon type="settings" /><span>设置</span></button>
      </nav>

      {mode === 'messages' && currentSession ? (
        <button type="button" className="desktop-session-details-button" onClick={() => setDetailsOpen(true)}><b>{currentCustomerName}</b><span>详情</span></button>
      ) : null}
      {mode === 'messages' && detailsOpen ? (
        <button type="button" className="desktop-session-details-backdrop" aria-label="关闭客户详情" onClick={() => setDetailsOpen(false)} />
      ) : null}

      {mode === 'qr' ? (
        <div className="desktop-shell-overlay desktop-qr-overlay">
          {capabilities.canCreateInvites ? <InviteLinkPanel adminRole={admin.role} operators={operators} workspace /> : <div className="desktop-access-denied">当前客服账号未被授予生成邀请二维码权限，或权限信息暂时不可用。</div>}
        </div>
      ) : null}

      {mode === 'settings' ? (
        <aside className="desktop-settings-nav">
          <div className="desktop-settings-account"><b>{admin.username || '当前账号'}</b><span>{isSuper ? '超级管理员' : '客服'}</span></div>
          <button type="button" className={settingsPage === 'profile' ? 'active' : ''} onClick={() => openSettingsPage('profile')}><b>我的</b><span>头像、显示名称与密码</span></button>
          <button type="button" className={settingsPage === 'preset' ? 'active' : ''} onClick={() => openSettingsPage('preset')}><b>预设消息</b><span>访客进入后自动发送的聊天内容</span></button>
          <button type="button" className={settingsPage === 'staff' ? 'active' : ''} onClick={() => openSettingsPage('staff')} disabled={!capabilities.canUseStaffChat}><b>内部消息</b><span>{capabilities.canUseStaffChat ? '团队沟通' : '权限已关闭或暂不可用'}</span></button>
          {isSuper ? <button type="button" className={settingsPage === 'operators' ? 'active' : ''} onClick={() => openSettingsPage('operators')}><b>客服管理</b><span>账号与人员</span></button> : null}
          {isSuper ? <button type="button" className={settingsPage === 'security' ? 'active' : ''} onClick={() => openSettingsPage('security')}><b>风控与安全</b><span>异常访问、会话与权限</span></button> : null}
          <button type="button" className="desktop-settings-logout" onClick={() => void logout()} disabled={logoutLoading}><b>{logoutLoading ? '退出中...' : '退出登录'}</b><span>结束当前后台会话</span></button>
          {error ? <p>{error}</p> : null}
        </aside>
      ) : null}

      {ownSettingsOverlay ? (
        <main className="desktop-settings-content">
          {settingsPage === 'profile' ? <OperatorProfileSettings username={admin.username} role={admin.role} /> : null}
          {settingsPage === 'preset' ? <PresetMessageEditor /> : null}
          {settingsPage === 'security' && isSuper ? <AdminRiskCenter /> : null}
        </main>
      ) : null}
    </>
  );
}
