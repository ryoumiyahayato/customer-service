import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import type { OperatorSummary } from '../chatModel';
import InviteLinkPanel from './InviteLinkPanel';
import OperatorProfileSettings from './OperatorProfileSettings';
import AdminRiskCenter from './AdminRiskCenter';
import './adminMobileShell.css';
import './qrComposer.css';

type AuthResponse = {
  admin?: {
    username?: string;
    role?: string;
  } | null;
};

type CapabilityResponse = {
  capabilities?: {
    canCreateInvites?: boolean;
    canUseStaffChat?: boolean;
    canUploadImages?: boolean;
    canViewRiskCenter?: boolean;
  };
};

type OperatorListResponse = { operators?: OperatorSummary[] };
type RootTab = 'messages' | 'qr' | 'me';
type NestedPage = 'chat' | 'staff' | 'operators' | 'security' | '';

function buttonWithText(selector: string, label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .find(button => button.textContent?.trim() === label) || null;
}

function TabIcon({ type }: { type: RootTab }) {
  if (type === 'messages') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>;
  if (type === 'qr') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 0h2v2h-2v-2Zm3 0h2v6h-2v-6Zm-3 4h2v2h-2v-2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.7-4 3.1-6 7-6s6.3 2 7 6H5Z" /></svg>;
}

function notifyStaffView(active: boolean) {
  window.dispatchEvent(new CustomEvent('admin-staff-view', { detail: { active } }));
}

export default function AdminMobileShell() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 820);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<RootTab>('messages');
  const [nestedPage, setNestedPage] = useState<NestedPage>('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [operators, setOperators] = useState<OperatorSummary[]>([]);
  const [canCreateInvites, setCanCreateInvites] = useState(false);
  const [canUseStaffChat, setCanUseStaffChat] = useState(false);
  const [error, setError] = useState('');

  const isSuper = role === 'SUPER_ADMIN';

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 820);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const exists = Boolean(document.querySelector('.admin.is-narrow'));
      setReady(exists);
      if (exists) window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    apiFetch<AuthResponse>('/api/auth/me', { retryGet: false })
      .then((auth) => {
        if (!active) return;
        const nextRole = auth.admin?.role || '';
        setUsername(auth.admin?.username || '');
        setRole(nextRole);
        if (nextRole === 'SUPER_ADMIN') {
          apiFetch<OperatorListResponse>('/api/admins/operators', { retryGet: false })
            .then(response => { if (active) setOperators(response.operators || []); })
            .catch(() => { if (active) setOperators([]); });
        } else {
          setOperators([]);
        }
      })
      .catch(() => {
        if (!active) return;
        setUsername('');
        setRole('');
        setOperators([]);
        setError('当前账号身份读取失败，请刷新后重试。');
      });

    apiFetch<CapabilityResponse>('/api/admin/capabilities', { retryGet: false })
      .then((capabilities) => {
        if (!active) return;
        setCanCreateInvites(capabilities.capabilities?.canCreateInvites === true);
        setCanUseStaffChat(capabilities.capabilities?.canUseStaffChat === true);
      })
      .catch(() => {
        if (!active) return;
        setCanCreateInvites(false);
        setCanUseStaffChat(false);
        setError(current => current || '账号权限读取失败；高权限入口已保持关闭，请刷新后重试。');
      });

    return () => { active = false; };
  }, []);

  const openLegacyView = useCallback((label: '会话' | '内部消息' | '客服管理') => {
    buttonWithText('.side-nav button', label)?.click();
  }, []);

  const leaveStaffView = useCallback(() => {
    notifyStaffView(false);
    openLegacyView('会话');
  }, [openLegacyView]);

  const goMessages = useCallback(() => {
    setError('');
    setTab('messages');
    setNestedPage('');
    leaveStaffView();
  }, [leaveStaffView]);

  const goQr = useCallback(() => {
    setError('');
    if (!canCreateInvites) {
      setTab('qr');
      setNestedPage('');
      leaveStaffView();
      setError('当前客服账号未被授予生成邀请二维码权限，或权限信息暂时不可用。');
      return;
    }
    setTab('qr');
    setNestedPage('');
    leaveStaffView();
  }, [canCreateInvites, leaveStaffView]);

  const goMe = useCallback(() => {
    setError('');
    setTab('me');
    setNestedPage('');
    leaveStaffView();
  }, [leaveStaffView]);

  const openStaff = () => {
    if (!canUseStaffChat) {
      setError('当前客服账号未被授予内部消息权限，或权限信息暂时不可用。');
      return;
    }
    setError('');
    setTab('me');
    setNestedPage('staff');
    openLegacyView('内部消息');
    notifyStaffView(true);
  };

  const openOperators = () => {
    setError('');
    setTab('me');
    setNestedPage('operators');
    notifyStaffView(false);
    openLegacyView('客服管理');
  };

  const openSecurity = () => {
    setError('');
    setTab('me');
    setNestedPage('security');
    leaveStaffView();
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    } catch (err) {
      setError(getErrorMessage(err, '退出失败'));
    }
  };

  const back = () => {
    if (nestedPage === 'chat') goMessages();
    else goMe();
  };

  useEffect(() => {
    if (!mobile || !ready) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const session = target?.closest('.mobile-session-list-view .conversation-item, .mobile-session-list-view .session');
      if (session) {
        setTab('messages');
        setNestedPage('chat');
        notifyStaffView(false);
        return;
      }
      const bubble = target?.closest('.msg') as HTMLElement | null;
      if (!bubble || !bubble.closest('.mobile-chat-workspace')) return;
      if (target?.closest('a,button,input,textarea,label')) return;
      event.preventDefault();
      const rect = bubble.getBoundingClientRect();
      bubble.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(rect.width / 2, 120),
        clientY: rect.top + Math.min(rect.height / 2, 48),
      }));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [mobile, ready]);

  useEffect(() => () => notifyStaffView(false), []);

  if (!mobile || !ready) return null;

  const rootPage = !nestedPage;
  return (
    <>
      {nestedPage ? <button type="button" className="mobile-subpage-back" onClick={back} aria-label="返回">‹</button> : null}

      {rootPage && tab === 'qr' ? (
        <section className="mobile-root-page mobile-qr-root" aria-label="二维码">
          {canCreateInvites ? <InviteLinkPanel adminRole={role} operators={operators} /> : null}
          {error ? <p className="mobile-shell-error">{error}</p> : null}
        </section>
      ) : null}

      {rootPage && tab === 'me' ? (
        <section className="mobile-account-tab" aria-label="我的">
          <OperatorProfileSettings username={username} role={role} />
          <div className="mobile-account-menu">
            <button type="button" onClick={openStaff} disabled={!canUseStaffChat}>
              <span>内部消息</span><small>{canUseStaffChat ? '客服团队内部沟通' : '管理员已关闭此权限或权限暂不可用'}</small><i>›</i>
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
            <button type="button" className="mobile-account-logout" onClick={logout}>
              <span>退出登录</span><small>结束当前后台登录状态</small><i>›</i>
            </button>
          </div>
          {error ? <p className="mobile-shell-error">{error}</p> : null}
        </section>
      ) : null}

      {nestedPage === 'security' && isSuper ? (
        <section className="mobile-root-page mobile-security-page"><AdminRiskCenter /></section>
      ) : null}

      {rootPage ? (
        <nav className="mobile-bottom-nav" aria-label="主要导航">
          <button type="button" className={tab === 'messages' ? 'active' : ''} onClick={goMessages}>
            <TabIcon type="messages" /><span>消息</span>
          </button>
          <button type="button" className={tab === 'qr' ? 'active' : ''} onClick={goQr}>
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
