#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const dashboardPath = path.join(root, 'src', 'admin', 'AdminDashboard.tsx');
const messageListPath = path.join(root, 'src', 'admin', 'AdminMessageList.tsx');
let failed = 0;

function fail(message) {
  failed += 1;
  console.error(`FAIL ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function requireSnippet(content, snippet, label) {
  if (content.includes(snippet)) pass(label);
  else fail(label);
}

if (!existsSync(dashboardPath)) {
  fail('AdminDashboard.tsx exists');
} else {
  const dashboard = readFileSync(dashboardPath, 'utf8');
  requireSnippet(dashboard, 'messageLoadRequestIdRef', 'fetchMsgs has request id tracking');
  requireSnippet(dashboard, 'isLatestMessageLoad(sid, requestId)', 'fetchMsgs validates latest request id and session id');
  requireSnippet(dashboard, 'messageSyncRequestIdRef', 'fallback polling has request id tracking');
  requireSnippet(dashboard, 'isLatestMessageSync(sid, requestId)', 'fallback polling validates latest request id and session id');
  requireSnippet(dashboard, 'setActiveAdminSessionId(s.id)', 'session switch records active admin session before loading');
  requireSnippet(dashboard, 'messageBelongsToActiveSession(d.message, sid)', 'websocket message payload is checked against active session');
  requireSnippet(dashboard, 'filterMessagesForSession(prev, sid)', 'websocket and fallback writes filter existing state by session');

  if (/apiFetch\(`\/api\/sessions\/\$\{sid\}\/messages`\);\s*setSelectedMsgs\(/s.test(dashboard)) {
    fail('fetchMsgs must not directly write messages after API response');
  } else {
    pass('fetchMsgs does not directly write messages after API response');
  }

  if (/ws\.onmessage[\s\S]{0,900}setSelectedMsgs\(prev => mergeMessage\(prev,/m.test(dashboard)) {
    fail('websocket onmessage must not write unfiltered current messages');
  } else {
    pass('websocket onmessage writes are filtered by session');
  }
}

if (!existsSync(messageListPath)) {
  fail('AdminMessageList.tsx exists');
} else {
  const messageList = readFileSync(messageListPath, 'utf8');
  requireSnippet(messageList, 'activeSessionGuard', 'AdminMessageList still imports activeSessionGuard fallback');
  requireSnippet(messageList, 'messageBelongsToActiveSession', 'AdminMessageList still filters cross-session messages');
}

if (failed > 0) {
  console.error(`Admin message race guard check failed: ${failed}`);
  process.exit(1);
}

console.log('Admin message race guard check passed.');
