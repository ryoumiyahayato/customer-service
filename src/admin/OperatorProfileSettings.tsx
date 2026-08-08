import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import './operatorProfileSettings.css';

type OperatorPresentation = {
  operatorId?: string;
  displayName?: string;
  welcomeText: string;
  avatarUrl: string;
};

type PresentationResponse = { presentation?: OperatorPresentation };
type ProfileResponse = { profile?: { username?: string; displayName?: string } };

const DEFAULT_PRESENTATION: OperatorPresentation = {
  welcomeText: '您好，请问有什么可以帮您？',
  avatarUrl: '',
};

export default function OperatorProfileSettings({ username, role }: { username: string; role: string }) {
  const [presentation, setPresentation] = useState(DEFAULT_PRESENTATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
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
      flash('名称已更新');
    } catch (err) {
      setError(getErrorMessage(err, '修改名称失败'));
    } finally {
      setNameSaving(false);
    }
  };

  const saveWelcome = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch<PresentationResponse>('/api/admins/presentation', {
        method: 'PUT',
        body: JSON.stringify({ welcomeText: presentation.welcomeText }),
      });
      setPresentation(prev => ({ ...prev, ...(response.presentation || {}) }));
      flash('欢迎词已保存');
    } catch (err) {
      setError(getErrorMessage(err, '保存欢迎词失败'));
    } finally {
      setSaving(false);
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
      flash('密码已更新，其他登录会话已撤销');
    } catch (err) {
      setError(getErrorMessage(err, '修改密码失败'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const displayName = presentation.displayName || username || '当前账号';

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
                aria-label="客服显示名称"
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
            <button type="button" className="account-display-name-view" onClick={beginNameEdit} title="点击修改名称">
              <b>{displayName}</b><small>点击修改</small>
            </button>
          )}
          <span>{role === 'SUPER_ADMIN' ? '超级管理员' : '客服'}</span>
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

      <div className="account-setting-block">
        <label className="account-welcome-field">
          <span><b>欢迎词</b><small>访客进入会话时显示</small></span>
          <textarea rows={3} maxLength={300} value={presentation.welcomeText} onChange={event => setPresentation(prev => ({ ...prev, welcomeText: event.target.value }))} />
        </label>
        <button type="button" onClick={saveWelcome} disabled={saving || loading}>{saving ? '保存中…' : '保存欢迎词'}</button>
      </div>

      <form className="account-setting-block account-password-form" onSubmit={changePassword} autoComplete="off">
        <label><span><b>登录密码</b><small>修改后撤销本账号的其他后台会话</small></span><input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="新密码（至少 12 位）" /></label>
        <button type="submit" disabled={passwordSaving || password.length < 12}>{passwordSaving ? '修改中…' : '修改密码'}</button>
      </form>

      {notice ? <p className="account-setting-notice">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
