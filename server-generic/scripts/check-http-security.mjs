#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSameOriginWebSocket, isSameOriginWrite } from '../dist/security.js';

const request = (method, headers) => ({ method, headers });
assert.equal(isSameOriginWrite(request('GET', { host: 'admin.example.com' })), true);
assert.equal(isSameOriginWrite(request('GET', {
  host: 'admin.example.com',
  cookie: 'support_admin=session',
})), false);
assert.equal(isSameOriginWrite(request('GET', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  referer: 'https://admin.example.com/conversations',
  cookie: 'support_admin=session',
})), true);
assert.equal(isSameOriginWrite(request('GET', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  referer: 'https://evil.example/',
  cookie: 'support_admin=session',
})), false);
assert.equal(isSameOriginWrite(request('POST', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  origin: 'https://admin.example.com',
  cookie: 'support_admin=session',
})), true);
assert.equal(isSameOriginWrite(request('POST', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  origin: 'https://evil.example',
  cookie: 'support_admin=session',
})), false);
assert.equal(isSameOriginWrite(request('POST', {
  host: 'admin.example.com',
  cookie: 'support_admin=session',
})), false);
assert.equal(isSameOriginWrite(request('POST', {
  host: '127.0.0.1:8788',
  cookie: 'support_admin=session',
})), true);
assert.equal(isSameOriginWrite(request('POST', { host: 'admin.example.com' })), true);
assert.equal(isSameOriginWebSocket(request('GET', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  origin: 'https://admin.example.com',
})), true);
assert.equal(isSameOriginWebSocket(request('GET', {
  host: 'admin.example.com',
  'x-forwarded-proto': 'https',
  origin: 'https://evil.example',
})), false);
assert.equal(isSameOriginWebSocket(request('GET', { host: 'admin.example.com' })), false);
assert.equal(isSameOriginWebSocket(request('GET', { host: '127.0.0.1:8788' })), true);

const [responseSource, indexSource, caddy] = await Promise.all([
  readFile(new URL('../src/response.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../deploy/linux/Caddyfile', import.meta.url), 'utf8'),
]);
assert.match(responseSource, /strict-transport-security/);
assert.match(responseSource, /content-security-policy/);
assert.match(indexSource, /applySecurityHeaders\(response\)/);
assert.match(indexSource, /isSameOriginWrite\(request\)/);
assert.match(caddy, /Strict-Transport-Security/);
assert.match(caddy, /X-Frame-Options/);

console.log('server-generic HTTP security checks passed');
