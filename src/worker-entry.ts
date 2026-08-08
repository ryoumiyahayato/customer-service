export { ChatRoom } from './worker-presentation';
import presentationWorker from './worker-presentation';
import type { Env } from './worker';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { jsonResponse } from './security/responseHeaders';
import { activeAdminSession } from './security/adminSession';
import { hashPassword } from './security/passwords';
import { isSameOriginWrite } from './security/requestOrigin';
import {
  LEGACY_ENABLED_OPERATOR_POLICY,
  normalizeOperatorPolicy as normalizePolicy,
  readOperatorPolicy as readPolicy,
  writeOperatorPolicy as writePolicy,
  type OperatorPolicy,
} from './security/operatorPolicy';
import { readOperatorPresentation } from './operatorPresentation';
import { buildQrMatrix } from './admin/inviteQr';
import { buildVisitorInviteUrl, DEFAULT_VISITOR_ROOT_DOMAIN } from './domainIsolation';
import {
  clientMetadataFromRequest,
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

type StoredSessionClientMetadata = SessionClientMetadata & { ipAddress?: string };
type SessionMetadataRow = {
  session_id: string;
  device_label: string;
  approximate_location: string;
  captured_at: string;
  ip_address: string;
};
type SessionListPayload = { sessions?: Array<Record<string, unknown>> };
type PresentationPayload = { presentation?: Record<string, unknown> | null };
type AdminAuditSessionRow = { admin_id: string };
type SecurityLogRow = { id: string; level: string; event: string; actor_id: string | null; message: string; created_at: string };

const inner = presentationWorker as WorkerModule;
const json = (body: unknown, status = 200) => jsonResponse(body, { status });
const ADMIN_PASSWORD_MIN_LENGTH = 12;
const ADMIN_PASSWORD_MAX_LENGTH = 128;

const sameOriginWrite = isSameOriginWrite;

function clientIp(req: Request) {
  return String(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '')
    .trim()
    .slice(0, 64);
}

const normalizeOperatorPolicy = normalizePolicy;
async function readOperatorPolicy(env: Env, adminId: string) { return readPolicy(env.DB, adminId); }
async function writeOperatorPolicy(env: Env, adminId: string, policy: OperatorPolicy) { return writePolicy(env.DB, adminId, policy); }

async function currentAdminContext(env: Env, req: Request): Promise<AdminContext | null> {
  const active = await activeAdminSession(env, req);
  return active ? { id: active.id, username: active.username, role: active.role, sessionId: active.sessionId } : null;
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
  return readOperatorPresentation(env.DB, adminId);
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
    `INSERT INTO session_client_metadata(session_id,device_label,approximate_location,captured_at,ip_address)
     VALUES(?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       device_label=excluded.device_label,
       approximate_location=excluded.approximate_location,
       captured_at=excluded.captured_at,
       ip_address=excluded.ip_address`,
  ).bind(sessionId, stored.deviceLabel, stored.approximateLocation, capturedAt, stored.ipAddress || '').run();
}

async function loadSessionMetadata(env: Env, sessionIds: string[]) {
  const result = new Map<string, StoredSessionClientMetadata>();
  const unique = [...new Set(sessionIds.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const chunk = unique.slice(offset, offset + 80);
    if (!chunk.length) continue;
    const rows = await env.DB.prepare(
      `SELECT session_id,device_label,approximate_location,captured_at,ip_address
         FROM session_client_metadata WHERE session_id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<SessionMetadataRow>();
    for (const row of rows.results || []) {
      result.set(row.session_id, {
        deviceLabel: row.device_label || '',
        approximateLocation: row.approximate_location || '',
        capturedAt: row.captured_at || '',
        ipAddress: row.ip_address || '',
      });
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
    `DELETE FROM session_client_metadata
      WHERE EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id=session_client_metadata.session_id
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
  const policy = admin.role === 'OPERATOR' ? await readOperatorPolicy(env, admin.id) : { ...LEGACY_ENABLED_OPERATOR_POLICY };
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
    env.DB.prepare('UPDATE admins SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?').bind(await hashPassword(password), at, operatorId),
    env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND revoked_at IS NULL').bind(at, operatorId),
  ]);
  await writeSecurityLog(env, 'WARN', 'security.operator_password.reset', admin.id, { operatorId, username: target.username });
  return json({ ok: true });
}

function publicInviteUrl(env: Env, token: string) {
  return buildVisitorInviteUrl(token, String(env.VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN));
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
      ? { qrMatrix: buildQrMatrix(publicInviteUrl(env, token)), expiresAt, rawLinkVisible: false }
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
