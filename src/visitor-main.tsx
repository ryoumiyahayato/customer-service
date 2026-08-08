import React from 'react';
import { createRoot } from 'react-dom/client';
import './visitor/visitorChat.css';
import VisitorApp from './apps/VisitorApp';
import LinkExpired from './common/LinkExpired';

const TOKEN_PATTERN = /^[a-f0-9]{40}$/i;

function tokenFromHost() {
  const firstLabel = location.hostname.toLowerCase().split('.')[0] || '';
  return TOKEN_PATTERN.test(firstLabel) ? firstLabel : '';
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted && location.pathname === '/session') location.reload();
});

const root = document.getElementById('root');
if (root) {
  const token = tokenFromHost();
  createRoot(root).render(
    <React.StrictMode>
      {token ? <VisitorApp token={token} /> : <LinkExpired />}
    </React.StrictMode>,
  );
}
