#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) { writeFileSync(path, content); }
function replaceExact(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`missing exact anchor: ${label}`);
  return source.replace(search, replacement);
}
function replaceRegex(source, pattern, replacement, label, expectedMin = 1) {
  let count = 0;
  const next = source.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count < expectedMin) throw new Error(`missing regex anchor: ${label}; got ${count}`);
  return next;
}

function transformWorkerEntry() {
  const path = 'src/worker-entry.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { jsonResponse } from './security/responseHeaders';\n",
    "import { jsonResponse } from './security/responseHeaders';\nimport { activeAdminSession } from './security/adminSession';\nimport { hashPassword } from './security/passwords';\nimport { isSameOriginWrite } from './security/requestOrigin';\nimport {\n  LEGACY_ENABLED_OPERATOR_POLICY,\n  normalizeOperatorPolicy as normalizePolicy,\n  readOperatorPolicy as readPolicy,\n  writeOperatorPolicy as writePolicy,\n  type OperatorPolicy,\n} from './security/operatorPolicy';\n",
    'worker-entry imports');
  s = replaceRegex(s, /type OperatorPolicy = \{[\s\S]*?\};\n\n/, '', 'worker-entry local policy type');
  s = replaceRegex(s, /const DEFAULT_OPERATOR_POLICY: OperatorPolicy = \{[\s\S]*?\};\n/, '', 'worker-entry default policy');
  s = replaceRegex(s, /function sameOriginWrite\(req: Request\) \{[\s\S]*?\n\}\n/, "const sameOriginWrite = isSameOriginWrite;\n", 'worker-entry same origin');
  s = replaceRegex(s,
    /function operatorPolicyKey\(adminId: string\) \{[\s\S]*?async function writeOperatorPolicy\(env: Env, adminId: string, policy: OperatorPolicy\) \{[\s\S]*?\n\}\n/,
    "const normalizeOperatorPolicy = normalizePolicy;\nasync function readOperatorPolicy(env: Env, adminId: string) { return readPolicy(env.DB, adminId); }\nasync function writeOperatorPolicy(env: Env, adminId: string, policy: OperatorPolicy) { return writePolicy(env.DB, adminId, policy); }\n",
    'worker-entry policy helpers');
  s = replaceRegex(s,
    /async function currentAdminContext\(env: Env, req: Request\): Promise<AdminContext \| null> \{[\s\S]*?\n\}\n\nasync function requireSuperContext/,
    "async function currentAdminContext(env: Env, req: Request): Promise<AdminContext | null> {\n  const active = await activeAdminSession(env, req);\n  return active ? { id: active.id, username: active.username, role: active.role, sessionId: active.sessionId } : null;\n}\n\nasync function requireSuperContext",
    'worker-entry admin context');
  s = s.replace("const policy = admin.role === 'OPERATOR' ? await readOperatorPolicy(env, admin.id) : { ...DEFAULT_OPERATOR_POLICY };",
    "const policy = admin.role === 'OPERATOR' ? await readOperatorPolicy(env, admin.id) : { ...LEGACY_ENABLED_OPERATOR_POLICY };");
  s = replaceRegex(s, /function b64\(bytes: Uint8Array\) \{[\s\S]*?async function hashAdminPassword\(password: string\) \{[\s\S]*?\n\}\n/, '', 'worker-entry password helper');
  s = s.replaceAll('hashAdminPassword(', 'hashPassword(');
  write(path, s);
}

function transformWorkerFinal() {
  const path = 'src/worker-final.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { jsonResponse } from './security/responseHeaders';\n",
    "import { jsonResponse } from './security/responseHeaders';\nimport { activeAdminSession } from './security/adminSession';\nimport { readOperatorPolicy } from './security/operatorPolicy';\nimport { isSameOriginWebSocket as sameOriginWebSocket } from './security/requestOrigin';\n",
    'worker-final imports');
  s = replaceRegex(s, /function isSameOriginWebSocket\(req: Request\) \{[\s\S]*?\n\}\n/, '', 'worker-final websocket origin');
  s = s.replace('if (!isSameOriginWebSocket(req)) {', 'if (!sameOriginWebSocket(req)) {');
  s = replaceRegex(s,
    /async function currentStaffAdmin\(env: Env, req: Request\): Promise<StaffAdminContext \| null> \{[\s\S]*?\n\}\n\nasync function staffChatAllowed/,
    "async function currentStaffAdmin(env: Env, req: Request): Promise<StaffAdminContext | null> {\n  const active = await activeAdminSession(env, req, { touch: true });\n  return active ? { id: active.id, role: active.role, sessionId: active.sessionId } : null;\n}\n\nasync function staffChatAllowed",
    'worker-final admin session');
  s = replaceRegex(s,
    /async function staffChatAllowed\(env: Env, admin: StaffAdminContext\) \{[\s\S]*?\n\}\n\nasync function openStaffSocket/,
    "async function staffChatAllowed(env: Env, admin: StaffAdminContext) {\n  if (admin.role === 'SUPER_ADMIN') return true;\n  if (admin.role !== 'OPERATOR') return false;\n  return (await readOperatorPolicy(env.DB, admin.id)).canUseStaffChat;\n}\n\nasync function openStaffSocket",
    'worker-final policy');
  write(path, s);
}

function transformChatRoom() {
  const path = 'src/durable-objects/ChatRoom.ts';
  let s = read(path);
  s = "import { parseStoredOperatorPolicy } from '../security/operatorPolicy';\n\n" + s;
  s = replaceExact(s,
    "    if (!row.policy_json) return true;\n    try {\n      const policy = JSON.parse(row.policy_json) as { canUseStaffChat?: unknown };\n      return policy.canUseStaffChat !== false;\n    } catch {\n      return true;\n    }",
    "    return parseStoredOperatorPolicy(row.policy_json).canUseStaffChat;",
    'chatroom fail-closed policy');
  write(path, s);
}

function transformPublicGate() {
  const path = 'src/worker-public-gate.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { jsonResponse } from './security/responseHeaders';\n",
    "import { jsonResponse } from './security/responseHeaders';\nimport { activeAdminSession } from './security/adminSession';\nimport { hashPassword } from './security/passwords';\nimport { isSameOriginWrite } from './security/requestOrigin';\n",
    'public gate imports');
  s = replaceRegex(s, /function sameOriginWrite\(req: Request\) \{[\s\S]*?\n\}\n/, "const sameOriginWrite = isSameOriginWrite;\n", 'public gate origin');
  s = replaceRegex(s,
    /async function currentAdminContext\(env: Env, req: Request\): Promise<AdminContext \| null> \{[\s\S]*?\n\}\n\nfunction b64/,
    "async function currentAdminContext(env: Env, req: Request): Promise<AdminContext | null> {\n  const active = await activeAdminSession(env, req, { touch: true });\n  return active ? { id: active.id, username: active.username, displayName: active.displayName, role: active.role, sessionId: active.sessionId } : null;\n}\n\nfunction b64",
    'public gate admin context');
  s = replaceRegex(s, /function b64\(bytes: Uint8Array\) \{[\s\S]*?async function hashAdminPassword\(password: string\) \{[\s\S]*?\n\}\n/, '', 'public gate password helper');
  s = s.replaceAll('hashAdminPassword(', 'hashPassword(');
  write(path, s);
}

function transformPresentation() {
  const path = 'src/worker-presentation.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';\n",
    "import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';\nimport { activeAdminSession } from './security/adminSession';\nimport { isSameOriginWrite } from './security/requestOrigin';\n",
    'presentation imports');
  s = replaceRegex(s, /function isLocalDevHost\(host: string\) \{[\s\S]*?function sameOriginWrite\(req: Request\) \{[\s\S]*?\n\}\n/, "const sameOriginWrite = isSameOriginWrite;\n", 'presentation origin helpers');
  s = replaceRegex(s, /function adminSessionExpired\(session: AdminSessionRow,[\s\S]*?async function currentAdmin\(env: Env, req: Request\): Promise<AdminIdentity \| null> \{[\s\S]*?\n\}\n/, "async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {\n  const active = await activeAdminSession(env, req);\n  return active ? { id: active.id, username: active.username, role: active.role, is_disabled: 0 } : null;\n}\n", 'presentation admin session');
  write(path, s);
}

function transformBusiness() {
  const path = 'src/worker-business-hardening.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { jsonResponse } from './security/responseHeaders';\n",
    "import { jsonResponse } from './security/responseHeaders';\nimport { activeAdminSession } from './security/adminSession';\nimport { isSameOriginWrite } from './security/requestOrigin';\n",
    'business imports');
  s = replaceRegex(s, /function sameOriginWrite\(req: Request\) \{[\s\S]*?function isLocalDevHost\(host: string\) \{[\s\S]*?\n\}\n/, "const sameOriginWrite = isSameOriginWrite;\n", 'business origin');
  s = replaceRegex(s, /function adminSessionExpired\(session: AdminSessionRow,[\s\S]*?async function currentAdmin\(env: Env, req: Request\): Promise<AdminIdentity \| null> \{[\s\S]*?\n\}\n/, "async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {\n  const active = await activeAdminSession(env, req, { touch: true });\n  return active ? { id: active.id, username: active.username, role: active.role, is_disabled: 0 } : null;\n}\n", 'business admin session');
  write(path, s);
}

function transformSecure() {
  const path = 'src/worker-secure.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { consumeRateLimit } from './security/rateLimit';\n",
    "import { consumeRateLimit } from './security/rateLimit';\nimport { isSameOriginWrite as sharedSameOriginWrite, isSameOriginWebSocket as sharedSameOriginWebSocket } from './security/requestOrigin';\n",
    'secure imports');
  s = replaceRegex(s, /function sameOriginUrl\(value: string,[\s\S]*?function isSameOriginWrite\(req: Request\) \{[\s\S]*?\n\}\n/, "const isSameOriginWrite = sharedSameOriginWrite;\n", 'secure write origin');
  s = replaceRegex(s, /function isSameOriginWebSocket\(req: Request\) \{[\s\S]*?\n\}\n/, "const isSameOriginWebSocket = sharedSameOriginWebSocket;\n", 'secure ws origin');
  write(path, s);
}

function transformRuntime() {
  const path = 'src/runtimeWorker.ts';
  let s = read(path);
  s = replaceExact(s,
    "import { SECURITY_HEADERS, jsonResponse } from './security/responseHeaders';\n",
    "import { SECURITY_HEADERS, jsonResponse } from './security/responseHeaders';\nimport { hashPassword, verifyPassword } from './security/passwords';\nimport { DEFAULT_ADMIN_PUBLIC_HOST, DEFAULT_VISITOR_ROOT_DOMAIN, isAdminSurfaceHost, isLocalDevelopmentHost } from './domainIsolation';\n",
    'runtime imports');
  s = replaceExact(s,
    "  VISITOR_ROOT_DOMAIN?: string;\n}",
    "  VISITOR_ROOT_DOMAIN?: string;\n  VISITOR_PUBLIC_HOSTS?: string;\n  ADMIN_PUBLIC_HOST?: string;\n}",
    'runtime env domains');
  s = s.replace("const enc = new TextEncoder();\n", '');
  s = replaceRegex(s, /function b64\(bytes: Uint8Array\)[\s\S]*?async function verifyPassword\(password: string, stored: string\) \{[\s\S]*?return diff === 0; \}\n/, '', 'runtime password helpers');
  s = s.replace("const BACKEND_HOST = 'denglu.kefuxitong.net';\n", '');
  s = replaceRegex(s, /function isLocalDevHost\(host: string\) \{[\s\S]*?\n\}\n\nfunction withNoStore/, "const isLocalDevHost = isLocalDevelopmentHost;\n\nfunction withNoStore", 'runtime local host');
  s = s.replace("const visitorRoot = (env.VISITOR_ROOT_DOMAIN || 'vx9qn7zr.org').toLowerCase();", "const visitorRoot = (env.VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN).toLowerCase();");
  s = s.replace("const isBackendHost = host === BACKEND_HOST;", "const isBackendHost = isAdminSurfaceHost(host, env.ADMIN_PUBLIC_HOST || DEFAULT_ADMIN_PUBLIC_HOST);");
  write(path, s);
}

function transformDashboard() {
  const path = 'src/admin/AdminDashboard.tsx';
  let s = read(path);
  s = replaceExact(s,
    "import InviteLinkPanel from './InviteLinkPanel';\n",
    "import DesktopAdminPolish from './DesktopAdminPolish';\nimport AdminMobileShell from './AdminMobileShell';\nimport SessionClientInfo from './SessionClientInfo';\nimport SuperAdminStaffClearControl from './SuperAdminStaffClearControl';\nimport { AdminWorkspaceProvider, type AdminCapabilities, type AdminCoreView, type AdminMobileView } from './AdminWorkspaceContext';\n",
    'dashboard imports');
  s = s.replace("const [view, setView] = useState<string>('sessions');", "const [view, setView] = useState<AdminCoreView>('sessions');");
  s = s.replace("const [mobileView, setMobileView] = useState<'dir' | 'chat' | 'panel'>('dir');", "const [mobileView, setMobileView] = useState<AdminMobileView>('dir');");
  s = s.replace("  const [profileLoading, setProfileLoading] = useState(false);\n", '');
  s = s.replace("  const [dirOpen, setDirOpen] = useState(false);\n  const [mobileInviteOpen, setMobileInviteOpen] = useState(false);\n", '');
  s = replaceExact(s,
    "  const [remarkSaving, setRemarkSaving] = useState(false);\n",
    "  const [remarkSaving, setRemarkSaving] = useState(false);\n  const [capabilities, setCapabilities] = useState<AdminCapabilities>({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });\n",
    'dashboard capabilities state');
  s = replaceExact(s,
    "  const visibleSessions = useMemo(() => sessions.filter(s => sessionGroupOf(s) === sessionGroup), [sessionGroup, sessions]);\n",
    "  const visibleSessions = useMemo(() => sessions.filter(s => sessionGroupOf(s) === sessionGroup), [sessionGroup, sessions]);\n  const unreadCount = useMemo(() => sessions.filter(s => sessionGroupOf(s) === 'active').reduce((sum, session) => sum + Math.max(0, Number(session.unreadCount || 0)), 0), [sessions]);\n",
    'dashboard unread count');
  s = replaceExact(s,
    "  const currentCustomerName = customerName(cur);\n",
    "  const currentCustomerName = customerName(cur);\n  const openView = useCallback((nextView: AdminCoreView, nextMobileView?: AdminMobileView) => {\n    setView(nextView);\n    if (nextMobileView) setMobileView(nextMobileView);\n  }, []);\n",
    'dashboard open view');
  s = s.replace("    setDirOpen(false);\n    setMobileInviteOpen(false);\n", "    setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });\n");
  s = replaceExact(s,
    "  useEffect(() => { fetchAdmin(); }, [fetchAdmin]);\n",
    "  useEffect(() => { fetchAdmin(); }, [fetchAdmin]);\n\n  useEffect(() => {\n    let active = true;\n    if (!admin) {\n      setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });\n      return () => { active = false; };\n    }\n    if (admin.role === 'SUPER_ADMIN') {\n      setCapabilities({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true });\n      return () => { active = false; };\n    }\n    apiFetch<{ capabilities?: Partial<AdminCapabilities> }>('/api/admin/capabilities', { retryGet: false })\n      .then(response => {\n        if (!active) return;\n        setCapabilities({\n          canCreateInvites: response.capabilities?.canCreateInvites === true,\n          canUseStaffChat: response.capabilities?.canUseStaffChat === true,\n          canUploadImages: response.capabilities?.canUploadImages === true,\n        });\n      })\n      .catch(() => { if (active) setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false }); });\n    return () => { active = false; };\n  }, [admin?.id, admin?.role]);\n\n  useEffect(() => {\n    if (!admin) return;\n    let inFlight = false;\n    const heartbeat = async () => {\n      if (document.visibilityState !== 'visible' || inFlight) return;\n      inFlight = true;\n      try {\n        await apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false, timeoutMs: 5000 });\n      } catch (error) {\n        if (isUnauthorized(error)) handleAuthExpired();\n      } finally {\n        inFlight = false;\n      }\n    };\n    const timer = window.setInterval(() => { void heartbeat(); }, 2500);\n    const onFocus = () => { void heartbeat(); };\n    const onVisible = () => { if (document.visibilityState === 'visible') void heartbeat(); };\n    addEventListener('focus', onFocus);\n    document.addEventListener('visibilitychange', onVisible);\n    return () => { window.clearInterval(timer); removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };\n  }, [admin?.id, handleAuthExpired]);\n",
    'dashboard capabilities and heartbeat');
  s = replaceRegex(s, /\n  const updateProfile = async \(e: React\.FormEvent<HTMLFormElement>\) => \{[\s\S]*?\n  \};\n/, '\n', 'dashboard old profile updater');
  s = replaceRegex(s, /\n        <div className="brand">[\s\S]*?<InviteLinkPanel adminRole=\{admin\?\.role\} operators=\{operators\} \/>/, '', 'dashboard legacy side chrome');
  s = replaceRegex(s, /\n      \{isNarrow && \(\n        <div className="mobile-admin-topbar">[\s\S]*?\n      \)\}\n\n      \{isNarrow && mobileInviteOpen[\s\S]*?\n      \)\}\n\n      \{isNarrow && dirOpen[\s\S]*?\n      \)\}/, '', 'dashboard legacy mobile chrome');
  s = replaceRegex(s, /\n\s*<h3>修改超级管理员<\/h3>\n\s*<form onSubmit=\{updateProfile\}[\s\S]*?<\/form>/g, '', 'dashboard duplicate super profile', 2);
  s = s.replaceAll("                    {renderSessionLifecycleActions(cur)}\n", "                    {renderSessionLifecycleActions(cur)}\n                    <SessionClientInfo session={cur} />\n");
  s = replaceExact(s,
    "                <section className=\"chat-panel\" style={{ height: '100%' }}>\n                  <div className=\"msgs\">",
    "                <section className=\"chat-panel\" style={{ height: '100%' }}>\n                  <SuperAdminStaffClearControl isSuper={isSuper} onCleared={fetchStaff} />\n                  <div className=\"msgs\">",
    'dashboard mobile staff clear');
  s = replaceExact(s,
    "            {view === 'staffChat' ? (\n              <div className=\"workspace\">\n                <section className=\"chat-panel\">\n                  <div className=\"msgs\">",
    "            {view === 'staffChat' ? (\n              <div className=\"workspace\">\n                <section className=\"chat-panel\">\n                  <SuperAdminStaffClearControl isSuper={isSuper} onCleared={fetchStaff} />\n                  <div className=\"msgs\">",
    'dashboard desktop staff clear');
  s = replaceExact(s,
    "  return (\n    <div className={`admin${isNarrow ? ' is-narrow' : ''}`}",
    "  const workspaceValue = { admin, sessions, currentSession: cur, currentCustomerName, operators, capabilities, unreadCount, view, mobileView, isNarrow, openView, setMobileView, refreshSessions: fetchSessions, logout, logoutLoading };\n\n  return (\n    <AdminWorkspaceProvider value={workspaceValue}>\n      <>\n    <div className={`admin${isNarrow ? ' is-narrow' : ''}`}",
    'dashboard provider open');
  s = replaceExact(s,
    "    </div>\n  );\n}",
    "    </div>\n        <DesktopAdminPolish />\n        <AdminMobileShell />\n      </>\n    </AdminWorkspaceProvider>\n  );\n}",
    'dashboard provider close');
  write(path, s);
}

function updateRegressionTests() {
  const path = 'tests/unit/postPr45UiRegressionGuards.test.mjs';
  let s = read(path);
  s = replaceRegex(s,
    /test\('admin shells resync authenticated identity after login without coupling role to capabilities',[\s\S]*?\n\}\);\n/,
    `test('admin shells consume the single dashboard workspace instead of polling identity or clicking legacy DOM', async () => {\n  for (const path of ['src/admin/AdminMobileShell.tsx', 'src/admin/DesktopAdminPolish.tsx']) {\n    const source = await read(path);\n    assert.match(source, /useAdminWorkspace/);\n    assert.doesNotMatch(source, /\\/api\\/auth\\/me|\\/api\\/admin\\/capabilities/);\n    assert.doesNotMatch(source, /buttonWithText|querySelector|MutationObserver|setInterval/);\n    assert.match(source, /openView\\(/);\n    assert.match(source, /admin-unread-badge/);\n  }\n});\n`,
    'regression shell state');
  s = replaceRegex(s,
    /test\('super admin staff clear control follows the actual staff chat surface',[\s\S]*?\n\}\);\n/,
    `test('super admin staff clear control is rendered directly without DOM observers', async () => {\n  const source = await read('src/admin/SuperAdminStaffClearControl.tsx');\n  assert.match(source, /isSuper/);\n  assert.match(source, /CLEAR_STAFF_CHAT/);\n  assert.doesNotMatch(source, /MutationObserver|querySelector|admin-staff-view/);\n});\n`,
    'regression staff clear');
  s = replaceRegex(s,
    /test\('unread badge cannot recursively observe its own portal and counts only active conversations',[\s\S]*?\n\}\);\n/,
    `test('unread state is derived by the dashboard and rendered directly in both navigation shells', async () => {\n  const dashboard = await read('src/admin/AdminDashboard.tsx');\n  const desktop = await read('src/admin/DesktopAdminPolish.tsx');\n  const mobile = await read('src/admin/AdminMobileShell.tsx');\n  const app = await read('src/apps/AdminApp.tsx');\n  const polling = await read('src/chat/polling.ts');\n  assert.match(dashboard, /const unreadCount = useMemo/);\n  assert.match(dashboard, /sessionGroupOf\\(s\\) === 'active'/);\n  assert.match(dashboard, /2500/);\n  assert.match(desktop, /unreadCount/);\n  assert.match(mobile, /unreadCount/);\n  assert.doesNotMatch(app, /AdminUnreadBadge/);\n  assert.match(polling, /800/);\n  assert.match(polling, /1600/);\n  assert.match(polling, /2500/);\n});\n`,
    'regression unread');
  write(path, s);
}

function addArchitectureTest() {
  write('tests/unit/p1ArchitectureConvergence.test.mjs', `import assert from 'node:assert/strict';\nimport { readFile, readdir } from 'node:fs/promises';\nimport test from 'node:test';\n\nconst read = path => readFile(new URL(\`../../\${path}\`, import.meta.url), 'utf8');\n\ntest('operator authorization fails closed in HTTP and websocket paths', async () => {\n  const policy = await read('src/security/operatorPolicy.ts');\n  const entry = await read('src/worker-entry.ts');\n  const finalWorker = await read('src/worker-final.ts');\n  const room = await read('src/durable-objects/ChatRoom.ts');\n  assert.match(policy, /DENY_OPERATOR_POLICY/);\n  assert.match(policy, /parseStoredOperatorPolicy/);\n  assert.doesNotMatch(finalWorker, /policy_json\\) return true|catch \\{\\s*return true/);\n  assert.doesNotMatch(room, /policy_json\\) return true|catch \\{\\s*return true/);\n  assert.match(entry, /readPolicy\\(env\\.DB/);\n});\n\ntest('cloudflare password hashing has one production implementation and preserves legacy verification', async () => {\n  const passwords = await read('src/security/passwords.ts');\n  const runtime = await read('src/runtimeWorker.ts');\n  const entry = await read('src/worker-entry.ts');\n  const gate = await read('src/worker-public-gate.ts');\n  assert.match(passwords, /PASSWORD_HASH_ITERATIONS = 210_000/);\n  assert.match(passwords, /parsed\\.iterations/);\n  assert.doesNotMatch(runtime, /deriveBits\\(\\{ name: 'PBKDF2'/);\n  assert.doesNotMatch(entry, /deriveBits\\(\\{ name: 'PBKDF2'/);\n  assert.doesNotMatch(gate, /deriveBits\\(\\{ name: 'PBKDF2'/);\n});\n\ntest('production domain values have a single source and runtime worker does not hardcode hosts', async () => {\n  const domains = await read('src/domainIsolation.ts');\n  const runtime = await read('src/runtimeWorker.ts');\n  assert.match(domains, /DEFAULT_ADMIN_PUBLIC_HOST/);\n  assert.match(domains, /DEFAULT_VISITOR_ROOT_DOMAIN/);\n  assert.doesNotMatch(runtime, /denglu\\.kefuxitong\\.net|vx9qn7zr\\.org/);\n  assert.match(runtime, /DEFAULT_ADMIN_PUBLIC_HOST/);\n  assert.match(runtime, /DEFAULT_VISITOR_ROOT_DOMAIN/);\n});\n\ntest('admin UI has one state owner and no full-document mutation observers', async () => {\n  const app = await read('src/apps/AdminApp.tsx');\n  const dashboard = await read('src/admin/AdminDashboard.tsx');\n  const sessionInfo = await read('src/admin/SessionClientInfo.tsx');\n  const staffClear = await read('src/admin/SuperAdminStaffClearControl.tsx');\n  assert.match(app, /return <AdminDashboard \\/>/);\n  assert.match(dashboard, /AdminWorkspaceProvider/);\n  assert.match(dashboard, /DesktopAdminPolish/);\n  assert.match(dashboard, /AdminMobileShell/);\n  assert.doesNotMatch(sessionInfo, /MutationObserver|createPortal|querySelector/);\n  assert.doesNotMatch(staffClear, /MutationObserver|createPortal|querySelector/);\n  const adminFiles = await readdir(new URL('../../src/admin/', import.meta.url));\n  for (const file of adminFiles.filter(name => name.endsWith('.tsx'))) {\n    const source = await read(\`src/admin/\${file}\`);\n    assert.doesNotMatch(source, /MutationObserver\\(document\\.body|observer\\.observe\\(document\\.body/);\n  }\n});\n`);
}

transformWorkerEntry();
transformWorkerFinal();
transformChatRoom();
transformPublicGate();
transformPresentation();
transformBusiness();
transformSecure();
transformRuntime();
transformDashboard();
updateRegressionTests();
addArchitectureTest();
rmSync('src/admin/AdminUnreadBadge.tsx', { force: true });
console.log('P1 convergence transformation applied');
