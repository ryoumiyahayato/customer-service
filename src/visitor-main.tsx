import React from 'react';
import { createRoot } from 'react-dom/client';
import './visitor/visitorChat.css';
import VisitorApp from './apps/VisitorApp';
import LinkExpired from './common/LinkExpired';

const TOKEN_PATTERN = /^[a-f0-9]{40}$/i;
const VISITOR_ROOT_DOMAIN = String(
  (import.meta.env.VITE_VISITOR_ROOT_DOMAIN as string | undefined) || 'vx9qn7zr.org',
).trim().toLowerCase().replace(/^\.+|\.+$/g, '');

function tokenFromHost() {
  if (location.pathname !== '/' || !VISITOR_ROOT_DOMAIN) return '';
  const hostname = location.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  const suffix = `.${VISITOR_ROOT_DOMAIN}`;
  if (!hostname.endsWith(suffix) || hostname === VISITOR_ROOT_DOMAIN) return '';
  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes('.') || !TOKEN_PATTERN.test(label)) return '';
  return label;
}

const root = document.getElementById('root');
if (root) {
  const token = tokenFromHost();
  createRoot(root).render(
    <React.StrictMode>
      {token ? <VisitorApp token={token} /> : <LinkExpired />}
    </React.StrictMode>,
  );
}
