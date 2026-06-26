import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { ErrorBoundary, CrashScreen } from './ErrorBoundary';
import { getErrorMessage } from './compat';

const rootElement = document.getElementById('root');
const renderCrash = (message: string) => {
  if (!rootElement) return;
  createRoot(rootElement).render(<CrashScreen message={message} />);
};

window.onerror = (_message, _source, _lineno, _colno, error) => {
  renderCrash(getErrorMessage(error || _message));
};

window.onunhandledrejection = (event) => {
  renderCrash(getErrorMessage(event.reason));
};

if (!rootElement) {
  document.body.innerHTML = '<div class="page crash-page"><div class="crash-card"><h1>页面加载失败</h1><p>请刷新重试，或更换浏览器。</p><pre>错误信息：root 节点不存在</pre></div></div>';
} else {
  createRoot(rootElement).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
}