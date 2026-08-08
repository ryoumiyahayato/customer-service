export { ChatRoom } from './worker-final';
import worker from './worker-final';
import type { Env } from './worker';
import { hmacHex } from './security/signing';
import {
  DEFAULT_VISITOR_ROOT_DOMAIN,
  extractVisitorSubdomainToken,
  isLocalDevelopmentHost,
  normalizePublicHost,
} from './domainIsolation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type DomainEnv = Env & { VISITOR_ROOT_DOMAIN?: string; VISITOR_PUBLIC_HOSTS?: string };
type InviteEntryRow = {
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
};

const inner = worker as WorkerModule;
const INVITE_CONSUME = /^\/api\/guest\/([a-f0-9]{40})$/i;
const MESSAGE_LIST = /^\/api\/sessions\/[^/]+\/messages$/;
const CUSTOMER_READ = /^\/api\/sessions\/[^/]+\/customer-read$/;
const CONVERSATION_SOCKET = /^\/api\/ws\/conversations\/[^/]+$/;
const ATTACHMENT = /^\/api\/attachments\/[^/]+$/;

function visitorRoot(env: Env) {
  return normalizePublicHost((env as DomainEnv).VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN) || DEFAULT_VISITOR_ROOT_DOMAIN;
}

function visitorRoots(env: Env) {
  const configured = String((env as DomainEnv).VISITOR_PUBLIC_HOSTS || visitorRoot(env));
  return [...new Set(configured.split(',').map(normalizePublicHost).filter(Boolean))];
}

function visitorHostContext(host: string, env: Env) {
  for (const root of visitorRoots(env)) {
    const token = extractVisitorSubdomainToken(host, root);
    if (token) return { root, token };
  }
  return null;
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

async function inviteAllowsInitialDocument(env: Env, token: string) {
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token.toLowerCase()}`);
  const row = await env.DB.prepare(
    `SELECT expires_at,revoked_at,consumed_at
       FROM invite_links
      WHERE token_hash=?
      LIMIT 1`,
  ).bind(tokenHash).first<InviteEntryRow>();
  if (!row) return false;
  if (row.revoked_at || row.consumed_at) return false;
  return row.expires_at > new Date().toISOString();
}

export function isAllowedVisitorApiRequest(req: Request, expectedInviteToken = '') {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const consume = path.match(INVITE_CONSUME);
  if (method === 'POST' && consume) {
    return !expectedInviteToken || consume[1].toLowerCase() === expectedInviteToken.toLowerCase();
  }
  if (method === 'GET' && path === '/api/guest-avatar') return true;
  if (method === 'GET' && MESSAGE_LIST.test(path)) return true;
  if (method === 'POST' && CUSTOMER_READ.test(path)) return true;
  if (method === 'POST' && path === '/api/messages') return true;
  if (method === 'POST' && path === '/api/upload') return true;
  if ((method === 'GET' || method === 'HEAD') && ATTACHMENT.test(path)) return true;
  if (method === 'GET' && CONVERSATION_SOCKET.test(path) && req.headers.get('upgrade')?.toLowerCase() === 'websocket') return true;
  return false;
}

function visitorDocumentRequest(req: Request) {
  const url = new URL(req.url);
  url.pathname = '/visitor/visitor.html';
  url.search = '';
  return new Request(url.toString(), {
    method: 'GET',
    headers: req.headers,
  });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const host = normalizePublicHost(url.hostname);
    if (isLocalDevelopmentHost(host)) return inner.fetch(req, env, ctx);

    const visitor = visitorHostContext(host, env);
    if (!visitor) return inner.fetch(req, env, ctx);

    const method = req.method.toUpperCase();
    if ((method === 'GET' || method === 'HEAD') && url.pathname === '/') {
      if (!(await inviteAllowsInitialDocument(env, visitor.token))) return notFound();
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
          },
        });
      }
      return inner.fetch(visitorDocumentRequest(req), env, ctx);
    }
    if (method === 'GET' && url.pathname.startsWith('/visitor/assets/')) {
      return inner.fetch(req, env, ctx);
    }
    if (url.pathname.startsWith('/api/')) {
      if (!isAllowedVisitorApiRequest(req, visitor.token)) return notFound();
      return inner.fetch(req, env, ctx);
    }

    return notFound();
  },
};
