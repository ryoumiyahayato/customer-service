export { ChatRoom } from './worker-presentation';
import presentationWorker from './worker-presentation';
import type { Env } from './worker';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { jsonResponse } from './security/responseHeaders';
import { normalizeOperatorPresentation, operatorPresentationKey } from './operatorPresentation';
import { buildQrMatrix } from './admin/inviteQr';
import {
  clientMetadataFromRequest,
  sessionClientMetadataKey,
  type SessionClientMetadata,
} from './sessionClientMetadata';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type InvitePresentationRow = {
  source_operator_id: string | null;
  created_by_admin_id: string;
  expires_at: string;
  revoked_at: string | null;
};

type AdminRow = {
  id: string;
  username: string;
  display_name?: string | null;
  role?: 'SUPER_ADMIN' | 'OPERATOR';
  is_disabled?: number;
};

type AdminContext = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
};

type OperatorPolicy = {
  canCreateInvites: boolean;
  canUseStaffChat: boolean;
  canUploadImages: boolean;
};

type StoredSessionClientMetadata = SessionClientMetadata & { ipAddress?: string };
type SettingsRow = { key?: string; value_json: string };
type SessionListPayload = { sessions?: Array<Record<string, unknown>> };
type PresentationPayload = { presentation?: Record<string, unknown> | null };
type AdminAuditSessionRow = { admin_id: string };
type SecurityLogRow = { id: string; level: string; event: string; actor_id: string | null; message: string; created_at: string };

const inner = presentationWorker as WorkerModule;
const json = (body: unknown, status = 200) => jsonResponse(body, { status });
const DEFAULT_OPERATOR_POLICY: OperatorPolicy = {
  canCreateInvites: true,
  canUseStaffChat: true,
  canUploadImages: true,
};
const ADMIN_PASSWORD_MIN_LENGTH = 12;
const ADMIN_PASSWORD_MAX_LENGTH = 128;

function isLocalDevHost(host: string) {
  let normalized = String(host || '').toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function sameOriginWrite(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) return origin === url.origin;
  const referer = req.headers.get('referer');
  if (referer) {
    try { return new URL(referer).origin === url.origin; } catch { return false; }
  }
  return isLocalDevHost(url.hostname) || isLocalDevHost(req.headers.get('host') || '');
}

function clientIp(req: Request) {
  return String(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '')
    .trim()
    .slice(0, 64);
}

function operatorPolicyKey(adminId: string) {
  return `operator_policy:${adminId}`;
}

function normalizeOperatorPolicy(value: unknown): OperatorPolicy {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    canCreateInvites: typeof input.canCreateInvites === 'boolean' ? input.canCreateInvites : DEFAULT_OPERATOR_POLICY.canCreateInvites,
    canUseStaffChat: typeof input.canUseStaffChat === 'boolean' ? input.canUseStaffChat : DEFAULT_OPERATOR_POLICY.canUseStaffChat,
    canUploadImages: typeof input.canUploadImages === 'boolean' ? input.canUploadImages : DEFAULT_OPERATOR_POLICY.canUploadImages,
  };
}

async function readOperatorPolicy(env: Env, adminId: string) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(operatorPolicyKey(adminId)).first<SettingsRow>();
  if (!row?.value_json) return { ...DEFAULT_OPERATOR_POLICY };
  try { return normalizeOperatorPolicy(JSON.parse(row.value_json)); } catch { return { ...DEFAULT_OPERATOR_POLICY }; }
}

async function writeOperatorPolicy(env: Env, adminId: string, policy: OperatorPolicy) {
  await env.DB.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(operatorPolicyKey(adminId), JSON.stringify(policy), new Date().toISOString()).run();
}

async function currentAdminContext(env: Env, req: Request): Promise<AdminContext | null> {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, sessionId);
  const row = await env.DB.prepare(
    `SELECT a.id,a.username,a.role,s.id session_id
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
      LIMIT 1`,
  ).bind(sessionId, tokenHash).first<{ id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; session_id: string }>();
  if (!row?.id) return null;
  return { id: row.id, username: row.username, role: row.role, sessionId: row.session_id };
}

async function requireSuperContext(env: Env, req: Request) {
  const admin = await currentAdminContext(env, req);
  if (!admin) return { error: json({ error: 'unauthenticated' }, 401), admin: null };
  if (admin.role !== 'SUPER_ADMIN') return { error: json({ error: 'forbidden' }, 403), admin: null };
  return { error: null, admin };
}

function auditId() {
  return `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

async function writeSecurityLog(
  env: Env,
  level: 'INFO' | 'WARN' | 'ERROR',
  event: string,
  actorId: string | null,
  details: Record<string, unknown>,
) {
  const createdAt = new Date().toISOString();
  const message = JSON.stringify({ event, details });
  await env.DB.prepare('INSERT INTO system_logs(id,level,event,actor_id,message,created_at) VALUES(?,?,?,?,?,?)')
    .bind(auditId(), level, event, actorId, message, createdAt).run();
}

async function readPresentation(env: Env, adminId: string) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(operatorPresentationKey(adminId)).first<SettingsRow>();
  if (!row?.value_json) return normalizeOperatorPresentation(null);
  try {
    return normalizeOperatorPresentation(JSON.parse(row.value_json));
  } catch {
    return normalizeOperatorPresentation(null);
  }
}

function rewrittenJsonResponse(response: Response, payload: unknown) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleInvitePresentation(env: Env, token: string) {
  if (!/^[a-f0-9]{40}$/.test(token)) return json({ presentation: null }, 404);
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  const invite = await env.DB.prepare(
    'SELECT source_operator_id,created_by_admin_id,expires_at,revoked_at FROM invite_links WHERE token_hash=? LIMIT 1',
  ).bind(tokenHash).first<InvitePresentationRow>();

  if (!invite) return json({ presentation: null }, 404);
  if (invite.revoked_at || invite.expires_at <= new Date().toISOString()) return json({ presentation: null });

  const presentationOwnerId = String(invite.source_operator_id || invite.created_by_admin_id || '').trim();
  if (!presentationOwnerId) return json({ presentation: null });

  const target = await env.DB.prepare(
    'SELECT id,username,display_name,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1',
  ).bind(presentationOwnerId).first<AdminRow>();
  if (!target?.id) return json({ presentation: null });

  const presentation = await readPresentation(env, target.id);
  const avatarVersion = presentation.avatarKey.split('/').pop()?.split('.')[0] || '';
  return json({
    presentation: {
      operatorId: target.id,
      displayName: String(target.display_name || target.username || '在线客服'),
      welcomeText: presentation.welcomeText,
      avatarUrl: presentation.avatarKey
        ? `/api/operator-avatar/${encodeURIComponent(target.id)}?v=${encodeURIComponent(avatarVersion)}`
        : '',
      qrBackgroundColor: presentation.qrBackgroundColor,
      qrAccentColor: presentation.qrAccentColor,
      qrTopText: presentation.qrTopText,
      qrBottomText: presentation.qrBottomText,
    },
  });
}

async function enrichPresentationResponse(response: Response, env: Env) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as PresentationPayload | null;
  const operatorId = typeof payload?.presentation?.operatorId === 'string' ? payload.presentation.operatorId : '';
  if (!payload?.presentation || !operatorId) return response;
  const presentation = await readPresentation(env, operatorId);
  payload.presentation = { ...payload.presentation, qrAccentColor: presentation.qrAccentColor };
  return rewrittenJsonResponse(response, payload);
}

async function storeSessionClientMetadata(env: Env, req: Request, sessionId: string, capturedAt: string) {
  if (!sessionId) return;
  const metadata = clientMetadataFromRequest(req, capturedAt);
  const stored: StoredSessionClientMetadata = { ...metadata, ipAddress: clientIp(req) };
  if (!stored.deviceLabel && !stored.approximateLocation && !stored.ipAddress) return;
  await env.DB.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(sessionClientMetadataKey(sessionId), JSON.stringify(stored), capturedAt).run();
}

async function loadSessionMetadata(env: Env, sessionIds: string[]) {
  const result = new Map<string, StoredSessionClientMetadata>();
  const unique = [...new Set(sessionIds.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const chunk = unique.slice(offset, offset + 80);
    if (!chunk.length) continue;
    const keys = chunk.map(sessionClientMetadataKey);
    const rows = await env.DB.prepare(
      `SELECT key,value_json FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`,
    ).bind(...keys).all<SettingsRow>();
    for (const row of rows.results || []) {
      const key = String(row.key || '');
      const sessionId = key.startsWith('session_client_meta:') ? key.slice('session_client_meta:'.length) : '';
      if (!sessionId) continue;
      try {
        const parsed = JSON.parse(row.value_json) as Partial<StoredSessionClientMetadata>;
        result.set(sessionId, {
          deviceLabel: typeof parsed.deviceLabel === 'string' ? parsed.deviceLabel : '',
          approximateLocation: typeof parsed.approximateLocation === 'string' ? parsed.approximateLocation : '',
          capturedAt: typeof parsed.capturedAt === 'string' ? parsed.capturedAt : '',
          ipAddress: typeof parsed.ipAddress === 'string' ? parsed.ipAddress : '',
        });
      } catch {
        // Ignore malformed legacy metadata rather than failing the session list.
      }
    }
  }
  return result;
}

async function enrichSessionListResponse(response: Response, env: Env, req: Request) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as SessionListPayload | null;
  if (!payload || !Array.isArray(payload.sessions)) return response;
  const sessionIds = payload.sessions.map(session => typeof session.id === 'string' ? session.id : '').filter(Boolean);
  if (!sessionIds.length) return response;
  const [metadata, admin] = await Promise.all([loadSessionMetadata(env, sessionIds), currentAdminContext(env, req)]);
  payload.sessions = payload.sessions.map((session) => {
    const id = typeof session.id === 'string' ? session.id : '';
    const client = metadata.get(id);
    if (!client) return session;
    return {
      ...session,
      device_label: client.deviceLabel,
      approximate_location: client.approximateLocation,
      client_metadata_captured_at: client.capturedAt,
      ...(admin?.role === 'SUPER_ADMIN' && client.ipAddress ? { ip_address: client.ipAddress } : {}),
    };
  });
  return rewrittenJsonResponse(response, payload);
}

async function cleanupPurgedSessionMetadata(env: Env) {
  await env.DB.prepare(
    `DELETE FROM settings
      WHERE key LIKE 'session_client_meta:%'
        AND EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.id=substr(settings.key,21)
            AND s.purged_at IS NOT NULL
        )`,
  ).run();
}

async function staffClearActorId(env: Env, req: Request) {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return '';
  const session = await env.DB.prepare(
    `SELECT admin_id FROM admin_sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId)).first<AdminAuditSessionRow>();
  return String(session?.admin_id || '');
}

async function writeStaffClearAudit(env: Env, req: Request, response: Response) {
  if (!response.ok) return;
  const payload = await response.clone().json().catch(() => null) as { deleted?: unknown; clearedAt?: unknown } | null;
  const actorId = await staffClearActorId(env, req);
  if (!actorId) return;
  const clearedAt = typeof payload?.clearedAt === 'string' ? payload.clearedAt : new Date().toISOString();
  const deleted = Number(payload?.deleted || 0);
  const message = JSON.stringify({
    event: 'admin.staff_chat.clear',
    resource: 'staff_messages',
    path: '/api/staff-chat',
    method: 'DELETE',
    details: { deleted, clearedAt },
  });
  await env.DB.prepare('INSERT INTO system_logs(id,level,event,actor_id,message,created_at) VALUES(?,?,?,?,?,?)')
    .bind(auditId(), 'WARN', 'admin.staff_chat.clear', actorId, message, clearedAt).run();
}

async function enforceOperatorPolicy(req: Request, env: Env) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const relevant = (url.pathname === '/api/invites' && method === 'POST')
    || (url.pathname === '/api/staff-chat' && ['GET', 'POST'].includes(method))
    || (url.pathname === '/api/upload' && method === 'POST');
  if (!relevant) return null;
  const admin = await currentAdminContext(env, req);
  if (!admin || admin.role !== 'OPERATOR') return null;
  const policy = await readOperatorPolicy(env, admin.id);
  if (url.pathname === '/api/invites' && !policy.canCreateInvites) return json({ error: 'operator_permission_denied', capability: 'canCreateInvites' }, 403);
  if (url.pathname === '/api/staff-chat' && !policy.canUseStaffChat) return json({ error: 'operator_permission_denied', capability: 'canUseStaffChat' }, 403);
  if (url.pathname === '/api/upload' && !policy.canUploadImages) return json({ error: 'operator_permission_denied', capability: 'canUploadImages' }, 403);
  return null;
}

async function handleCapabilities(req: Request, env: Env) {
  const admin = await currentAdminContext(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const policy = admin.role === 'OPERATOR' ? await readOperatorPolicy(env, admin.id) : { ...DEFAULT_OPERATOR_POLICY };
  return json({ capabilities: { ...policy, canViewRawInviteLink: admin.role === 'SUPER_ADMIN', canViewRiskCenter: admin.role === 'SUPER_ADMIN' } });
}

async function handleRiskOverview(req: Request, env: Env) {
  const { error } = await requireSuperContext(env, req);
  if (error) return error;
  const [failed, warnings, activeSessions, totalOperators, disabledOperators] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM system_logs WHERE event='security.admin_login.failed' AND datetime(created_at)>=datetime('now','-1 day')").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM system_logs WHERE (event LIKE 'security.%' OR level IN ('WARN','ERROR')) AND datetime(created_at)>=datetime('now','-1 day')").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.revoked_at IS NULL AND datetime(s.expires_at)>datetime('now') AND COALESCE(a.is_disabled,0)=0").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM admins WHERE role='OPERATOR'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM admins WHERE role='OPERATOR' AND COALESCE(is_disabled,0)=1").first<{ count: number }>(),
  ]);
  return json({ overview: {
    failedAdminLogins24h: Number(failed?.count || 0),
    warningEvents24h: Number(warnings?.count || 0),
    activeAdminSessions: Number(activeSessions?.count || 0),
    totalOperators: Number(totalOperators?.count || 0),
    disabledOperators: Number(disabledOperators?.count || 0),
  } });
}

function safeLogDetails(message: string) {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    const details = parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
      ? parsed.details as Record<string, unknown>
      : {};
    const allowed: Record<string, unknown> = {};
    for (const key of ['username', 'ip', 'device', 'location', 'resource', 'deleted', 'clearedAt', 'operatorId', 'reason']) {
      const value = details[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') allowed[key] = value;
    }
    return allowed;
  } catch {
    return {};
  }
}

async function handleSecurityLogs(req: Request, env: Env) {
  const { error } = await requireSuperContext(env, req);
  if (error) return error;
  const limitRaw = Number(new URL(req.url).searchParams.get('limit') || 60);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 60));
  const rows = await env.DB.prepare(
    `SELECT id,level,event,actor_id,message,created_at FROM system_logs
      WHERE event LIKE 'security.%' OR level IN ('WARN','ERROR')
      ORDER BY datetime(created_at) DESC LIMIT ?`,
  ).bind(limit).all<SecurityLogRow>();
  return json({ logs: (rows.results || []).map(row => ({
    id: row.id,
    level: row.level,
    event: row.event,
    actorId: row.actor_id,
    createdAt: row.created_at,
    details: safeLogDetails(row.message),
  })) });
}

async function handleOperatorPolicies(req: Request, env: Env) {
  const { error } = await requireSuperContext(env, req);
  if (error) return error;
  const rows = await env.DB.prepare(
    `SELECT id,username,is_disabled,last_seen_at FROM admins WHERE role='OPERATOR' ORDER BY created_at ASC`,
  ).all<{ id: string; username: string; is_disabled: number; last_seen_at: string | null }>();
  const operators = await Promise.all((rows.results || []).map(async row => ({
    id: row.id,
    username: row.username,
    isDisabled: Boolean(row.is_disabled),
    online: Boolean(row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < 5 * 60 * 1000),
    lastSeenAt: row.last_seen_at,
    policy: await readOperatorPolicy(env, row.id),
  })));
  return json({ operators });
}

async function handleOperatorPolicyUpdate(req: Request, env: Env, operatorId: string) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const { error, admin } = await requireSuperContext(env, req);
  if (error || !admin) return error!;
  if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(operatorId)) return json({ error: 'invalid_operator' }, 400);
  const target = await env.DB.prepare("SELECT id FROM admins WHERE id=? AND role='OPERATOR' LIMIT 1").bind(operatorId).first<{ id: string }>();
  if (!target?.id) return json({ error: 'operator_not_found' }, 404);
  const body = await req.json().catch(() => null);
  const policy = normalizeOperatorPolicy(body);
  await writeOperatorPolicy(env, operatorId, policy);
  await writeSecurityLog(env, 'WARN', 'security.operator_policy.changed', admin.id, { operatorId, ...policy });
  return json({ ok: true, policy });
}

async function handleRevokeOperatorSessions(req: Request, env: Env, operatorId: string) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const { error, admin } = await requireSuperContext(env, req);
  if (error || !admin) return error!;
  const target = await env.DB.prepare("SELECT id,username FROM admins WHERE id=? AND role='OPERATOR' LIMIT 1").bind(operatorId).first<{ id: string; username: string }>();
  if (!target?.id) return json({ error: 'operator_not_found' }, 404);
  const at = new Date().toISOString();
  const result = await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND revoked_at IS NULL').bind(at, operatorId).run();
  await writeSecurityLog(env, 'WARN', 'security.operator_sessions.revoked', admin.id, { operatorId, username: target.username, revoked: Number(result.meta?.changes || 0) });
  return json({ ok: true, revoked: Number(result.meta?.changes || 0) });
}

function b64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function hashAdminPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const iterations = 210000;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return `pbkdf2:${iterations}:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

async function handleResetOperatorPassword(req: Request, env: Env, operatorId: string) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const { error, admin } = await requireSuperContext(env, req);
  if (error || !admin) return error!;
  const body = await req.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH || password.length > ADMIN_PASSWORD_MAX_LENGTH) return json({ error: `密码长度必须为 ${ADMIN_PASSWORD_MIN_LENGTH}-${ADMIN_PASSWORD_MAX_LENGTH} 位` }, 400);
  const target = await env.DB.prepare("SELECT id,username FROM admins WHERE id=? AND role='OPERATOR' AND COALESCE(is_disabled,0)=0 LIMIT 1").bind(operatorId).first<{ id: string; username: string }>();
  if (!target?.id) return json({ error: 'operator_not_found' }, 404);
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE admins SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?').bind(await hashAdminPassword(password), at, operatorId),
    env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND revoked_at IS NULL').bind(at, operatorId),
  ]);
  await writeSecurityLog(env, 'WARN', 'security.operator_password.reset', admin.id, { operatorId, username: target.username });
  return json({ ok: true });
}

function publicInviteUrl(req: Request, env: Env, token: string) {
  const root = String(env.VISITOR_ROOT_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  return root ? `https://${token}.${root}/` : `${new URL(req.url).origin}/g/${encodeURIComponent(token)}`;
}

async function rewriteInviteResponse(req: Request, env: Env, response: Response) {
  if (!response.ok) return response;
  const admin = await currentAdminContext(env, req);
  if (!admin) return response;
  const payload = await response.clone().json().catch(() => null) as { invite?: Record<string, unknown>; invites?: Array<Record<string, unknown>> } | null;
  if (!payload) return response;
  if (admin.role === 'SUPER_ADMIN') {
    if (payload.invite) payload.invite.rawLinkVisible = true;
    return rewrittenJsonResponse(response, payload);
  }

  if (payload.invite) {
    const token = typeof payload.invite.token === 'string' ? payload.invite.token : '';
    const expiresAt = payload.invite.expiresAt ?? payload.invite.expires_at ?? null;
    payload.invite = token
      ? { qrMatrix: buildQrMatrix(publicInviteUrl(req, env, token)), expiresAt, rawLinkVisible: false }
      : { expiresAt, rawLinkVisible: false };
  }
  if (Array.isArray(payload.invites)) {
    payload.invites = payload.invites.map(invite => {
      const { token: _token, url: _url, token_hash: _hash, tokenHash: _camelHash, ...safe } = invite;
      return { ...safe, rawLinkVisible: false };
    });
  }
  return rewrittenJsonResponse(response, payload);
}

async function logAdminLogin(req: Request, env: Env, response: Response, loginReq: Request) {
  const body = await loginReq.json().catch(() => null) as { username?: unknown } | null;
  const username = typeof body?.username === 'string' ? body.username.trim().slice(0, 64) : '';
  const metadata = clientMetadataFromRequest(req, new Date().toISOString());
  const details = { username, ip: clientIp(req), device: metadata.deviceLabel, location: metadata.approximateLocation };
  let actorId: string | null = null;
  if (response.ok && username) {
    const actor = await env.DB.prepare('SELECT id FROM admins WHERE lower(username)=lower(?) LIMIT 1').bind(username).first<{ id: string }>();
    actorId = actor?.id || null;
  }
  await writeSecurityLog(env, response.ok ? 'INFO' : 'WARN', response.ok ? 'security.admin_login.success' : 'security.admin_login.failed', actorId, details);
}

async function revokeOtherSessionsAfterPasswordChange(req: Request, env: Env, profileReq: Request, response: Response) {
  if (!response.ok) return;
  const body = await profileReq.json().catch(() => null) as { password?: unknown } | null;
  if (typeof body?.password !== 'string' || !body.password) return;
  const admin = await currentAdminContext(env, req);
  if (!admin) return;
  const at = new Date().toISOString();
  const result = await env.DB.prepare(
    'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND id<>? AND revoked_at IS NULL',
  ).bind(at, admin.id, admin.sessionId).run();
  await writeSecurityLog(env, 'WARN', 'security.admin_password.changed', admin.id, { revokedOtherSessions: Number(result.meta?.changes || 0) });
}

function defer(ctx: ExecutionContext, promise: Promise<unknown>) {
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(promise);
  else void promise.catch(() => {});
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
    await cleanupPurgedSessionMetadata(env);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    const invitePresentationMatch = url.pathname.match(/^\/api\/invite-presentation\/([^/]+)$/);
    if (invitePresentationMatch && method === 'GET') return handleInvitePresentation(env, decodeURIComponent(invitePresentationMatch[1]));
    if (/^\/api\/sessions\/[^/]+\/restore$/.test(url.pathname) && method === 'POST') return json({ error: 'restore_not_supported' }, 410);

    if (url.pathname === '/api/admin/capabilities' && method === 'GET') return handleCapabilities(req, env);
    if (url.pathname === '/api/admin/security/overview' && method === 'GET') return handleRiskOverview(req, env);
    if (url.pathname === '/api/admin/security/logs' && method === 'GET') return handleSecurityLogs(req, env);
    if (url.pathname === '/api/admin/operator-policies' && method === 'GET') return handleOperatorPolicies(req, env);

    const policyMatch = url.pathname.match(/^\/api\/admin\/operator-policies\/([^/]+)$/);
    if (policyMatch && method === 'PUT') return handleOperatorPolicyUpdate(req, env, decodeURIComponent(policyMatch[1]));
    const revokeMatch = url.pathname.match(/^\/api\/admin\/operators\/([^/]+)\/revoke-sessions$/);
    if (revokeMatch && method === 'POST') return handleRevokeOperatorSessions(req, env, decodeURIComponent(revokeMatch[1]));
    const resetPasswordMatch = url.pathname.match(/^\/api\/admin\/operators\/([^/]+)\/reset-password$/);
    if (resetPasswordMatch && method === 'POST') return handleResetOperatorPassword(req, env, decodeURIComponent(resetPasswordMatch[1]));

    const policyBlocked = await enforceOperatorPolicy(req, env);
    if (policyBlocked) return policyBlocked;

    const loginReq = url.pathname === '/api/auth/login' && method === 'POST' ? req.clone() as unknown as Request : null;
    const profileReq = url.pathname === '/api/admins/profile' && method === 'PATCH' ? req.clone() as unknown as Request : null;
    const response = await inner.fetch(req, env, ctx);

    if (loginReq) defer(ctx, logAdminLogin(req, env, response.clone(), loginReq));
    if (profileReq) defer(ctx, revokeOtherSessionsAfterPasswordChange(req, env, profileReq, response.clone()));

    if (method === 'DELETE' && url.pathname === '/api/staff-chat' && response.ok) {
      try { await writeStaffClearAudit(env, req, response); } catch (error) { console.error('Failed to write staff chat clear audit', error); }
    }

    if (method === 'POST' && /^\/api\/guest\/[^/]+$/.test(url.pathname) && response.ok) {
      const payload = await response.clone().json().catch(() => null) as { session?: { id?: unknown } } | null;
      const sessionId = typeof payload?.session?.id === 'string' ? payload.session.id : '';
      if (sessionId) defer(ctx, storeSessionClientMetadata(env, req, sessionId, new Date().toISOString()));
    }

    if (method === 'GET' && url.pathname === '/api/sessions') return enrichSessionListResponse(response, env, req);
    if (url.pathname === '/api/admins/presentation' || url.pathname === '/api/admins/presentation/avatar') return enrichPresentationResponse(response, env);
    if (url.pathname === '/api/invites' && ['GET', 'POST'].includes(method)) return rewriteInviteResponse(req, env, response);

    return response;
  },
};
