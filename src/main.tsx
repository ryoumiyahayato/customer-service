import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { ErrorBoundary, CrashScreen } from './ErrorBoundary';
import { getErrorMessage, isExpectedError } from './compat';
import { isAdminMode } from './routing';
import { registerPwa } from './pwa';

function isAdminPath() {
  return isAdminMode(location);
}

const rootElement = document.getElementById('root');
const renderCrash = (message: string, isExpected = false) => {
  if (!rootElement) return;
  createRoot(rootElement).render(<CrashScreen message={message} isExpected={isExpected} isAdmin={isAdminPath()} />);
};

window.onerror = (_message, _source, _lineno, _colno, error) => {
  const err = error || _message;
  if (isExpectedError(err)) return;
  renderCrash(getErrorMessage(err));
};

window.onunhandledrejection = (event) => {
  if (isExpectedError(event.reason)) {
    event.preventDefault();
    console.warn('Unhandled rejection (expected, suppressed):', event.reason);
    return;
  }
  renderCrash(getErrorMessage(event.reason));
};

if (!rootElement) {
  document.body.innerHTML = '<div class="page crash-page"><div class="crash-card"><h1>页面加载失败</h1><p>请刷新重试，或更换浏览器。</p><pre>错误信息：root 节点不存在</pre></div></div>';
} else {
  registerPwa();
  createRoot(rootElement).render(<React.StrictMode><ErrorBoundary isAdmin={isAdminPath()}><App /></ErrorBoundary></React.StrictMode>);
}
