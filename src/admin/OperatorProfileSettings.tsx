import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './operatorProfileSettings.css';

type OperatorPresentation = {
  operatorId?: string;
  displayName?: string;
  avatarUrl: string;
};

type PresentationResponse = { presentation?: OperatorPresentation };
type ProfileResponse = { profile?: { username?: string; displayName?: string } };

const DEFAULT_PRESENTATION: OperatorPresentation = {
  avatarUrl: '',
};

const LOGIN_USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;

export default function OperatorProfileSettings({ username, role }: { username: string; role: string }) {
  const [presentation, setPresentation] = useState(DEFAULT_PRESENTATION);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [loginUsernameDraft, setLoginUsernameDraft] = useState(username);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginUsernameSaving, setLoginUsernameSaving] = useState(false);
  const [loginUsernameEditing, setLoginUsernameEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<PresentationResponse>('/api/admins/presentation', { retryGet: false })
      .then((response) => {
        if (!active) return;
        const next = { ...DEFAULT_PRESENTATION, ...(response.presentation || {}) };
        setPresentation(next);
        setNameDraft(next.displayName || username || '');
      })
      .catch((err) => { if (active) setError(getErrorMessage(err, '读取账号资料失败')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username]);

  useEffect(() => { setLoginUsernameDraft(username); }, [username]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 1800);
  };

  const beginNameEdit = () => {
    setNameDraft(presentation.displayName || username || '');
    setNameEditing(true);
    setError('');
  };

  const saveDisplayName = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (nameSaving) return;
    const displayName = nameDraft.trim();
    if (!displayName || Array.from(displayName).length > 80) {
      setError('名称不能为空且不能超过 80 个字符');
      return;
    }
    setNameSaving(true);
    setError('');
    try {
      const response = await apiFetch<ProfileResponse>('/api/admins/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      });
      const saved = response.profile?.displayName || displayName;
      setPresentation(prev => ({ ...prev, displayName: saved }));
      setNameDraft(saved);
      setNameEditing(false);
      flash('显示名称已更新');
    } catch (err) {
      setError(getErrorMessage(err, '修改显示名称失败'));
    } finally {
      setNameSaving(false);
    }
  };

  const beginLoginUsernameEdit = () => {
    setLoginUsernameDraft(username);
    setLoginPassword('');
    setLoginUsernameEditing(true);
    setPasswordEditing(false);
    setError('');
  };

  const cancelLoginUsernameEdit = () => {
    setLoginUsernameDraft(username);
    setLoginPassword('');
    setLoginUsernameEditing(false);
    setError('');
  };

  const saveAdminLoginUsername = async (event: React.FormEvent) => {
    event.preventDefault();
    if (role !== 'SUPER_ADMIN' || loginUsernameSaving) return;
    const nextUsername = loginUsernameDraft.trim();
    if (!LOGIN_USERNAME_RE.test(nextUsername)) {
      setError('登录账号需为 3–64 位字母、数字或 . _ @ -');
      return;
    }
    if (!loginPassword) {
      setError('修改管理员登录账号前请输入当前密码');
      return;
    }
    if (nextUsername === username) {
      setError('新的登录账号与当前账号相同');
      return;
    }
    setLoginUsernameSaving(true);
    setError('');
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password: loginPassword }),
      });
      const response = await apiFetch<ProfileResponse>('/api/admins/profile', {
        method: 'PATCH',
        body: JSON.stringify({ username: nextUsername }),
      });
      setLoginUsernameDraft(response.profile?.username || nextUsername);
      setLoginPassword('');
      setLoginUsernameEditing(false);
      flash('管理员登录账号已更新');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      setError(getErrorMessage(err, '修改管理员登录账号失败'));
    } finally {
      setLoginUsernameSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (avatarUploading) return;
    setAvatarUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await apiFetch<PresentationResponse>('/api/admins/presentation/avatar', {
        method: 'POST',
        body: form,
      });
      setPresentation(prev => ({ ...prev, ...(response.presentation || {}) }));
      flash('头像已更新');
    } catch (err) {
      setError(getErrorMessage(err, '头像上传失败'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarUploading || !presentation.avatarUrl) return;
    setAvatarUploading(true);
    setError('');
    try {
      const response = await apiFetch<PresentationResponse>('/api/admins/presentation/avatar', { method: 'DELETE' });
      setPresentation(prev => ({ ...prev, ...(response.presentation || {}), avatarUrl: response.presentation?.avatarUrl || '' }));
      flash('已恢复默认头像');
    } catch (err) {
      setError(getErrorMessage(err, '恢复默认头像失败'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const beginPasswordEdit = () => {
    setPassword('');
    setPasswordEditing(true);
    setLoginUsernameEditing(false);
    setLoginPassword('');
    setError('');
  };

  const cancelPasswordEdit = () => {
    setPassword('');
    setPasswordEditing(false);
    setError('');
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordSaving || password.length < 12) return;
    setPasswordSaving(true);
    setError('');
    try {
      await apiFetch('/api/admins/profile', {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setPasswordEditing(false);
      flash('密码已更新，其他登录会话已撤销');
    } catch (err) {
      setError(getErrorMessage(err, '修改密码失败'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const displayName = presentation.displayName || username || '当前账号';
  const roleLabel = role === 'SUPER_ADMIN' ? '超级管理员' : role === 'OPERATOR' ? '客服' : '身份加载中';

  return (
    <section className="account-presentation-card" aria-busy={loading}>
      <header className="account-presentation-header">
        <div className="account-presentation-avatar">
          {presentation.avatarUrl ? <img src={presentation.avatarUrl} alt="当前头像" /> : <span>{displayName.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="account-presentation-identity">
          {nameEditing ? (
            <form className="account-name-editor" onSubmit={saveDisplayName}>
              <input
                autoFocus
                value={nameDraft}
                maxLength={80}
                aria-label="显示名称"
                onChange={event => setNameDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setNameEditing(false);
                    setNameDraft(displayName);
                  }
                }}
              />
              <button type="submit" disabled={nameSaving || !nameDraft.trim()}>{nameSaving ? '保存中' : '确认'}</button>
            </form>
          ) : (
            <button type="button" className="account-display-name-view" onClick={beginNameEdit} title="点击修改显示名称">
              <b>{displayName}</b><small>点击修改</small>
            </button>
          )}
          <span>{roleLabel}</span>
        </div>
      </header>

      <div className="account-setting-block">
        <div className="account-setting-title"><b>头像</b><span>访客看到的客服头像</span></div>
        <div className="account-setting-actions">
          <label className="account-upload-button">
            {avatarUploading ? '处理中…' : '上传头像'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarUploading} onChange={event => {
              const file = event.target.files?.[0];
              if (file) uploadAvatar(file);
              event.currentTarget.value = '';
            }} />
          </label>
          {presentation.avatarUrl ? <button type="button" className="secondary" onClick={removeAvatar} disabled={avatarUploading}>恢复默认</button> : null}
        </div>
        <small>JPG / PNG / WebP，最大 2MB。</small>
      </div>

      <div className="account-setting-block account-login-security-block">
        <div className="account-setting-title"><b>后台登录</b><span>登录账号与登录密码在这里分别管理，不影响对外显示名称。</span></div>

        {role === 'SUPER_ADMIN' ? (
          <>
            <div className="account-login-summary-row">
              <div><span>管理员登录账号</span><b>{username}</b></div>
              {!loginUsernameEditing ? <button type="button" className="secondary" onClick={beginLoginUsernameEdit}>修改账号</button> : null}
            </div>
            {loginUsernameEditing ? (
              <form className="account-login-edit-form" onSubmit={saveAdminLoginUsername} autoComplete="off">
                <label><span>新的登录账号</span><input type="text" minLength={3} maxLength={64} autoComplete="off" value={loginUsernameDraft} onChange={event => setLoginUsernameDraft(event.target.value)} /></label>
                <label><span>当前密码</span><input type="password" maxLength={128} autoComplete="current-password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} placeholder="仅用于确认本次账号修改" /></label>
                <div className="account-login-edit-actions">
                  <button type="button" className="secondary" onClick={cancelLoginUsernameEdit} disabled={loginUsernameSaving}>取消</button>
                  <button type="submit" disabled={loginUsernameSaving || !loginPassword || !LOGIN_USERNAME_RE.test(loginUsernameDraft.trim())}>{loginUsernameSaving ? '修改中…' : '确认修改账号'}</button>
                </div>
              </form>
            ) : null}
            <div className="account-login-divider" />
          </>
        ) : null}

        <div className="account-login-summary-row">
          <div><span>登录密码</span><b className="account-password-mask">••••••••••••</b><small>修改后撤销本账号的其他后台会话</small></div>
          {!passwordEditing ? <button type="button" className="secondary" onClick={beginPasswordEdit}>修改密码</button> : null}
        </div>
        {passwordEditing ? (
          <form className="account-password-edit-form" onSubmit={changePassword} autoComplete="off">
            <label><span>新密码</span><input autoFocus type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 12 位" /></label>
            <div className="account-login-edit-actions">
              <button type="button" className="secondary" onClick={cancelPasswordEdit} disabled={passwordSaving}>取消</button>
              <button type="submit" disabled={passwordSaving || password.length < 12}>{passwordSaving ? '修改中…' : '确认修改密码'}</button>
            </div>
          </form>
        ) : null}
      </div>

      {notice ? <p className="account-setting-notice">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
