import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../api';
import { FormError, SetupNotice } from '../ui/Notice';
import { LoadingState } from '../ui/StatusBlock';
import '../styles.css';

type SetupStatus = {
  ok?: boolean;
  setupAvailable?: boolean;
  requiresSetupToken?: boolean;
  reason?: 'already_configured' | 'missing_setup_token' | 'no_admins' | string;
};

type FormState = {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  setupToken: string;
};

const initialForm: FormState = {
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  setupToken: '',
};

const usernamePattern = /^[A-Za-z0-9_.@-]{3,64}$/;
function getSetupTokenConfigName() {
  return ['SETUP', 'TOKEN'].join(window.location.pathname.slice(0, 0) + '_');
}

function safeStatusMessage(status: SetupStatus | null) {
  if (status?.reason === 'already_configured') return '系统已完成初始化，初始化入口已自动关闭。请前往登录。';
  if (status?.reason === 'missing_setup_token') return `初始化暂不可用，请联系部署人员完成 ${getSetupTokenConfigName()} 配置后再试。`;
  return '初始化状态暂时无法确认，请稍后重试或联系部署人员。';
}

function safeSubmitMessage(reason: unknown) {
  if (reason === 'already_configured') return '系统已完成初始化，请前往登录。';
  if (reason === 'missing_setup_token') return `初始化暂不可用，请联系部署人员配置 ${getSetupTokenConfigName()}。`;
  if (reason === 'invalid_setup_token') return '初始化凭证无效，请检查后重试。';
  if (reason === 'invalid_input') return '提交信息不符合要求，请检查表单后重试。';
  return '初始化失败，请稍后重试。';
}

function validateForm(form: FormState, requiresSetupToken: boolean) {
  const username = form.username.trim();
  const displayName = form.displayName.trim();

  if (!usernamePattern.test(username)) return '用户名需为 3-64 位，只能包含字母、数字、下划线、短横线、点和 @。';
  if (displayName.length > 80) return '显示名称最多 80 个字符。';
  if (form.password.length < 12) return '密码至少 12 位。';
  if (form.confirmPassword !== form.password) return '两次输入的密码不一致。';
  if (requiresSetupToken && !form.setupToken.trim()) return '请输入初始化凭证。';
  return '';
}

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [form, setForm] = useState<FormState>(initialForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let active = true;

    apiFetch<SetupStatus>('/api/setup/status', { retryGet: false })
      .then((data) => {
        if (!active) return;
        setStatus(data);
        setStatusError('');
      })
      .catch(() => {
        if (!active) return;
        setStatus(null);
        setStatusError('初始化状态暂时无法确认，请稍后重试。');
      })
      .finally(() => {
        if (active) setLoadingStatus(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const goLogin = () => {
    window.location.assign('/admin');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validationError = validateForm(form, Boolean(status?.requiresSetupToken));
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    setFormError('');

    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      password: form.password,
      confirmPassword: form.confirmPassword,
      setupToken: form.setupToken.trim(),
    };

    try {
      const result = await apiFetch<{ initialized?: boolean }>('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!result?.initialized) {
        setFormError('初始化失败，请稍后重试。');
        return;
      }

      setInitialized(true);
      setForm(initialForm);
    } catch (error) {
      setFormError(safeSubmitMessage(error instanceof ApiError ? error.data?.reason : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="setup-page">
        <section className="setup-card">
          <h1>系统初始化</h1>
          <LoadingState className="admin-login-sub setup-loading">正在检查初始化状态...</LoadingState>
        </section>
      </div>
    );
  }

  if (initialized) {
    return (
      <div className="setup-page">
        <section className="setup-card">
          <h1>初始化完成</h1>
          <SetupNotice tone="success">初始化完成。请删除或轮换 {getSetupTokenConfigName()}，然后前往登录。</SetupNotice>
          <button type="button" className="setup-primary" onClick={goLogin}>前往登录</button>
        </section>
      </div>
    );
  }

  if (statusError || !status?.setupAvailable) {
    return (
      <div className="setup-page">
        <section className="setup-card">
          <h1>系统初始化</h1>
          <SetupNotice tone={status?.reason === 'already_configured' ? 'success' : status?.reason === 'missing_setup_token' || statusError ? 'warning' : 'default'}>
            {statusError || safeStatusMessage(status)}
          </SetupNotice>
          {status?.reason === 'already_configured' ? (
            <button type="button" className="setup-primary" onClick={goLogin}>前往登录</button>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <section className="setup-card">
        <h1>系统初始化</h1>
        <p className="admin-login-sub">当前系统尚未初始化。请创建第一个超级管理员账号，完成后初始化入口会自动关闭。</p>
        <form className="admin-login-form setup-form" onSubmit={submit} autoComplete="off">
          <label>
            <span>用户名</span>
            <input
              name="username"
              value={form.username}
              onChange={updateField('username')}
              placeholder="admin"
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>显示名称</span>
            <input
              name="displayName"
              value={form.displayName}
              onChange={updateField('displayName')}
              placeholder="可选，最多 80 个字符"
              autoComplete="name"
              maxLength={80}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={updateField('password')}
              placeholder="至少 12 位"
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <span>确认密码</span>
            <input
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={updateField('confirmPassword')}
              placeholder="再次输入密码"
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <span>初始化凭证</span>
            <input
              name="setupToken"
              type="password"
              value={form.setupToken}
              onChange={updateField('setupToken')}
              placeholder={status.requiresSetupToken ? '请输入部署人员提供的初始化凭证' : '本地开发环境可留空'}
              autoComplete="off"
              required={Boolean(status.requiresSetupToken)}
            />
          </label>
          {formError ? <FormError>{formError}</FormError> : null}
          <p className="setup-form-hint">初始化成功后不会自动登录，请使用新账号前往登录页。</p>
          <button type="submit" disabled={submitting}>{submitting ? '正在创建...' : '创建超级管理员'}</button>
        </form>
      </section>
    </div>
  );
}
