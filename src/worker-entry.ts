export { ChatRoom } from './worker-presentation';
import presentationWorker from './worker-presentation';
import type { Env } from './worker';
import { hmacHex } from './security/signing';
import { jsonResponse } from './security/responseHeaders';
import { normalizeOperatorPresentation, operatorPresentationKey } from './operatorPresentation';
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
  is_disabled?: number;
};

type SettingsRow = { key?: string; value_json: string };
type SessionListPayload = { sessions?: Array<Record<string, unknown>> };
type PresentationPayload = { presentation?: Record<string, unknown> | null };

const inner = presentationWorker as WorkerModule;
const json = (body: unknown, status = 200) => jsonResponse(body, { status });

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
  const operatorId = typeof payload?.presentation?.operatorId === 'string'
    ? payload.presentation.operatorId
    : '';
  if (!payload?.presentation || !operatorId) return response;
  const presentation = await readPresentation(env, operatorId);
  payload.presentation = {
    ...payload.presentation,
    qrAccentColor: presentation.qrAccentColor,
  };
  return rewrittenJsonResponse(response, payload);
}

async function storeSessionClientMetadata(env: Env, req: Request, sessionId: string, capturedAt: string) {
  if (!sessionId) return;
  const metadata = clientMetadataFromRequest(req, capturedAt);
  if (!metadata.deviceLabel && !metadata.approximateLocation) return;
  await env.DB.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(sessionClientMetadataKey(sessionId), JSON.stringify(metadata), capturedAt).run();
}

async function loadSessionMetadata(env: Env, sessionIds: string[]) {
  const result = new Map<string, SessionClientMetadata>();
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
        const parsed = JSON.parse(row.value_json) as Partial<SessionClientMetadata>;
        result.set(sessionId, {
          deviceLabel: typeof parsed.deviceLabel === 'string' ? parsed.deviceLabel : '',
          approximateLocation: typeof parsed.approximateLocation === 'string' ? parsed.approximateLocation : '',
          capturedAt: typeof parsed.capturedAt === 'string' ? parsed.capturedAt : '',
        });
      } catch {
        // Ignore malformed legacy metadata rather than failing the session list.
      }
    }
  }
  return result;
}

async function enrichSessionListResponse(response: Response, env: Env) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as SessionListPayload | null;
  if (!payload || !Array.isArray(payload.sessions)) return response;
  const sessionIds = payload.sessions
    .map((session) => typeof session.id === 'string' ? session.id : '')
    .filter(Boolean);
  if (!sessionIds.length) return response;
  const metadata = await loadSessionMetadata(env, sessionIds);
  payload.sessions = payload.sessions.map((session) => {
    const id = typeof session.id === 'string' ? session.id : '';
    const client = metadata.get(id);
    return client ? {
      ...session,
      device_label: client.deviceLabel,
      approximate_location: client.approximateLocation,
      client_metadata_captured_at: client.capturedAt,
    } : session;
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
    const invitePresentationMatch = url.pathname.match(/^\/api\/invite-presentation\/([^/]+)$/);
    if (invitePresentationMatch && req.method === 'GET') {
      return handleInvitePresentation(env, decodeURIComponent(invitePresentationMatch[1]));
    }

    if (/^\/api\/sessions\/[^/]+\/restore$/.test(url.pathname) && req.method === 'POST') {
      return json({ error: 'restore_not_supported' }, 410);
    }

    const response = await inner.fetch(req, env, ctx);

    if (req.method === 'POST' && /^\/api\/guest\/[^/]+$/.test(url.pathname) && response.ok) {
      const payload = await response.clone().json().catch(() => null) as { session?: { id?: unknown } } | null;
      const sessionId = typeof payload?.session?.id === 'string' ? payload.session.id : '';
      if (sessionId) {
        defer(ctx, storeSessionClientMetadata(env, req, sessionId, new Date().toISOString()));
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      return enrichSessionListResponse(response, env);
    }

    if (url.pathname === '/api/admins/presentation' || url.pathname === '/api/admins/presentation/avatar') {
      return enrichPresentationResponse(response, env);
    }

    return response;
  },
};