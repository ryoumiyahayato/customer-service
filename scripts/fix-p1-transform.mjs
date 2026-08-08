#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const write = (path, value) => writeFileSync(path, value);

const transformed = read('src/admin/AdminDashboard.tsx').includes('AdminWorkspaceProvider')
  && read('src/runtimeWorker.ts').includes("from './security/passwords'");

if (!transformed) {
  console.log('P1 convergence type fixes skipped: transformed tree not present');
  process.exit(0);
}

{
  const path = 'src/security/passwords.ts';
  let s = read(path);
  s = s.replace('    salt,\n    iterations,', '    salt: Uint8Array.from(salt).buffer,\n    iterations,');
  write(path, s);
}

{
  const path = 'src/admin/AdminDashboard.tsx';
  let s = read(path);
  s = s.replace(/\n  const assignSession = async \(session: ChatSession\) => \{[\s\S]*?\n  \};\n/, '\n');
  s = s.replace('const workspaceValue = { admin, sessions,', 'const workspaceValue = { admin: admin!, sessions,');
  write(path, s);
}

{
  const path = 'src/runtimeWorker.ts';
  let s = read(path);
  const helpers = `\nasync function hmac(secret: string, value: string) { return hmacHex(secret, value); }\nasync function makeToken(env: Env, value: string) { return signValue(env.SESSION_SECRET, value); }\nasync function verifyToken(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }\nasync function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }\nfunction expiresAt(days = 1) { return new Date(Date.now() + days * 86400000).toISOString(); }\nasync function createAdminSession(env: Env, adminId: string) { const id = rid('asess'); const t = now(); await env.DB.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, adminId, await tokenHash(env, id), t, t, expiresAt()).run(); return await makeToken(env, id); }\nasync function createVisitorSession(env: Env, accountId: string, visitorKey?: string) { const id = rid('vsess'); await env.DB.prepare('INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, accountId, visitorKey || null, await tokenHash(env, id), now(), expiresAt()).run(); return await makeToken(env, id); }\n`;
  if (!s.includes('async function hmac(secret: string')) {
    s = s.replace('const clearCookie = clearSessionCookie;\n', `const clearCookie = clearSessionCookie;\n${helpers}`);
  }
  if (!s.includes('const BACKEND_HOST = DEFAULT_ADMIN_PUBLIC_HOST;')) {
    s = s.replace('const HEX_INVITE_TOKEN = /^[a-f0-9]{40}$/;', 'const BACKEND_HOST = DEFAULT_ADMIN_PUBLIC_HOST;\nconst HEX_INVITE_TOKEN = /^[a-f0-9]{40}$/;');
  }
  write(path, s);
}

for (const path of ['src/worker-presentation.ts', 'src/worker-business-hardening.ts']) {
  let s = read(path);
  if (!s.includes("from './security/adminSession'")) continue;
  s = s.replace(/type AdminSessionRow = \{[\s\S]*?\};\n\n/, '');
  s = s.replace("import { COOKIE_NAMES, readCookie } from './security/cookies';\n", '');
  s = s.replace("import { verifySignedValue } from './security/signing';\n", '');
  s = s.replace("import { hashSessionToken } from './security/sessionTokens';\n", '');
  s = s.replace("const ADMIN_COOKIE = COOKIE_NAMES.admin;\n", '');
  s = s.replace("const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;\n", '');
  s = s.replace("const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;\n", '');
  s = s.replace("const getCookie = readCookie;\n", '');
  s = s.replace(/async function verifySignedId\(env: Env,[^\n]*\n/, '');
  s = s.replace(/async function tokenHash\(env: Env,[^\n]*\n/, '');
  write(path, s);
}

{
  const path = 'src/worker-public-gate.ts';
  let s = read(path);
  if (s.includes("from './security/adminSession'")) {
    s = s.replace("import { COOKIE_NAMES, readCookie } from './security/cookies';\n", '');
    s = s.replace("import { hmacHex, verifySignedValue } from './security/signing';\n", "import { hmacHex } from './security/signing';\n");
    s = s.replace("import { hashSessionToken } from './security/sessionTokens';\n", '');
    write(path, s);
  }
}

for (const path of ['src/worker-entry.ts', 'src/worker-secure.ts']) {
  let s = read(path);
  s = s.replace(/function isLocalDevHost\(host: string\) \{[\s\S]*?\n\}\n\n/, '');
  write(path, s);
}

{
  const path = 'package.json';
  const pkg = JSON.parse(read(path));
  delete pkg.scripts.pretypecheck;
  write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

rmSync('scripts/fix-p1-transform.mjs', { force: true });
console.log('P1 convergence type fixes applied and temporary hook removed');
