import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './adminMobileShell.css';

type AuthResponse = {
  admin?: {
    username?: string;
    role?: string;
  } | null;
};

type RootTab = 'messages' | 'qr' | 'me';
type NestedPage = 'chat' | 'staff' | 'operators' | '';

function buttonWithText(selector: string, label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .find((button) => button.textContent?.trim() === label) || null;
}

function closeInviteOverlay() {
  const button = document.querySelector<HTMLButtonElement>('.invite-mobile-panel .mobile-dir-header button');
  button?.click();
}

function TabIcon({ type }: { type: RootTab }) {
  if (type === 'messages') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /></svg>;
  if (type === 'qr') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 0h2v2h-2v-2Zm3 0h2v6h-2v-6Zm-3 4h2v2h-2v-2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.7-4 3.1-6 7-6s6.3 2 7 6H5Z" /></svg>;
}

export default function AdminMobileShell() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 820);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<RootTab>('messages');
  const [accountOpen, setAccountOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [nestedPage, setNestedPage] = useState<NestedPage>('');
  const [username, setUsername] = useState('');
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 820);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<AuthResponse>('/api/auth/me', { retryGet: false })
      .then((response) => {
        if (!active) return;
        setUsername(response.admin?.username || '');
        setIsSuper(response.admin?.role === 'SUPER_ADMIN');
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const syncDom = useCallback(() => {
    const root = document.querySelector('.admin.is-narrow');
    setReady(Boolean(root));

    document.querySelectorAll('.mobile-dir-overlay.mobile-tab-overlay')
      .forEach((element) => element.classList.remove('mobile-tab-overlay'));
    const invitePanel = root?.querySelector('.invite-mobile-panel');
    const inviteOverlay = invitePanel?.closest('.mobile-dir-overlay');
    if (inviteOverlay) inviteOverlay.classList.add('mobile-tab-overlay');
    setInviteOpen(Boolean(invitePanel));

    const title = root?.querySelector('.mobile-topbar-title')?.textContent?.trim() || '';
    const chatOpen = Boolean(root?.querySelector('.mobile-chat-workspace .chat-panel'));
    const staffOpen = Boolean(root?.querySelector('.staff-composer'));
    const operatorsOpen = title === '客服管理' && Boolean(root?.querySelector('.mobile-panel-workspace'));
    const nextNested: NestedPage = chatOpen ? 'chat' : staffOpen ? 'staff' : operatorsOpen ? 'operators' : '';
    setNestedPage(nextNested);
    document.body.classList.toggle('mobile-admin-has-back', Boolean(nextNested));

    document.querySelectorAll<HTMLElement>('.admin .session-action-bar').forEach((bar) => {
      const stateText = bar.firstElementChild?.querySelector('span')?.textContent || '';
      bar.classList.toggle('is-trash-session', stateText.includes('回收站'));
    });
  }, []);

  useEffect(() => {
    syncDom();
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.body.classList.remove('mobile-admin-has-back');
      document.querySelectorAll('.mobile-dir-overlay.mobile-tab-overlay')
        .forEach((element) => element.classList.remove('mobile-tab-overlay'));
    };
  }, [syncDom]);

  useEffect(() => {
    if (!mobile) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
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
  }, [mobile]);

  const openView = (label: string) => {
    closeInviteOverlay();
    buttonWithText('.side-nav button', label)?.click();
  };

  const goMessages = () => {
    setAccountOpen(false);
    setTab('messages');
    closeInviteOverlay();
    openView('会话');
  };

  const goQr = () => {
    setAccountOpen(false);
    setTab('qr');
    if (!document.querySelector('.invite-mobile-panel')) {
      buttonWithText('.mobile-topbar-actions button', '邀请')?.click();
    }
  };

  const goMe = () => {
    closeInviteOverlay();
    setTab('me');
    setAccountOpen(true);
  };

  const openAccountChild = (label: '内部消息' | '客服管理') => {
    setAccountOpen(false);
    setTab('me');
    openView(label);
  };

  const logout = () => {
    document.querySelector<HTMLButtonElement>('.brand .logout-btn')?.click();
  };

  const back = () => {
    if (nestedPage === 'chat') goMessages();
    else goMe();
  };

  if (!mobile || !ready) return null;
  const showBottom = accountOpen || (!nestedPage && !inviteOpen) || inviteOpen;

  return (
    <>
      {nestedPage && !accountOpen && !inviteOpen ? (
        <button type="button" className="mobile-subpage-back" onClick={back} aria-label="返回">‹</button>
      ) : null}

      {accountOpen ? (
        <section className="mobile-account-tab" aria-label="我的">
          <header>
            <div className="mobile-account-avatar" aria-hidden="true">{(username || '客').slice(0, 1).toUpperCase()}</div>
            <div><b>{username || '当前账号'}</b><span>{isSuper ? '超级管理员' : '客服'}</span></div>
          </header>
          <div className="mobile-account-menu">
            <button type="button" onClick={() => openAccountChild('内部消息')}>
              <span>内部消息</span><small>客服团队内部沟通</small><i>›</i>
            </button>
            {isSuper ? (
              <button type="button" onClick={() => openAccountChild('客服管理')}>
                <span>客服管理</span><small>账号、权限与人员状态</small><i>›</i>
              </button>
            ) : null}
            <button type="button" className="mobile-account-logout" onClick={logout}>
              <span>退出登录</span><small>结束当前后台登录状态</small><i>›</i>
            </button>
          </div>
        </section>
      ) : null}

      {showBottom ? (
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