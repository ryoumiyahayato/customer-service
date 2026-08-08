import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) { writeFileSync(path, content); }
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}
function replaceRegex(source, pattern, after, label) {
  const matches = source.match(pattern);
  if (!matches) throw new Error(`${label}: pattern not found`);
  return source.replace(pattern, after);
}

// ---- production-boundary structured admin runtime state ----
{
  const path = 'src/worker-production-boundary.ts';
  let s = read(path);
  s = s.replace("type SettingsRow = { value_json: string };\n", '');
  s = s.replace("const ACTIVE_ADMIN_SESSION_PREFIX = 'admin_active_session:';\nconst ADMIN_SESSION_META_PREFIX = 'admin_session_meta:';\n", '');
  s = replaceRegex(s, /function activeAdminSessionKey\(adminId: string\) \{[\s\S]*?function escapeRegExp/, 'function escapeRegExp', 'remove legacy admin settings key helpers');
  s = replaceRegex(s,
    /async function writeAdminSessionMetadata\(env: Env, req: WorkerRequest, sessionId: string, timestamp = new Date\(\)\.toISOString\(\)\) \{[\s\S]*?\n\}/,
    `async function writeAdminSessionMetadata(env: Env, req: WorkerRequest, sessionId: string, timestamp = new Date().toISOString()) {\n  const metadata = clientMetadataFromRequest(req, timestamp);\n  await env.DB.prepare(\n    \`INSERT INTO admin_session_metadata(session_id,device_label,approximate_location,captured_at)\n     VALUES(?,?,?,?)\n     ON CONFLICT(session_id) DO UPDATE SET\n       device_label=excluded.device_label,\n       approximate_location=excluded.approximate_location,\n       captured_at=excluded.captured_at\`,\n  ).bind(sessionId, metadata.deviceLabel, metadata.approximateLocation, timestamp).run();\n}`,
    'write admin metadata table');
  s = replaceOnce(s,
    `      env.DB.prepare(\n        \`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)\n          ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at\`,\n      ).bind(activeAdminSessionKey(session.admin_id), sessionId, timestamp),`,
    `      env.DB.prepare(\n        \`INSERT INTO admin_active_sessions(admin_id,session_id,updated_at) VALUES(?,?,?)\n          ON CONFLICT(admin_id) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at\`,\n      ).bind(session.admin_id, sessionId, timestamp),`,
    'activate admin typed pointer');
  s = replaceRegex(s,
    /async function enforceSingleAdminSession\(req: WorkerRequest, env: Env\) \{[\s\S]*?\n\}\n\nasync function handleActiveAdminSessions/,
    `async function enforceSingleAdminSession(req: WorkerRequest, env: Env) {\n  const context = await activeAdminContext(env, req);\n  if (!context) return null;\n  const row = await env.DB.prepare('SELECT session_id FROM admin_active_sessions WHERE admin_id=? LIMIT 1')\n    .bind(context.adminId).first<{ session_id: string }>();\n  const timestamp = new Date().toISOString();\n  if (!row?.session_id) {\n    await env.DB.batch([\n      env.DB.prepare(\n        \`INSERT INTO admin_active_sessions(admin_id,session_id,updated_at) VALUES(?,?,?)\n          ON CONFLICT(admin_id) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at\`,\n      ).bind(context.adminId, context.sessionId, timestamp),\n      env.DB.prepare(\n        'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND id<>? AND revoked_at IS NULL',\n      ).bind(timestamp, context.adminId, context.sessionId),\n    ]);\n    await writeAdminSessionMetadata(env, req, context.sessionId, timestamp).catch(() => {});\n    return null;\n  }\n  if (row.session_id === context.sessionId) return null;\n  await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND revoked_at IS NULL')\n    .bind(timestamp, context.sessionId).run().catch(() => {});\n  return hardenedJson(401, { error: 'session_replaced' }, { 'Set-Cookie': clearSessionCookie(COOKIE_NAMES.admin) });\n}\n\nasync function handleActiveAdminSessions`,
    'enforce typed active session');
  s = replaceRegex(s,
    /async function handleActiveAdminSessions\(req: WorkerRequest, env: Env\) \{[\s\S]*?\n\}\n\nasync function loginNameSnapshot/,
    `async function handleActiveAdminSessions(req: WorkerRequest, env: Env) {\n  const current = await activeAdminContext(env, req);\n  if (!current) return hardenedJson(401, { error: 'unauthenticated' });\n  if (current.role !== 'SUPER_ADMIN') return hardenedJson(403, { error: 'forbidden' });\n  const rows = await env.DB.prepare(\n    \`SELECT s.id,a.id admin_id,a.username,a.role,s.created_at,s.last_seen_at,s.expires_at,\n            COALESCE(meta.device_label,'') device_label,\n            COALESCE(meta.approximate_location,'') approximate_location\n       FROM admin_sessions s\n       JOIN admins a ON a.id=s.admin_id\n       JOIN admin_active_sessions active ON active.admin_id=a.id AND active.session_id=s.id\n       LEFT JOIN admin_session_metadata meta ON meta.session_id=s.id\n      WHERE s.revoked_at IS NULL\n        AND datetime(s.expires_at)>datetime('now')\n        AND datetime(s.created_at)>datetime('now','-1 day')\n        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')\n        AND COALESCE(a.is_disabled,0)=0\n      ORDER BY datetime(COALESCE(s.last_seen_at,s.created_at)) DESC\`,\n  ).all<ActiveAdminSessionRow & { device_label: string; approximate_location: string }>();\n  return hardenedJson(200, { sessions: (rows.results || []).map(row => ({\n    id: row.admin_id,\n    adminId: row.admin_id,\n    username: row.username,\n    role: row.role,\n    createdAt: row.created_at,\n    lastSeenAt: row.last_seen_at,\n    expiresAt: row.expires_at,\n    deviceLabel: row.device_label || '',\n    approximateLocation: row.approximate_location || '',\n    isCurrent: row.id === current.sessionId,\n  })) });\n}\n\nasync function loginNameSnapshot`,
    'list typed active sessions');
  write(path, s);
}

// ---- remove legacy /g route model and settings presentation from inner worker ----
{
  const path = 'src/worker-final.ts';
  let s = read(path);
  s = replaceOnce(s,
    `import { normalizeOperatorPresentation, operatorPresentationKey } from './operatorPresentation';`,
    `import { readOperatorPresentation } from './operatorPresentation';`,
    'worker-final presentation import');
  s = s.replace("type SettingsRow = { value_json: string };\n", '');
  s = s.replace("const INVITE_PATH = /^\\/g\\/([a-f0-9]{40})\\/?$/i;\n", '');
  s = replaceRegex(s,
    /async function readPresentation\(env: Env, adminId: string\) \{[\s\S]*?\n\}/,
    `async function readPresentation(env: Env, adminId: string) {\n  return readOperatorPresentation(env.DB, adminId);\n}`,
    'worker-final typed presentation');
  s = s.replace("      || url.pathname.startsWith('/g/')\n", '');
  s = s.replace("  if (url.pathname.startsWith('/g/') && !INVITE_PATH.test(url.pathname)) return notFound();\n\n", '');
  s = s.replace("    && !allowedVisitorAssetPath(url.pathname)\n    && !INVITE_PATH.test(url.pathname)) return notFound();", "    && !allowedVisitorAssetPath(url.pathname)) return notFound();");
  s = replaceRegex(s,
    /\n    if \(visitorHost && method === 'GET' && INVITE_PATH\.test\(url\.pathname\)\) \{\n      return serveVisitorAsset\(req, env, '\/visitor\/visitor\.html'\);\n    \}/,
    '',
    'remove worker-final legacy visitor document route');
  write(path, s);
}

// ---- central admin synchronization and capability-aware image UI ----
{
  const path = 'src/admin/AdminDashboard.tsx';
  let s = read(path);
  s = replaceOnce(s,
    `  const convOnlineRef = useRef(false);`,
    `  const convOnlineRef = useRef(false);\n  const adminFeedOnlineRef = useRef(false);\n  const lastCapabilityRefreshRef = useRef(0);`,
    'admin sync refs');

  s = replaceRegex(s,
    /  useEffect\(\(\) => \{\n    if \(!admin\) return;\n    if \(admin\.role === 'SUPER_ADMIN'\) \{[\s\S]*?\n  \}, \[admin\?\.id, admin\?\.role\]\);/,
    `  const refreshCapabilities = useCallback(async (force = false) => {\n    if (!admin) return;\n    if (admin.role === 'SUPER_ADMIN') {\n      setCapabilities({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true });\n      lastCapabilityRefreshRef.current = Date.now();\n      return;\n    }\n    if (!force && Date.now() - lastCapabilityRefreshRef.current < 10000) return;\n    try {\n      const result = await apiFetch<{ capabilities?: Partial<AdminCapabilities> }>('/api/admin/capabilities', { retryGet: false });\n      const value = result.capabilities || {};\n      setCapabilities({\n        canCreateInvites: value.canCreateInvites === true,\n        canUseStaffChat: value.canUseStaffChat === true,\n        canUploadImages: value.canUploadImages === true,\n      });\n      lastCapabilityRefreshRef.current = Date.now();\n    } catch (error) {\n      if (isUnauthorized(error)) handleAuthExpired();\n      else setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });\n    }\n  }, [admin?.id, admin?.role, handleAuthExpired]);\n\n  useEffect(() => { void refreshCapabilities(true); }, [refreshCapabilities]);`,
    'replace capability effect');

  s = replaceRegex(s,
    /  useEffect\(\(\) => \{\n    if \(!admin\) return;\n    let active = true;\n    const heartbeat = async \(\) => \{[\s\S]*?\n  \}, \[admin\?\.id, handleAuthExpired\]\);/,
    `  useEffect(() => {\n    if (!admin) return;\n    let active = true;\n    const heartbeat = async (forceCapabilities = false) => {\n      try {\n        const auth = await apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false, timeoutMs: 5000 });\n        if (!active) return;\n        if (!auth.admin) { handleAuthExpired(); return; }\n        if (forceCapabilities || Date.now() - lastCapabilityRefreshRef.current >= 10000) await refreshCapabilities(true);\n        if (!adminFeedOnlineRef.current) {\n          const list = await apiFetch<SessionListResponse>('/api/sessions?includeDeleted=1', { retryGet: false, timeoutMs: 5000 });\n          if (active) setSessions(Array.isArray(list.sessions) ? list.sessions : []);\n        }\n      } catch (error) {\n        if (isUnauthorized(error)) handleAuthExpired();\n      }\n    };\n    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void heartbeat(false); }, 2500);\n    const onVisible = () => { if (document.visibilityState === 'visible') void heartbeat(true); };\n    addEventListener('focus', onVisible);\n    document.addEventListener('visibilitychange', onVisible);\n    void heartbeat(true);\n    return () => { active = false; clearInterval(timer); removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };\n  }, [admin?.id, handleAuthExpired, refreshCapabilities]);`,
    'replace auth heartbeat');

  s = replaceRegex(s,
    /  const wsAdmin = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[admin, fetchSessions\]\);/,
    `  const wsAdmin = useCallback(() => {\n    if (!admin) return;\n    if (wsAdminRef.current) wsAdminRef.current.close();\n    const proto = location.protocol === 'https:' ? 'wss' : 'ws';\n    const ws = new WebSocket(\`${'${proto}'}://${'${location.host}'}/api/ws/admin\`);\n    ws.onopen = () => { adminFeedOnlineRef.current = true; };\n    ws.onmessage = () => { fetchSessions(); };\n    ws.onerror = () => { adminFeedOnlineRef.current = false; ws.close(); };\n    ws.onclose = () => {\n      adminFeedOnlineRef.current = false;\n      if (admin) setTimeout(wsAdmin, 5000);\n    };\n    wsAdminRef.current = ws;\n  }, [admin, fetchSessions]);`,
    'admin websocket online state');

  s = replaceOnce(s,
    `  const upload = async (file: File) => {\n    if (!sessionId || !isActiveAdminSession(sessionId)) return;`,
    `  const upload = async (file: File) => {\n    if (!capabilities.canUploadImages) { showToast('当前客服账号未被授予图片上传权限'); return; }\n    if (!sessionId || !isActiveAdminSession(sessionId)) return;`,
    'upload capability guard');

  const fileLabel = `<label className="file-btn"><span aria-hidden="true">⌘</span><input ref={uploadRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label>`;
  const conditionalLabel = `{capabilities.canUploadImages ? ${fileLabel} : null}`;
  const count = s.split(fileLabel).length - 1;
  if (count < 1) throw new Error(`upload labels: expected at least one match, got ${count}`);
  s = s.split(fileLabel).join(conditionalLabel);
  write(path, s);
}

// ---- collapse the AdminApp patch-CSS stack without changing cascade order ----
{
  const parts = [
    ['mobileAdminPolish.css', 'mobile presentation'],
    ['adminShellFinal.css', 'shell layout'],
    ['adminRegressionFixes.css', 'regression contracts'],
    ['adminUnreadBadge.css', 'unread badge'],
  ];
  const merged = parts.map(([name, label]) => `/* ---- ${label}; consolidated from ${name} ---- */\n${read(`src/admin/${name}`).trim()}\n`).join('\n');
  write('src/admin/adminWorkspace.css', merged);
  for (const [name] of parts) unlinkSync(`src/admin/${name}`);
  let app = read('src/apps/AdminApp.tsx');
  for (const [name] of parts) app = app.replace(`import '../admin/${name}';\n`, '');
  app = replaceOnce(app, `import AdminDashboard from '../admin/AdminDashboard';\n`, `import AdminDashboard from '../admin/AdminDashboard';\nimport '../admin/adminWorkspace.css';\n`, 'AdminApp workspace css');
  write('src/apps/AdminApp.tsx', app);
}

// ---- architecture regression guards ----
write('tests/unit/p2ArchitectureCleanup.test.mjs', `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');\n\ntest('visitor source is isolated by construction', () => {\n  const guest = read('src/visitor/GuestChat.tsx');\n  const vite = read('vite.config.ts');\n  assert.match(guest, /from '\\.\\/visitorApi'/);\n  assert.doesNotMatch(guest, /from '\\.\\.\\/api'/);\n  assert.doesNotMatch(guest, /\\/g\\//);\n  assert.doesNotMatch(vite, /visitorSurfaceImports|source\\.replace|from '\\.\\.\\/api'/);\n});\n\ntest('inner worker no longer owns the legacy g-token route', () => {\n  const finalWorker = read('src/worker-final.ts');\n  assert.doesNotMatch(finalWorker, /INVITE_PATH|\\/g\\/\\(\\[a-f0-9\\]/);\n  assert.doesNotMatch(finalWorker, /serveVisitorAsset\\([^)]*visitor\\/visitor\\.html/);\n});\n\ntest('dynamic runtime state is no longer stored in settings', () => {\n  const files = ['src/security/operatorPolicy.ts','src/operatorPresentation.ts','src/worker-entry.ts','src/worker-production-boundary.ts'];\n  for (const path of files) {\n    const source = read(path);\n    assert.doesNotMatch(source, /operator_policy:|operator_presentation:|session_client_meta:|admin_active_session:|admin_session_meta:/, path);\n  }\n  const migration = read('migrations/0013_structured_runtime_state.sql');\n  for (const table of ['operator_policies','operator_presentations','session_client_metadata','admin_session_metadata','admin_active_sessions']) assert.match(migration, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));\n});\n\ntest('admin app uses one consolidated workspace stylesheet', () => {\n  const app = read('src/apps/AdminApp.tsx');\n  assert.match(app, /adminWorkspace\\.css/);\n  assert.doesNotMatch(app, /mobileAdminPolish|adminShellFinal|adminRegressionFixes|adminUnreadBadge/);\n});\n\ntest('admin synchronization retains feed fallback and capability-aware upload', () => {\n  const dashboard = read('src/admin/AdminDashboard.tsx');\n  assert.match(dashboard, /adminFeedOnlineRef/);\n  assert.match(dashboard, /if \\(!auth\\.admin\\)/);\n  assert.match(dashboard, /refreshCapabilities/);\n  assert.match(dashboard, /capabilities\\.canUploadImages/);\n});\n`);

write('tests/integration/structuredRuntimeState.sqlite.test.mjs', `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\nimport { DatabaseSync } from 'node:sqlite';\n\nconst m12 = readFileSync(new URL('../../migrations/0012_enforce_operator_policy_invariant.sql', import.meta.url), 'utf8');\nconst m13 = readFileSync(new URL('../../migrations/0013_structured_runtime_state.sql', import.meta.url), 'utf8');\n\nfunction db() {\n  const db = new DatabaseSync(':memory:');\n  db.exec(\`PRAGMA foreign_keys=ON;\n    CREATE TABLE admins(id TEXT PRIMARY KEY,role TEXT NOT NULL);\n    CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);\n    CREATE TABLE sessions(id TEXT PRIMARY KEY,purged_at TEXT);\n    CREATE TABLE admin_sessions(id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,revoked_at TEXT,FOREIGN KEY(admin_id) REFERENCES admins(id));\n  \`);\n  return db;\n}\n\ntest('0013 moves dynamic settings state into typed tables and deletes legacy keys', () => {\n  const x = db();\n  x.exec(\`INSERT INTO admins(id,role) VALUES('op','OPERATOR'),('root','SUPER_ADMIN');\n    INSERT INTO sessions(id,purged_at) VALUES('s1',NULL);\n    INSERT INTO admin_sessions(id,admin_id,revoked_at) VALUES('as1','root',NULL);\n    INSERT INTO settings(key,value_json,updated_at) VALUES\n      ('operator_policy:op','{\"canCreateInvites\":false,\"canUseStaffChat\":true,\"canUploadImages\":false}','2026-01-01'),\n      ('operator_presentation:op','{\"welcomeText\":\"hi\",\"qrAccentColor\":\"#112233\"}','2026-01-01'),\n      ('session_client_meta:s1','{\"deviceLabel\":\"安卓设备\",\"approximateLocation\":\"中国\",\"capturedAt\":\"2026-01-02\",\"ipAddress\":\"1.2.3.4\"}','2026-01-02'),\n      ('admin_active_session:root','as1','2026-01-03'),\n      ('admin_session_meta:as1','{\"deviceLabel\":\"Windows 电脑\",\"approximateLocation\":\"中国\",\"capturedAt\":\"2026-01-03\"}','2026-01-03');\n  \`);\n  x.exec(m12);\n  x.exec(m13);\n  assert.deepEqual(x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('op'), { can_create_invites: 0, can_use_staff_chat: 1, can_upload_images: 0 });\n  assert.equal(x.prepare('SELECT welcome_text FROM operator_presentations WHERE admin_id=?').get('op').welcome_text, 'hi');\n  assert.equal(x.prepare('SELECT ip_address FROM session_client_metadata WHERE session_id=?').get('s1').ip_address, '1.2.3.4');\n  assert.equal(x.prepare('SELECT session_id FROM admin_active_sessions WHERE admin_id=?').get('root').session_id, 'as1');\n  assert.equal(x.prepare(\"SELECT COUNT(*) n FROM settings WHERE key LIKE 'operator_policy:%' OR key LIKE 'operator_presentation:%' OR key LIKE 'session_client_meta:%' OR key LIKE 'admin_active_session:%' OR key LIKE 'admin_session_meta:%'\").get().n, 0);\n  x.close();\n});\n\ntest('typed policy remains fail closed and promotion replaces stale state', () => {\n  const x = db();\n  x.exec(\`INSERT INTO admins(id,role) VALUES('future','SUPER_ADMIN'); INSERT INTO settings(key,value_json,updated_at) VALUES('operator_policy:future','not-json','2026-01-01');\`);\n  x.exec(m12);\n  x.exec(m13);\n  x.prepare('UPDATE admins SET role=? WHERE id=?').run('OPERATOR','future');\n  assert.deepEqual(x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('future'), { can_create_invites: 1, can_use_staff_chat: 1, can_upload_images: 1 });\n  assert.throws(() => x.prepare('DELETE FROM operator_policies WHERE admin_id=?').run('future'), /operator_policy_required/);\n  x.close();\n});\n`);

console.log('PR52 final P2 transform applied');
