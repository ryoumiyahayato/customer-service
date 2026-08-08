import { useEffect, useState } from 'react';
import InviteLinkPanel from './InviteLinkPanel';
import OperatorProfileSettings from './OperatorProfileSettings';
import PresetMessageEditor from './PresetMessageEditor';
import AdminRiskCenter from './AdminRiskCenter';
import { useAdminWorkspace } from './AdminWorkspaceContext';
import './adminMobileShell.css';
import './qrComposer.css';

type RootTab = 'messages' | 'qr' | 'me';
type NestedPage = 'preset' | 'staff' | 'operators' | 'security' | '';

function TabIcon({ type }: { type: RootTab }) {
  if (type === 'messages') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>;
  if (type === 'qr') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 0h2v2h-2v-2Zm3 0h2v6h-2v-6Zm-3 4h2v2h-2v-2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.7-4 3.1-6 7-6s6.3 2 7 6H5Z" /></svg>;
}

export default function AdminMobileShell() {
  const {
    admin,
    operators,
    capabilities,
    unreadCount,
    view,
    mobileView,
    openView,
    logout,
    logoutLoading,
  } = useAdminWorkspace();
  const [mobile, setMobile] = useState(() => window.innerWidth <= 820);
  const [tab, setTab] = useState<RootTab>('messages');
  const [nestedPage, setNestedPage] = useState<NestedPage>('');
  const [error, setError] = useState('');
  const isSuper = admin.role === 'SUPER_ADMIN';
  const inChat = tab === 'messages' && view === 'sessions' && mobileView === 'chat';

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 820);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const goMessages = () => {
    setError('');
    setTab('messages');
    setNestedPage('');
    openView('sessions', 'dir');
  };

  const goQr = () => {
    setError('');
    setTab('qr');
    setNestedPage('');
    openView('sessions', 'dir');
    if (!capabilities.canCreateInvites) setError('当前客服账号未被授予生成邀请二维码权限，或权限信息暂时不可用。');
  };

  const goMe = () => {
    setError('');
    setTab('me');
    setNestedPage('');
    openView('sessions', 'dir');
  };

  const openPreset = () => {
    setError('');
    setTab('me');
    setNestedPage('preset');
    openView('sessions', 'dir');
  };

  const openStaff = () => {
    if (!capabilities.canUseStaffChat) {
      setError('当前客服账号未被授予内部消息权限，或权限信息暂时不可用。');
      return;
    }
    setError('');
    setTab('me');
    setNestedPage('staff');
    openView('staffChat', 'panel');
  };

  const openOperators = () => {
    setError('');
    setTab('me');
    setNestedPage('operators');
    openView('operators', 'panel');
  };

  const openSecurity = () => {
    setError('');
    setTab('me');
    setNestedPage('security');
    openView('sessions', 'dir');
  };

  const back = () => {
    if (inChat) goMessages();
    else goMe();
  };

  if (!mobile) return null;
  const rootPage = !nestedPage && !inChat;

  return (
    <>
      {(nestedPage || inChat) ? <button type="button" className="mobile-subpage-back" onClick={back} aria-label="返回">‹</button> : null}

      {rootPage && tab === 'qr' ? (
        <section className="mobile-root-page mobile-qr-root" aria-label="二维码">
          {capabilities.canCreateInvites ? <InviteLinkPanel adminRole={admin.role} operators={operators} /> : null}
          {error ? <p className="mobile-shell-error">{error}</p> : null}
        </section>
      ) : null}

      {rootPage && tab === 'me' ? (
        <section className="mobile-account-tab" aria-label="我的">
          <OperatorProfileSettings username={admin.username} role={admin.role} />
          <div className="mobile-account-menu">
            <button type="button" onClick={openPreset}>
              <span>预设消息</span><small>访客进入后由服务器自动发送文字或图片</small><i>›</i>
            </button>
            <button type="button" onClick={openStaff} disabled={!capabilities.canUseStaffChat}>
              <span>内部消息</span><small>{capabilities.canUseStaffChat ? '客服团队内部沟通' : '管理员已关闭此权限或权限暂不可用'}</small><i>›</i>
            </button>
            {isSuper ? (
              <button type="button" onClick={openOperators}>
                <span>客服管理</span><small>账号、人员状态与基础管理</small><i>›</i>
              </button>
            ) : null}
            {isSuper ? (
              <button type="button" onClick={openSecurity}>
                <span>风控与安全</span><small>异常访问、登录会话与客服权限</small><i>›</i>
              </button>
            ) : null}
            <button type="button" className="mobile-account-logout" onClick={() => void logout()} disabled={logoutLoading}>
              <span>{logoutLoading ? '退出中...' : '退出登录'}</span><small>结束当前后台登录状态</small><i>›</i>
            </button>
          </div>
          {error ? <p className="mobile-shell-error">{error}</p> : null}
        </section>
      ) : null}

      {nestedPage === 'preset' ? (
        <section className="mobile-root-page mobile-preset-page"><PresetMessageEditor /></section>
      ) : null}

      {nestedPage === 'security' && isSuper ? (
        <section className="mobile-root-page mobile-security-page"><AdminRiskCenter /></section>
      ) : null}

      {rootPage ? (
        <nav className="mobile-bottom-nav" aria-label="主要导航">
          <button type="button" className={tab === 'messages' ? 'active' : ''} onClick={goMessages}>
            <TabIcon type="messages" /><span>消息</span>
            {unreadCount > 0 ? <span className="admin-unread-badge" aria-label={`${unreadCount} 条未读消息`}>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
          </button>
          <button type="button" className={tab === 'qr' ? 'active' : ''} onClick={goQr} disabled={!capabilities.canCreateInvites}>
            <TabIcon type="qr" /><span>二维码</span>
          </button>
          <button type="button" className={tab === 'me' ? 'active' : ''} onClick={goMe}>
            <TabIcon type="me" /><span>我的</span>
          </button>
        </nav>
      ) : null}
    </>
  );
}
