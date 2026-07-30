import { useState } from 'react';
import { apiFetch } from '../api';
import { getErrorMessage } from '../compat';
import '../styles.css';

type AdminLoginProps = {
  onLoginSuccess?: () => void | Promise<void>;
};

export default function AdminLogin({ onLoginSuccess }: AdminLoginProps) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); if (loading) return; setLoading(true); setError('');
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
      if (onLoginSuccess) await onLoginSuccess();
      else window.location.reload();
    }
    catch (error) { setError(getErrorMessage(error, '登录失败')); }
    setLoading(false);
  };
  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <h2>客服后台</h2>
        <p className="admin-login-sub">请使用管理员账号登录</p>
        <form className="admin-login-form" onSubmit={login} autoComplete="on">
          <input name="username" placeholder="用户名" value={user} onChange={e => setUser(e.target.value)} required autoComplete="username" />
          <input name="password" type="password" placeholder="密码" value={pass} onChange={e => setPass(e.target.value)} required autoComplete="current-password" />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? '登录中...' : '登录'}</button>
        </form>
      </div>
    </div>
  );
}
