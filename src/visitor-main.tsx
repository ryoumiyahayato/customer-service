import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import VisitorApp from './apps/VisitorApp';
import LinkExpired from './common/LinkExpired';

const TOKEN_PATTERN = /^[a-f0-9]{40}$/i;

function tokenFromPath() {
  const match = location.pathname.match(/^\/g\/([^/]+)\/?$/);
  if (!match) return '';
  try {
    const token = decodeURIComponent(match[1]);
    return TOKEN_PATTERN.test(token) ? token.toLowerCase() : '';
  } catch {
    return '';
  }
}

const root = document.getElementById('root');
if (root) {
  const token = tokenFromPath();
  createRoot(root).render(
    <React.StrictMode>
      {token ? <VisitorApp token={token} /> : <LinkExpired />}
    </React.StrictMode>,
  );
}
