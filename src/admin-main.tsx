import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import AdminApp from './apps/AdminApp';
import SetupPage from './admin/SetupPage';
import NotFound from './common/NotFound';
import { ErrorBoundary, CrashScreen } from './ErrorBoundary';
import { isExpectedError } from './compat';
import { registerPwa } from './pwa';

const rootElement = document.getElementById('root');

function AdminSurface() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/setup') return <SetupPage />;
  if (path === '/' || path === '/admin') return <AdminApp />;
  return <NotFound />;
}

const renderCrash = (isExpected = false) => {
  if (!rootElement) return;
  createRoot(rootElement).render(<CrashScreen isExpected={isExpected} isAdmin />);
};

window.onerror = (_message, _source, _lineno, _colno, error) => {
  const err = error || _message;
  if (isExpectedError(err)) return;
  renderCrash(false);
};

window.onunhandledrejection = (event) => {
  if (isExpectedError(event.reason)) {
    event.preventDefault();
    return;
  }
  renderCrash(false);
};

if (!rootElement) {
  document.body.textContent = '页面加载失败';
} else {
  registerPwa();
  createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary isAdmin>
        <AdminSurface />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
