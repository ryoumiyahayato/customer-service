export { ChatRoom } from './worker-final';
import worker from './worker-final';
import type { Env } from './worker';
import {
  DEFAULT_VISITOR_ROOT_DOMAIN,
  isLocalDevelopmentHost,
  isVisitorSurfaceHost,
  normalizePublicHost,
} from './domainIsolation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type DomainEnv = Env & { VISITOR_ROOT_DOMAIN?: string; VISITOR_PUBLIC_HOSTS?: string };
const inner = worker as WorkerModule;
const INVITE_CONSUME = /^\/api\/guest\/[a-f0-9]{40}$/i;
const MESSAGE_LIST = /^\/api\/sessions\/[^/]+\/messages$/;
const CUSTOMER_READ = /^\/api\/sessions\/[^/]+\/customer-read$/;
const CONVERSATION_SOCKET = /^\/api\/ws\/conversations\/[^/]+$/;
const ATTACHMENT = /^\/api\/attachments\/[^/]+$/;

function visitorRoot(env: Env) {
  return normalizePublicHost((env as DomainEnv).VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN) || DEFAULT_VISITOR_ROOT_DOMAIN;
}

function visitorHosts(env: Env) {
  const configured = String((env as DomainEnv).VISITOR_PUBLIC_HOSTS || visitorRoot(env));
  return [...new Set(configured.split(',').map(normalizePublicHost).filter(Boolean))];
}

function isConfiguredVisitorHost(host: string, env: Env) {
  return visitorHosts(env).some(candidate => isVisitorSurfaceHost(host, candidate));
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

export function isAllowedVisitorApiRequest(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  if (method === 'POST' && INVITE_CONSUME.test(path)) return true;
  if (method === 'GET' && path === '/api/guest-avatar') return true;
  if (method === 'GET' && MESSAGE_LIST.test(path)) return true;
  if (method === 'POST' && CUSTOMER_READ.test(path)) return true;
  if (method === 'POST' && path === '/api/messages') return true;
  if (method === 'POST' && path === '/api/upload') return true;
  if ((method === 'GET' || method === 'HEAD') && ATTACHMENT.test(path)) return true;
  if (method === 'GET' && CONVERSATION_SOCKET.test(path) && req.headers.get('upgrade')?.toLowerCase() === 'websocket') return true;
  return false;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const host = normalizePublicHost(url.hostname);
    const visitorHost = !isLocalDevelopmentHost(host) && isConfiguredVisitorHost(host, env);
    if (visitorHost && url.pathname.startsWith('/api/') && !isAllowedVisitorApiRequest(req)) return notFound();
    return inner.fetch(req, env, ctx);
  },
};
